import type { FrameFingerprint, Rgb } from '../../examples/e2e/types';
import { expect, test } from '../fixtures';
import {
  attachProcessor,
  colourDistance,
  sampleSource,
  sampleStable,
  startCamera,
} from '../helpers';
import { RESTART, SWITCH } from '../thresholds';

/**
 * B7 — restarting the track under a running processor.
 *
 * `LocalVideoTrack.restartTrack()` stops the source, acquires a new one, and then calls
 * `processor.restart()`, which is a full destroy-and-init of the pipeline. That teardown is
 * where [#111] and [#96] lived: a black frame, or a grey plate, reaching the published track
 * while the replacement is being built. [#89] is the same seam from the console side — the
 * restart race that left `InvalidStateError: Stream closed` behind and a frozen published
 * track; `FORBIDDEN_CONSOLE` carries that string, so the automatic clean-console check covers
 * it on every run of this file.
 *
 * Polling with `sample()` could not establish any of it: it would only show that no bad frame
 * happened to be *observed*. So every presented frame across the restart is fingerprinted and
 * classified, the way C1b classifies a mode switch, against references taken from the settled
 * ends of the same recording.
 *
 * Both variants a restart comes in are driven: plain, and with a new resolution. Both go
 * through the Restart track button, because that is what an integration does.
 *
 * The camera is `fake-front` at its native 640x480 and the device dropdown is never touched —
 * picking another device is K1's case, and changing the selection would fire a restart of its
 * own before this one.
 *
 * [#111]: https://github.com/livekit/track-processors-js/pull/111
 * [#96]: https://github.com/livekit/track-processors-js/pull/96
 * [#89]: https://github.com/livekit/track-processors-js/issues/89
 */

const DEVICE = { deviceId: 'fake-front', width: 640, height: 480 };

const channels = ({ r, g, b }: Rgb) => Math.max(r, g, b);

/**
 * A frame with no detail left in its background: a black frame, a grey plate, or #41's green
 * one. All three read energy 0.0000 — that is what makes "near-black or near-grey" a single
 * measurement rather than two colour comparisons that would each need their own tolerance.
 */
const isFlat = (f: FrameFingerprint) => f.bgBlurEnergy <= RESTART.FLAT_ENERGY_MAX;

const isNearBlack = (f: FrameFingerprint) =>
  isFlat(f) &&
  channels(f.bgMean) <= RESTART.NEAR_BLACK_LEVEL_MAX &&
  channels(f.fgMean) <= RESTART.NEAR_BLACK_LEVEL_MAX;

/** Does this frame carry the same visual treatment as `reference`? C1b's test, C1b's tolerances. */
const matches = (frame: FrameFingerprint, reference: FrameFingerprint) =>
  colourDistance(frame.bgMean, reference.bgMean) <= SWITCH.MATCH_TOLERANCE &&
  colourDistance(frame.fgMean, reference.fgMean) <= SWITCH.MATCH_TOLERANCE &&
  Math.abs(frame.bgBlurEnergy - reference.bgBlurEnergy) <= SWITCH.ENERGY_TOLERANCE;

const describe = (f: FrameFingerprint) =>
  `#${f.index} bg=(${f.bgMean.r.toFixed(0)},${f.bgMean.g.toFixed(0)},${f.bgMean.b.toFixed(0)}) ` +
  `fg=(${f.fgMean.r.toFixed(0)},${f.fgMean.g.toFixed(0)},${f.fgMean.b.toFixed(0)}) ` +
  `e=${f.bgBlurEnergy.toFixed(4)}`;

