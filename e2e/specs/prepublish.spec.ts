import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { sampleStable, startCamera } from '../helpers';
import { GEOMETRY, PREPUBLISH, VIRTUAL_BACKGROUND } from '../thresholds';

/**
 * B4 — a processor attached before the track is published still publishes an aligned mask.
 *
 * Issue [#97]: on iPhone, attaching a processor to a track that had not been published yet
 * produced a frame with the background laid over the subject. The order is the whole case.
 * `ProcessorWrapper.setup()` sizes `sourceDummy`, the GL canvas, and — on the canvas fallback —
 * the `displayCanvas` the published track is captured from, all from
 * `waitForTrackResolution(source)`. Attaching before anything has pulled a frame from the track
 * is the moment that call is least likely to have an answer, and a processor that sized its
 * buffers from a track with no dimensions is the bug shape #97 describes.
 *
 * Run on both pipelines because only one of them has that sizing problem to have: on insertable
 * streams the published track is the generator and the GL canvas follows the frame, while on
 * the fallback the published track is a `captureStream()` of a canvas whose size came from
 * `waitForTrackResolution`. #97 was filed from Safari, which is the fallback.
 *
 * The attach is a real click; publishing goes through `harness.loopback`, which has no control
 * of its own. Only one order is expressible here, and deliberately so: the loopback sender
 * holds whichever track it was handed and there is no `replaceTrack`, so "publish first, attach
 * second" would leave the far end receiving the raw camera and would be a different case.
 *
 * What the order is worth on Chrome, and the negative controls these numbers are calibrated
 * against, are recorded beside PREPUBLISH in thresholds.ts. Short version: the order alone
 * cannot break this here — both pipelines re-derive the frame size on every frame — so the
 * controls are a mask deliberately offset, and a mask that claims the whole frame.
 *
 * [#97]: https://github.com/livekit/track-processors-js/issues/97
 */

const PLATE = { ...VIRTUAL_BACKGROUND.COLOR, tolerance: VIRTUAL_BACKGROUND.TOLERANCE };

/**
 * Where the mask sits relative to where the compositor drew the subject, plus how much of the
 * subject the background plate has been drawn over.
 *
 * Polled inside the page so the figures are not inflated by a round trip per sample, and so the
 * far-end measurement can wait on two conditions at once: enough frames presented since the
 * probe rebound, and a decoded size that agrees with what inbound-rtp reports. Both exist to
 * rule out measuring a stale local frame — see PREPUBLISH in thresholds.ts for why that is the
 * trap worth guarding here.
 *
 * `regions.bg` is the subject patch, so `backgroundMatchRatio` answers "how much of the subject
 * is plate" rather than "how much of the background is plate". The plate is never where the
 * subject is, so this reads zero when the mask is right and climbs as it slips.
 */
