import { expect, test } from '../fixtures';
import type { App } from '../fixtures';
import { startCamera } from '../helpers';
import { PEER_ASPECT } from '../thresholds';

/**
 * E2 — the aspect ratio reaching a remote peer is the source's, with or without the processor.
 *
 * [#28] and [#54] were both reported as a stretched remote view: locally the preview looked
 * right, but everyone else saw a squashed or elongated picture. Nothing a canvas probe reads can
 * show that — the probe measures what the processor emitted, and in both issues the processor
 * emitted a correctly shaped frame. What went wrong was downstream of it, where a frame whose
 * dimensions disagree with the buffers it was rendered through reaches the encoder.
 *
 * So this case reads the far end instead. `harness.loopback` wires pc1 to pc2 inside the page
 * and `stats()` returns the receiver's inbound-rtp `frameWidth`/`frameHeight` — the size a remote
 * peer is actually decoding. No server, no token, no network.
 *
 * **Ratio, not size.** The encoder ramps: a 1280x720 source is decoded at 320x180 and only
 * reaches 480x270 at around t=4.3s, which is WebRTC's bandwidth estimator scaling up, not the
 * library. The *ratio* is correct from the very first decoded frame — observed 1.777778 at every
 * read right through that step — so this asserts on the ratio and deliberately does not assert
 * absolute dimensions. Asserting those would mean waiting out the ramp, and would then be
 * measuring the bandwidth estimator rather than the library.
 *
 * **Three assertions, because two of them alone would be weak:**
 *
 *   1. Processor on and off agree. The direct statement of the bug.
 *   2. Both agree with the *source* ratio. On its own, (1) passes just as happily when both
 *      outputs are stretched the same way — which is precisely what a buffer-geometry bug that
 *      also affects the passthrough path would produce.
 *   3. Frames kept decoding across the measurement window. Without this the first two are
 *      vacuous: a frozen receiver reports its last `frameWidth` forever, and a stale number
 *      compares equal to itself. (#127 is the standing reminder that a stalled publish and a
 *      healthy one look identical to anything that only reads a dimension.)
 *
 * Parameterised over a landscape and a portrait source, which is what makes (2) load-bearing:
 * the same assertion code is handed 1.7778 in one run and 0.7500 in the other, so an expectation
 * hardcoded to either one fails on the other half.
 *
 * Both halves go through the loopback so the encoder path is identical and the processor is the
 * only difference. Each half gets its own page load rather than an attach/detach cycle on one
 * page — [#136] leaks a WebGL context per cycle, and this way neither page session builds more
 * than one processor.
 *
 * [#28]: https://github.com/livekit/track-processors-js/issues/28
 * [#54]: https://github.com/livekit/track-processors-js/issues/54
 * [#127]: https://github.com/livekit/track-processors-js/issues/127
 * [#136]: https://github.com/livekit/track-processors-js/issues/136
 */

interface RemoteGeometry {
  /** Every `frameWidth/frameHeight` read, in order, so a failure can show the whole ramp. */
  reads: { t: number; width: number; height: number; ratio: number }[];
  /** Frames the receiver decoded between the first read and the last. */
  framesDecoded: number;
}

/**
 * Loads the page, optionally attaches the processor, and measures what the far end decodes.
 *
 * Camera start is setup and goes through the harness; attaching is the behaviour this case is
 * contrasting, so it goes through the real button. The sampling loop runs inside the page so the
 * reads are spaced by the interval rather than by a round trip each.
 */
