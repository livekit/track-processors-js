import type { FrameFingerprint } from '../../examples/e2e/types';
import { expect, test } from '../fixtures';
import {
  attachProcessor,
  colourDistance,
  sampleSource,
  sampleStable,
  startCamera,
} from '../helpers';
import { BLUR, DEVICE_SWITCH, GEOMETRY } from '../thresholds';

/**
 * K1 — switching camera device while the processor is attached.
 *
 * Picking another camera is `LocalVideoTrack.restartTrack`, which acquires a new source and then
 * calls `processor.restart()` — a full destroy-and-init of the pipeline against a track of a
 * different size. Issue #70 is what happens when that goes wrong: the effect is silently lost, or
 * the output keeps the old geometry, or the published frames stop. So this asserts all three
 * properties the restart has to preserve, and does the switching through the device dropdown
 * rather than through `media.switchDevice`, because the dropdown is how a real integration does it.
 *
 * The two fake devices differ in resolution on purpose (1280x720 -> 640x480); a switch between two
 * same-sized cameras could not tell "followed the new device" from "kept the old buffers".
 */

const WIDE = { deviceId: 'fake-wide', width: 1280, height: 720 };
const FRONT = { deviceId: 'fake-front', width: 640, height: 480 };

/** Does this frame carry the same visual treatment as `reference`? */
function matches(frame: FrameFingerprint, reference: FrameFingerprint) {
  return (
    colourDistance(frame.bgMean, reference.bgMean) <= DEVICE_SWITCH.MATCH_TOLERANCE &&
    colourDistance(frame.fgMean, reference.fgMean) <= DEVICE_SWITCH.MATCH_TOLERANCE &&
    Math.abs(frame.bgBlurEnergy - reference.bgBlurEnergy) <= DEVICE_SWITCH.ENERGY_TOLERANCE
  );
}

const summarize = (frame: FrameFingerprint) =>
  `#${frame.index} hash ${frame.hash} bgEnergy ${frame.bgBlurEnergy.toFixed(4)} bg ` +
  `${frame.bgMean.r.toFixed(0)},${frame.bgMean.g.toFixed(0)},${frame.bgMean.b.toFixed(0)} fg ` +
  `${frame.fgMean.r.toFixed(0)},${frame.fgMean.g.toFixed(0)},${frame.fgMean.b.toFixed(0)}`;