async function measureMask(
  page: Page,
  source: 'processed' | 'received',
  opts: { minFrames: number; timeoutMs: number },
) {
  return page.evaluate(
    async (o) => {
      // The first read is what rebinds the probe video, which resets its presented-frame
      // counter; after it, `presentedFrames` counts frames from this source only. Keeping that
      // first index is how the spec proves the rebind happened at all — see
      // `rebindFrameIndex` below.
      const first = await window.harness.probe.sample({ source: o.source }).catch(() => null);
      const rebindFrameIndex = first?.presentedFrames ?? -1;

      const deadline = performance.now() + o.timeoutMs;
      let last: {
        width: number;
        height: number;
        rebindFrameIndex: number;
        freshFrames: number;
        inboundWidth: number | null;
        subjectPlateRatio: number;
        dx: number;
        dy: number;
        coverage: number;
        contained: boolean;
        box: unknown;
        settled: boolean;
      } | null = null;

      while (performance.now() < deadline) {
        const stats = o.source === 'received' ? await window.harness.loopback.stats() : null;
        const sample = await window.harness.probe.sample({
          source: o.source,
          regions: { bg: o.patch },
          expectBackground: o.plate,
        });
        const truth = window.harness.probe.expectedForegroundBox()!;
        const box = sample.foregroundBox;
        const freshFrames = sample.presentedFrames ?? 0;
        // The far end's encoder ramps its resolution up over the first seconds, so the size is
        // whatever it currently is — what matters is that the probe is reading *that* frame and
        // not the 1280x720 local one it was bound to a moment ago.
        const sizeAgrees = o.source !== 'received' || sample.width === stats?.frameWidth;

        last = {
          width: sample.width,
          height: sample.height,
          rebindFrameIndex,
          freshFrames,
          inboundWidth: stats?.frameWidth ?? null,
          subjectPlateRatio: sample.backgroundMatchRatio ?? 1,
          // Centre and containment rather than edges: the mask legitimately covers less than
          // the rect the compositor drew into. GEOMETRY in thresholds.ts explains why.
          dx: box ? Math.abs(box.x + box.w / 2 - (truth.x + truth.w / 2)) : Number.NaN,
          dy: box ? Math.abs(box.y + box.h / 2 - (truth.y + truth.h / 2)) : Number.NaN,
          coverage: box?.coverage ?? 0,
          contained: box
            ? box.x >= truth.x - o.margin &&
              box.y >= truth.y - o.margin &&
              box.x + box.w <= truth.x + truth.w + o.margin &&
              box.y + box.h <= truth.y + truth.h + o.margin
            : false,
          box,
          settled: freshFrames >= o.minFrames && sizeAgrees,
        };
        if (last.settled) return last;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (!last) throw new Error(`No ${o.source} frame could be measured`);
      return last;
    },
    {
      source,
      minFrames: opts.minFrames,
      timeoutMs: opts.timeoutMs,
      patch: PREPUBLISH.SUBJECT_PATCH,
      plate: PLATE,
      margin: GEOMETRY.CONTAINMENT_MARGIN,
    },
  );
}

const PIPELINES = [
  { label: 'insertable streams', fallback: 0 },
  { label: 'the canvas fallback', fallback: 1 },
];

test.describe('processor lifecycle', () => {
  for (const { label: pipeline, fallback } of PIPELINES) {
    test(`B4: a processor attached before publishing stays aligned on ${pipeline}`, async ({
      app,
    }) => {
      const { page } = app;
      // flat, because foregroundBox learns the background from a border ring and needs a
      // low-frequency one; static, so ground truth stays one rect for the whole run.
      // virtual-background from the start, so the attach click builds the processor in the mode
      // #97 was reported in — and so "the background overlaid the subject" is a colour the
      // probe can find rather than an impression.
      await app.goto({
        backdrop: 'flat',
        motion: 'static',
        mode: 'virtual-background',
        fallback,
      });

      await startCamera(page, { width: 1280, height: 720 });

      // Nothing is published yet, and that is the precondition the case is named for.
      expect(
        await page.evaluate(() => window.harness.loopback.isConnected()),
        'the track was already published before the processor was attached',
      ).toBe(false);

      await page.click('[data-testid="attach-processor"]');
      await page.waitForFunction(() => window.harness.snapshot().videoProcessorEnabled === true);
      await page.evaluate(() => window.harness.probe.waitForFrames(15, 25_000));
      expect(
        await page.evaluate(() => document.body.dataset.pipeline),
        'the run is not on the pipeline it claims to be testing',
      ).toBe(fallback ? 'canvas-fallback' : 'insertable-streams');

      await sampleStable(page);
      const local = await measureMask(page, 'processed', { minFrames: 0, timeoutMs: 10_000 });
      expect(
        local.box,
        `no subject was segmented on the unpublished track: ${JSON.stringify(local)}`,
      ).not.toBeNull();

      // Now publish it. The processor's output track is what a Room would hand the sender, so
      // it is what the loopback gets.
      await page.evaluate(() =>
        window.harness.loopback.start(window.harness.media.processedVideoTrack()!),
      );

      const received = await measureMask(page, 'received', {
        minFrames: PREPUBLISH.MIN_RECEIVED_FRAMES,
        timeoutMs: 20_000,
      });
      const report = `received ${JSON.stringify(received)}; local was ${JSON.stringify(local)}`;

      // The measurement is of the far end and not of a stale local frame. Asserted rather than
      // assumed: without it every number below could be the local frame read twice, which is
      // the failure mode AGENTS.md records as C3's.
      expect(received.settled, `the far end never settled: ${report}`).toBe(true);
      // The probe's frame counter restarted, so it really did rebind to the far end rather
      // than carrying on reading the local track. The size check below is not enough on its
      // own: the encoder eventually ramps to 1280x720, at which point a stale local frame
      // agrees with inbound-rtp by coincidence.
      expect(
        received.rebindFrameIndex,
        `the probe never rebound to the received track: ${report}`,
      ).toBeLessThanOrEqual(PREPUBLISH.MAX_REBIND_FRAME_INDEX);
      expect(received.width, `decoded size disagrees with inbound-rtp: ${report}`).toBe(
        received.inboundWidth,
      );
      expect(
        received.freshFrames,
        `too few frames presented since the probe rebound: ${report}`,
      ).toBeGreaterThanOrEqual(PREPUBLISH.MIN_RECEIVED_FRAMES);

      // #97, as a number: the background must not be drawn over the subject. A patch well
      // inside the mask carries no plate colour at all when the mask is where it belongs.
      expect(
        received.subjectPlateRatio,
        `the background plate is covering the subject at the far end: ${report}`,
      ).toBeLessThanOrEqual(PREPUBLISH.MAX_SUBJECT_PLATE_RATIO);
      expect(
        local.subjectPlateRatio,
        `the background plate is covering the subject on the local track: ${report}`,
      ).toBeLessThanOrEqual(PREPUBLISH.MAX_SUBJECT_PLATE_RATIO);

      // And the mask is over the subject the compositor drew, not merely somewhere.
      expect(received.dx, `mask centre is off in x: ${report}`).toBeLessThanOrEqual(
        GEOMETRY.CENTRE_TOLERANCE,
      );
      expect(received.dy, `mask centre is off in y: ${report}`).toBeLessThanOrEqual(
        GEOMETRY.CENTRE_TOLERANCE,
      );
      expect(received.contained, `the mask reaches outside the drawn subject: ${report}`).toBe(
        true,
      );
      expect(received.coverage, `subject coverage at the far end: ${report}`).toBeGreaterThan(
        GEOMETRY.COVERAGE_MIN,
      );
      expect(received.coverage, `subject coverage at the far end: ${report}`).toBeLessThan(
        GEOMETRY.COVERAGE_MAX,
      );

      // Publishing did not change the picture: the far end's subject takes the same share of
      // the frame the unpublished track's did.
      const drift = Math.abs(received.coverage - local.coverage) / local.coverage;
      expect(drift, `subject coverage moved across publishing: ${report}`).toBeLessThan(
        PREPUBLISH.MAX_COVERAGE_DRIFT,
      );
    });
  }
});