async function remoteGeometry(
  app: App,
  source: { width: number; height: number },
  { processor }: { processor: boolean },
): Promise<RemoteGeometry> {
  const { page } = app;
  await app.goto({ backdrop: 'checker', motion: 'static' });
  await startCamera(page, source);

  if (processor) {
    await page.click('[data-testid="attach-processor"]');
    await page.waitForFunction(() => document.body.dataset.videoProcessor === 'true', null, {
      timeout: 30_000,
    });
    await page.evaluate(() => window.harness.probe.waitForFrames(10, 25_000));
  }

  return page.evaluate(
    async (o) => {
      // The track a remote peer would receive: the processor's output while one is attached,
      // the raw camera track otherwise. Same accessor either way, so nothing but the processor
      // differs between the two halves.
      const track = window.harness.media.processedVideoTrack();
      if (!track) throw new Error('No video track to publish');

      // Resolves once the receiver has decoded a frame and reported a size, so the first read
      // below is never the zeroed warm-up report.
      await window.harness.loopback.start(track);

      const startedAt = performance.now();
      const reads: RemoteGeometry['reads'] = [];
      let first: number | null = null;
      let last = 0;
      for (let i = 0; i < o.reads; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const s = await window.harness.loopback.stats();
        if (s?.frameWidth && s.frameHeight) {
          reads.push({
            t: Math.round(performance.now() - startedAt),
            width: s.frameWidth,
            height: s.frameHeight,
            ratio: s.frameWidth / s.frameHeight,
          });
          if (first === null) first = s.framesDecoded;
          last = s.framesDecoded;
        }
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => {
          setTimeout(r, o.intervalMs);
        });
      }
      await window.harness.loopback.stop();
      return { reads, framesDecoded: last - (first ?? 0) };
    },
    { reads: PEER_ASPECT.READS, intervalMs: PEER_ASPECT.READ_INTERVAL_MS },
  );
}

/** Relative difference, so one tolerance covers both orientations. */
function ratioError(measured: number, expected: number) {
  return Math.abs(measured - expected) / expected;
}

const SOURCES = [
  { width: 1280, height: 720, label: '1280x720 landscape' },
  { width: 480, height: 640, label: '480x640 portrait' },
];

test.describe('peer geometry', () => {
  for (const { width, height, label } of SOURCES) {
    test(`E2: ${label} reaches the remote peer at the source aspect ratio`, async ({ app }) => {
      const sourceRatio = width / height;

      const off = await remoteGeometry(app, { width, height }, { processor: false });
      const on = await remoteGeometry(app, { width, height }, { processor: true });

      for (const [name, measurement] of [
        ['processor off', off],
        ['processor on', on],
      ] as const) {
        // Not vacuous: a receiver that stopped decoding keeps reporting its last frame size.
        expect(
          measurement.framesDecoded,
          `the remote peer stopped decoding with the ${name}`,
        ).toBeGreaterThanOrEqual(PEER_ASPECT.MIN_FRAMES_DECODED);
        expect(measurement.reads.length, `no sized reads with the ${name}`).toBeGreaterThanOrEqual(
          PEER_ASPECT.MIN_READS,
        );

        // Every read, not just the last: the encoder changes resolution mid-window, and a ratio
        // that only holds once it has settled would still have shipped a stretched frame.
        for (const read of measurement.reads) {
          expect(
            ratioError(read.ratio, sourceRatio),
            `remote aspect ratio ${read.width}x${read.height} (${read.ratio.toFixed(4)}) is not the source's ${sourceRatio.toFixed(4)} with the ${name}; reads: ${JSON.stringify(measurement.reads)}`,
          ).toBeLessThanOrEqual(PEER_ASPECT.MAX_RATIO_ERROR);
        }
      }

      // And the two agree with each other, which is the sentence #28 and #54 were reported in:
      // turning the processor on changed the shape of the remote view.
      const offRatio = off.reads[off.reads.length - 1].ratio;
      const onRatio = on.reads[on.reads.length - 1].ratio;
      expect(
        ratioError(onRatio, offRatio),
        `the processor changed the remote aspect ratio: ${offRatio.toFixed(4)} off, ${onRatio.toFixed(4)} on`,
      ).toBeLessThanOrEqual(PEER_ASPECT.MAX_RATIO_ERROR);
    });
  }
});