test.describe('device switching', () => {
  test('K1: switching camera keeps blur applied and follows the new resolution', async ({
    app,
  }) => {
    const { page } = app;
    // checker, because blur is measured as lost background detail and a flat backdrop has none.
    await app.goto({ backdrop: 'checker', motion: 'static' });

    await startCamera(page, { deviceId: WIDE.deviceId });
    const raw = await sampleSource(page);
    expect({ width: raw.width, height: raw.height }).toEqual({
      width: WIDE.width,
      height: WIDE.height,
    });
    expect(raw.regions.bg.blurEnergy, 'the raw input has no detail to lose').toBeGreaterThan(
      BLUR.RAW_BG_ENERGY_MIN,
    );

    await attachProcessor(page);
    const before = await sampleStable(page);
    expect({ width: before.width, height: before.height }).toEqual({
      width: WIDE.width,
      height: WIDE.height,
    });

    // Fingerprint every frame across the switch. Polling could only show that no bad frame was
    // observed; recording shows what was published — the same reason C1b records a mode switch.
    await page.evaluate(() => window.harness.probe.startRecording());
    await page.waitForTimeout(DEVICE_SWITCH.PRE_ROLL_MS);

    await page.selectOption('[data-testid="video-device"]', FRONT.deviceId);
    await page.waitForFunction(
      (expected) => document.body.dataset.resolution === expected,
      `${FRONT.width}x${FRONT.height}`,
      { timeout: 20_000 },
    );

    // Deliberately unsettled: the first frame readable on the new track, with no settle window.
    const immediate = await page.evaluate(() => window.harness.probe.sample());
    expect(
      { width: immediate.width, height: immediate.height },
      'a frame at the old size was still being published after the switch',
    ).toEqual({ width: FRONT.width, height: FRONT.height });

    const live = await page.evaluate(
      (count) => window.harness.probe.waitForFrames(count, 20_000),
      DEVICE_SWITCH.FRAMES_AFTER_SWITCH,
    );
    const frames = await page.evaluate(() => window.harness.probe.stopRecording());

    // --------------------------------------------------------------- still processed, still live

    const after = await sampleStable(page);
    const reduction = 1 - after.regions.bg.blurEnergy / raw.regions.bg.blurEnergy;
    expect(reduction, 'blur was lost across the device switch').toBeGreaterThan(
      DEVICE_SWITCH.BLUR_REDUCTION_MIN,
    );
    expect(
      after.regions.fg.blurEnergy / after.regions.bg.blurEnergy,
      'the subject is no sharper than its background, so segmentation is not running',
    ).toBeGreaterThan(DEVICE_SWITCH.FG_OVER_BG_MIN);

    expect(live.presented / (live.elapsedMs / 1000), 'the published track froze').toBeGreaterThan(
      DEVICE_SWITCH.MIN_FPS_AFTER,
    );
    // No hash comparison against the pre-switch frame here, deliberately. It used to assert
    // `after.hash !== before.hash`, which held only while the subject was drawn from primitives
    // at the capture resolution: the two fake devices then rasterised the figure differently
    // and the 320px sample differed. Against the committed `subject.png` both devices render
    // the same photo, so the downscaled sample is byte-identical at 1280x720 and 640x480 and
    // the assertion fails on a working switch.
    //
    // Nothing is lost. The property it stood for — the output is the new device's, not a stale
    // frame from the old one — is carried more strictly by the `immediate` sample above, which
    // demands the new dimensions on the first frame readable after the switch with no settle
    // window at all. `motion: 'static'` also makes consecutive frames identical by design, so a
    // distinct-hash liveness check is not available here; liveness is the fps assertion and the
    // per-frame recording classified below.

    // --------------------------------------------------------------- geometry follows the device

    expect(
      { width: after.width, height: after.height },
      'the output kept the old device dimensions',
    ).toEqual({ width: FRONT.width, height: FRONT.height });
    expect(after.width / after.height).toBeCloseTo(FRONT.width / FRONT.height, 2);

    // foregroundBox needs a low-frequency background: on checker it returns the whole frame,
    // because downscaling blends adjacent cells into colours matching neither. Flat gives an
    // exact box, and the compositor keeps drawing the subject at the same normalized rect.
    await page.evaluate(() => window.harness.camera.setBackdrop('flat'));
    await page.evaluate(() => window.harness.probe.waitForFrames(5, 20_000));
    const flat = await sampleStable(page);
    const box = flat.foregroundBox;
    const truth = await page.evaluate(() => window.harness.probe.expectedForegroundBox());
    expect(box, 'no foreground found against the flat backdrop').not.toBeNull();
    expect(truth).not.toBeNull();

    // Centre and containment rather than equality with the layout rect — see the GEOMETRY block.
    expect(Math.abs(box!.x + box!.w / 2 - (truth!.x + truth!.w / 2))).toBeLessThan(
      GEOMETRY.CENTRE_TOLERANCE,
    );
    expect(Math.abs(box!.y + box!.h / 2 - (truth!.y + truth!.h / 2))).toBeLessThan(
      GEOMETRY.CENTRE_TOLERANCE,
    );
    expect(box!.x).toBeGreaterThanOrEqual(truth!.x - GEOMETRY.CONTAINMENT_MARGIN);
    expect(box!.y).toBeGreaterThanOrEqual(truth!.y - GEOMETRY.CONTAINMENT_MARGIN);
    expect(box!.x + box!.w).toBeLessThanOrEqual(truth!.x + truth!.w + GEOMETRY.CONTAINMENT_MARGIN);
    expect(box!.y + box!.h).toBeLessThanOrEqual(truth!.y + truth!.h + GEOMETRY.CONTAINMENT_MARGIN);
    expect(box!.coverage).toBeGreaterThan(GEOMETRY.COVERAGE_MIN);
    expect(box!.coverage).toBeLessThan(GEOMETRY.COVERAGE_MAX);

    // --------------------------------------------------------------- no green and no frozen frame

    // The probe rebinds when the outgoing generator is replaced, which resets its frame counter —
    // so a decreasing index is exactly where the old track ends and the new one begins.
    const split = frames.findIndex((frame, i) => i > 0 && frame.index <= frames[i - 1].index);
    expect(split, 'the probe never saw a second published track').toBeGreaterThan(0);
    const outgoing = frames.slice(0, split);
    const incoming = frames.slice(split);
    expect(outgoing.length).toBeGreaterThanOrEqual(DEVICE_SWITCH.MIN_FRAMES_EACH_SIDE);
    expect(incoming.length).toBeGreaterThanOrEqual(DEVICE_SWITCH.MIN_FRAMES_EACH_SIDE);

    // References come from the settled ends of this same recording, so the tolerances only have to
    // absorb frame-to-frame noise rather than variation between machines.
    const wasBlurred = outgoing[0];
    const isBlurred = incoming[incoming.length - 1];

    // The outgoing track's last frame is dropped: once its generator is stopped, the probe's own
    // video element presents one black frame before it rebinds. That read is probe-side, not
    // published — a switch with the processor detached, where the library is not involved at all,
    // produces the identical black frame at the identical point.
    const unclassified = [
      ...outgoing.slice(0, -1).filter((frame) => !matches(frame, wasBlurred)),
      ...incoming.filter((frame) => !matches(frame, isBlurred)),
    ];
    expect(
      unclassified.map(summarize),
      'frames matching neither the old nor the new blurred output were published',
    ).toEqual([]);
  });
});