/** Longest run of consecutive frames satisfying `predicate`. */
function longestRun(frames: FrameFingerprint[], predicate: (f: FrameFingerprint) => boolean) {
  let best = 0;
  let run = 0;
  for (const frame of frames) {
    run = predicate(frame) ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

type Variant = { name: string; resolution?: string; expectedSize: string };

const VARIANTS: Variant[] = [
  { name: 'plain', expectedSize: '640x480' },
  { name: 'with new constraints', resolution: '1280x720', expectedSize: '1280x720' },
];

test.describe('track restart', () => {
  for (const variant of VARIANTS) {
    test(`B7: restarting the track ${variant.name} does not flash black or grey`, async ({
      app,
    }) => {
      const { page } = app;
      // checker, because the blur is measured as lost background detail and a flat backdrop has
      // none — and because a flat backdrop could not tell a grey plate from the camera.
      await app.goto({ backdrop: 'checker', motion: 'static' });

      await startCamera(page, DEVICE);
      // Before attaching, and that ordering is load-bearing: `setProcessor` repoints the track's
      // own mediaStreamTrack at the processed one, so a 'source' sample taken afterwards returns
      // treated frames and the reduction below would compare the blur against itself.
      const raw = await sampleSource(page);

      await attachProcessor(page);
      const before = await sampleStable(page);

      const identity = await page.evaluate(() => {
        const video = window.harness.snapshot().video;
        return { id: video?.id ?? null, processedTrackId: video?.processedTrackId ?? null };
      });

      // ------------------------------------------------------------- record across the restart

      await page.evaluate(() => window.harness.probe.startRecording());
      await page.waitForTimeout(RESTART.PRE_ROLL_MS);

      if (variant.resolution) {
        // Read by the Restart track handler when it is clicked; the select itself has no
        // handler, so this does not restart anything on its own.
        await page.selectOption('[data-testid="video-resolution"]', variant.resolution);
      }
      await page.click('[data-testid="restart-video"]');

      // Both ids, not just the source one: the restart is only through the part this case is
      // about once the processor has published a new generator, and waiting on the source alone
      // can rebind the probe while `processedTrack` is still the outgoing one.
      await page.waitForFunction(
        (previous) => {
          const video = window.harness.snapshot().video;
          return (
            !!video &&
            video.id !== previous.id &&
            !!video.processedTrackId &&
            video.processedTrackId !== previous.processedTrackId
          );
        },
        identity,
        { timeout: 30_000 },
      );

      const live = await page.evaluate(
        (count) => window.harness.probe.waitForFrames(count, 20_000),
        RESTART.FRAMES_AFTER_RESTART,
      );
      const frames = await page.evaluate(() => window.harness.probe.stopRecording());

      // ------------------------------------------------------------- split the two tracks

      // The probe rebinds when the outgoing generator is replaced, which resets its frame
      // counter — so a non-increasing index is exactly where the old track ends and the new one
      // begins. Same landmark K1 uses across a device switch.
      const split = frames.findIndex((f, i) => i > 0 && f.index <= frames[i - 1].index);
      const outgoing = split > 0 ? frames.slice(0, split) : frames;
      const incoming = split > 0 ? frames.slice(split) : [];

      const classify = (f: FrameFingerprint) => {
        if (isNearBlack(f)) return 'B';
        if (isFlat(f)) return 'G';
        if (outgoing.length > 0 && matches(f, outgoing[0])) return 'F';
        if (incoming.length > 0 && matches(f, incoming[incoming.length - 1])) return 'T';
        return 'X';
      };
      const timeline = frames.map(classify).join('');
      const diagnostics = [
        `variant: ${variant.name}`,
        `timeline (F=before, T=after, B=near-black, G=near-grey/flat, X=neither): ${timeline}`,
        `split at ${split}, ${outgoing.length} outgoing / ${incoming.length} incoming`,
        ...frames.filter((f) => classify(f) !== 'F' && classify(f) !== 'T').map(describe),
      ].join('\n');

      expect(split, `the probe never saw a second published track\n${diagnostics}`).toBeGreaterThan(
        0,
      );
      expect(
        outgoing.length,
        `too few frames before the restart\n${diagnostics}`,
      ).toBeGreaterThanOrEqual(RESTART.MIN_FRAMES_EACH_SIDE);
      expect(
        incoming.length,
        `too few frames after the restart\n${diagnostics}`,
      ).toBeGreaterThanOrEqual(RESTART.MIN_FRAMES_EACH_SIDE);

      // ------------------------------------------------------------- no flash

      // The outgoing track's last frame is dropped. It reads black, and it is the probe's own
      // <video> presenting the end of a `MediaStreamTrackGenerator` rather than anything the
      // library published — see RESTART.MAX_CONSECUTIVE_FLAT_FRAMES for the experiment that
      // pins it on the generator. Dropping exactly one frame, at exactly that position, is what
      // keeps the exclusion from quietly absorbing a real flash: the run bound below still
      // covers it, and everything else is asserted at zero.
      const published = [...outgoing.slice(0, -1), ...incoming];

      const flat = published.filter(isFlat);
      expect(
        flat.map((f) => `${isNearBlack(f) ? 'near-black' : 'near-grey'} ${describe(f)}`),
        `flat frames were published across the restart\n${diagnostics}`,
      ).toEqual([]);
      expect(flat.length).toBe(RESTART.MAX_PUBLISHED_FLAT_FRAMES);

      expect(
        longestRun(frames, isFlat),
        `a run of flat frames spanned the restart\n${diagnostics}`,
      ).toBeLessThanOrEqual(RESTART.MAX_CONSECUTIVE_FLAT_FRAMES);

      // And nothing else in between either: no raw camera showing through (#85), no frame that
      // belongs to neither side. References come from the settled ends of this same recording,
      // so the tolerances only absorb frame-to-frame noise.
      const unclassified = published.filter(
        (f) => !matches(f, outgoing[0]) && !matches(f, incoming[incoming.length - 1]),
      );
      expect(
        unclassified.map(describe),
        `frames matching neither the old nor the new output were published\n${diagnostics}`,
      ).toEqual([]);

      // ------------------------------------------------------------- the effect came back

      // A restart that silently dropped the processor would pass every assertion above: the raw
      // camera is not flat either. These are what say the blur is back.
      expect(
        live.presented / (live.elapsedMs / 1000),
        `the published track froze after the restart\n${diagnostics}`,
      ).toBeGreaterThan(RESTART.MIN_FPS_AFTER);

      const after = await sampleStable(page);
      const report =
        `raw bg ${raw.regions.bg.blurEnergy.toFixed(4)}, before ${before.regions.bg.blurEnergy.toFixed(4)}, ` +
        `after ${after.regions.bg.blurEnergy.toFixed(4)} (fg ${after.regions.fg.blurEnergy.toFixed(4)})`;

      expect(
        1 - after.regions.bg.blurEnergy / raw.regions.bg.blurEnergy,
        `the blur was lost across the restart: ${report}`,
      ).toBeGreaterThan(RESTART.BLUR_REDUCTION_MIN);
      expect(
        after.regions.fg.blurEnergy / after.regions.bg.blurEnergy,
        `the subject is no sharper than its background, so segmentation is not running: ${report}`,
      ).toBeGreaterThan(RESTART.FG_OVER_BG_MIN);

      // Read off body.dataset rather than any button, per the suite's convention. The mode is
      // what a restart that re-initialised the pipeline into `disabled` would get wrong.
      await expect
        .poll(() => page.evaluate(() => document.body.dataset.videoProcessor))
        .toBe('true');
      expect(await page.evaluate(() => document.body.dataset.mode)).toBe('background-blur');

      // The new constraints have to have been applied, or the second variant is the first one.
      await expect
        .poll(() => page.evaluate(() => document.body.dataset.resolution), { timeout: 15_000 })
        .toBe(variant.expectedSize);
      expect({ width: after.width, height: after.height }).toEqual({
        width: Number(variant.expectedSize.split('x')[0]),
        height: Number(variant.expectedSize.split('x')[1]),
      });

      // ------------------------------------------------------------- the classifier has teeth

      // #111 and #96 are fixed on this base, so the restart publishes nothing bad and every
      // assertion above would also hold for a classifier that could not recognise a black frame.
      // Muting makes the pipeline emit real ones — the state B6 leaves the output in — so the
      // same `isFlat`/`isNearBlack` are run over frames that genuinely are black, in this run,
      // on this machine. Cheap, too: a mute costs no attach cycle (#136).
      await page.evaluate(() => window.harness.probe.startRecording());
      await page.click('[data-testid="mute-video"]');
      await page.waitForTimeout(RESTART.BLACK_CONTROL_MS);
      const muted = await page.evaluate(() => window.harness.probe.stopRecording());
      const black = muted.filter(isNearBlack);
      expect(
        black.length,
        `the classifier found no black frame while the camera was muted, so the assertions ` +
          `above cannot fail: ${muted.slice(-3).map(describe).join(' | ')}`,
      ).toBeGreaterThanOrEqual(RESTART.MIN_BLACK_CONTROL_FRAMES);
      await page.click('[data-testid="unmute-video"]');
    });
  }
});
