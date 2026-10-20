import type { Page } from '@playwright/test';
import type { FrameFingerprint } from '../../examples/e2e/types';
import { expect, test } from '../fixtures';
import {
  attachProcessor,
  colourDistance,
  sampleProcessed,
  sampleStable,
  startCamera,
  switchMode,
} from '../helpers';
import { BACKGROUND_SWAP, GEOMETRY, SWITCH, VIRTUAL_BACKGROUND } from '../thresholds';

/** The two flat plates the harness ships, chosen to be exactly distinguishable from each other. */
const SOLID_IMAGE = '/bg-solid.png';
const ALT_IMAGE = '/bg-alt.png';

/** "Swap bg image". Always moves to bg-alt.png; the return leg goes through the API as setup. */
const SWAP_BUTTON = '[data-testid="set-background"]';

/**
 * Captures a fingerprint of the settled output.
 *
 * Recorded rather than sampled: the recorder works at 96px where `sample()` works at 320px, and
 * blur energy is resolution-dependent, so a reference taken one way cannot be compared against
 * frames captured the other. Same shape as C1b's, kept local so the two specs can be
 * recalibrated independently.
 */
async function recordedReference(page: Page): Promise<FrameFingerprint> {
  await page.evaluate(() => window.harness.probe.startRecording({ maxFrames: 30 }));
  await page.evaluate(() => window.harness.probe.waitForFrames(10, 20_000));
  const frames = await page.evaluate(() => window.harness.probe.stopRecording());
  expect(frames.length, 'no frames recorded for the reference').toBeGreaterThan(0);
  return frames[frames.length - 1];
}

/** Normalized distance from a reference. <= 1 means "this frame shows that image". */
function distance(frame: FrameFingerprint, reference: FrameFingerprint) {
  return Math.max(
    colourDistance(frame.bgMean, reference.bgMean) / SWITCH.MATCH_TOLERANCE,
    Math.abs(frame.bgBlurEnergy - reference.bgBlurEnergy) / SWITCH.ENERGY_TOLERANCE,
  );
}

function describeFrame(frame: FrameFingerprint) {
  const { r, g, b } = frame.bgMean;
  return `#${frame.index} bg=(${r.toFixed(0)},${g.toFixed(0)},${b.toFixed(0)}) e=${frame.bgBlurEnergy.toFixed(4)}`;
}

/**
 * D1, D4, D5 — the virtual background image.
 */
test.describe('virtual background', () => {
  test('D1: the image is composited behind the subject, not over it', async ({ app }) => {
    const { page } = app;
    // A flat backdrop makes the foreground box exact: every pixel is either the known plate
    // colour or the subject. On the checker backdrop, downscaling blends adjacent cells into
    // colours matching neither and the box degrades to the whole frame.
    await app.goto({ backdrop: 'flat', motion: 'static' });
    await startCamera(page);
    await attachProcessor(page);
    await switchMode(page, 'virtual-background');
    await sampleStable(page);

    const sample = await sampleProcessed(page, {
      ...VIRTUAL_BACKGROUND.COLOR,
      tolerance: VIRTUAL_BACKGROUND.TOLERANCE,
    });

    expect(
      sample.backgroundMatchRatio,
      'background should be replaced by the magenta plate',
    ).not.toBeNull();
    expect(sample.backgroundMatchRatio!).toBeGreaterThan(VIRTUAL_BACKGROUND.MATCH_RATIO_MIN);

    // The subject must survive. Compared against where the compositor actually drew it, so this
    // is measured against ground truth rather than a golden image.
    const truth = await page.evaluate(() => window.harness.camera.subjectRect());
    expect(sample.foregroundBox, 'no subject found in front of the background').not.toBeNull();

    const box = sample.foregroundBox!;
    const report =
      `box ${box.x.toFixed(2)},${box.y.toFixed(2)} ${box.w.toFixed(2)}x${box.h.toFixed(2)} ` +
      `cov ${box.coverage.toFixed(3)} ` +
      `vs drawn ${truth.x.toFixed(2)},${truth.y.toFixed(2)} ${truth.w.toFixed(2)}x${truth.h.toFixed(2)}`;

    // Centre, not edges: the mask covers the head and upper torso rather than the whole layout
    // rect, so comparing edges would measure the fixture, not the library. A rotated, mirrored
    // or offset mask — which is what #8, #112 and #128 all produce — moves the centre.
    const centre = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
    const truthCentre = { x: truth.x + truth.w / 2, y: truth.y + truth.h / 2 };
    expect(
      Math.abs(centre.x - truthCentre.x),
      `subject centre drifted in x: ${report}`,
    ).toBeLessThan(GEOMETRY.CENTRE_TOLERANCE);
    expect(
      Math.abs(centre.y - truthCentre.y),
      `subject centre drifted in y: ${report}`,
    ).toBeLessThan(GEOMETRY.CENTRE_TOLERANCE);

    // And it stays within the region the subject was drawn into.
    const m = GEOMETRY.CONTAINMENT_MARGIN;
    expect(box.x, `mask extends left of the subject: ${report}`).toBeGreaterThan(truth.x - m);
    expect(box.y, `mask extends above the subject: ${report}`).toBeGreaterThan(truth.y - m);
    expect(box.x + box.w, `mask extends right of the subject: ${report}`).toBeLessThan(
      truth.x + truth.w + m,
    );
    expect(box.y + box.h, `mask extends below the subject: ${report}`).toBeLessThan(
      truth.y + truth.h + m,
    );

    expect(box.coverage, `implausible subject coverage: ${report}`).toBeGreaterThan(
      GEOMETRY.COVERAGE_MIN,
    );
    expect(box.coverage, `implausible subject coverage: ${report}`).toBeLessThan(
      GEOMETRY.COVERAGE_MAX,
    );
  });

  test('D5: the image is fetched once, however often the mode is re-entered', async ({ app }) => {
    const { page } = app;

    // Counting has to be in place before the page loads.
    let requests = 0;
    await page.route('**/bg-solid.png', (route) => {
      requests += 1;
      return route.continue();
    });

    await app.goto({ backdrop: 'flat', motion: 'static' });
    await startCamera(page);
    await attachProcessor(page);

    // Enter, leave and re-enter virtual-background three times with the same image path.
    for (let i = 0; i < 3; i += 1) {
      await switchMode(page, 'virtual-background');
      await switchMode(page, 'background-blur');
    }
    await switchMode(page, 'virtual-background');
    await sampleStable(page);

    // The effect must still be applied, or "no refetch" would be trivially true.
    const sample = await sampleProcessed(page, {
      ...VIRTUAL_BACKGROUND.COLOR,
      tolerance: VIRTUAL_BACKGROUND.TOLERANCE,
    });
    expect(sample.backgroundMatchRatio!).toBeGreaterThan(VIRTUAL_BACKGROUND.MATCH_RATIO_MIN);

    // Regression guard for #91, where backgroundImageAndPath was never assigned and every
    // re-entry hit the network. Note the cache holds one entry and is cleared by destroy(), so
    // this asserts only about repeated switches within a single processor session.
    expect(requests, `bg-solid.png was fetched ${requests} times`).toBe(1);
  });

  /**
   * The swap artifact test, the sibling of C1b.
   *
   * Replacing one virtual background with another must go straight from a frame carrying image A
   * to a frame carrying image B. Nothing blank, nothing green, and no raw camera showing through
   * — which is #105, where the outgoing plate was dropped the moment the swap was requested and
   * the incoming one only arrived once it had been fetched.
   *
   * The delay is the point. The gap between those two events is a network round trip, so on a
   * fast machine against a local dev server it is a couple of milliseconds and no frame lands
   * inside it; #105 was reported from slow machines. Holding the image response back by
   * BACKGROUND_SWAP.IMAGE_DELAY_MS widens that window to something like 24 frames, which is what
   * turns the bug from intermittent into deterministic.
   *
   * And as in C1b, polling with sample() could only show that no bad frame happened to be
   * observed, never that none was published — so every presented frame across the swap is
   * fingerprinted and classified against references captured from the settled state in this
   * same run.
   */
  test('D4: swapping the image publishes no frame without a background', async ({ app }) => {
    const { page } = app;

    /** Holds the incoming image back, and counts so the test can prove the delay applied. */
    let altRequests = 0;
    await page.route(`**${ALT_IMAGE}`, async (route) => {
      altRequests += 1;
      await new Promise((resolve) => setTimeout(resolve, BACKGROUND_SWAP.IMAGE_DELAY_MS));
      await route.fulfill({ response: await route.fetch() });
    });

    // Flat, static and already in virtual-background mode: the plate is then the only thing in
    // the background region, and attaching needs no further switch.
    await app.goto({ backdrop: 'flat', motion: 'static', mode: 'virtual-background' });
    await startCamera(page);
    await attachProcessor(page);
    await sampleStable(page);

    const referenceSolid = await recordedReference(page);

    // Record across the swap, driven by the real button, with the image response held back.
    //
    // This is the run's first and only load of bg-alt.png, deliberately: Chrome's renderer
    // keeps a decoded copy of an already-loaded image and hands it back to the next `new
    // Image()` with that src, no-store or not, so warming the image up first would mean the
    // measured swap resolved instantly and never saw the window the bug lives in.
    await page.evaluate(() => window.harness.probe.startRecording({ maxFrames: 300 }));
    await page.evaluate(() => window.harness.probe.waitForFrames(5, 10_000));

    const delivered = page.waitForResponse(`**${ALT_IMAGE}`, { timeout: 30_000 });
    await page.click(SWAP_BUTTON);
    await delivered;
    await page.evaluate(() => window.harness.probe.waitForFrames(8, 20_000));
    const frames = await page.evaluate(() => window.harness.probe.stopRecording());

    // The reference for B comes from the settled state after the swap, for the same reason
    // C1b takes both of its references from this run: the tolerances then only have to absorb
    // frame-to-frame noise, not variation between machines.
    await sampleStable(page);
    const settled = await sampleProcessed(page, {
      ...BACKGROUND_SWAP.ALT_COLOR,
      tolerance: VIRTUAL_BACKGROUND.TOLERANCE,
    });
    expect(settled.backgroundMatchRatio, 'the swap did not land on the new image').not.toBeNull();
    expect(settled.backgroundMatchRatio!).toBeGreaterThan(VIRTUAL_BACKGROUND.MATCH_RATIO_MIN);

    const referenceAlt = await recordedReference(page);

    expect(
      distance(referenceAlt, referenceSolid),
      `the two images are not distinguishable: ${describeFrame(referenceSolid)} vs ${describeFrame(referenceAlt)}`,
    ).toBeGreaterThan(1);

    // If the swap had been served from cache the handler would never have run, the delay would
    // never have applied, and everything below would assert about a window too short to catch
    // anything.
    expect(
      altRequests,
      'the swap did not go through the throttled route, so it was not delayed',
    ).toBe(1);

    const labelled = frames.map((frame) => {
      const dSolid = distance(frame, referenceSolid);
      const dAlt = distance(frame, referenceAlt);
      if (Math.min(dSolid, dAlt) > 1) return { frame, label: 'neither' as const };
      return { frame, label: dSolid <= dAlt ? ('solid' as const) : ('alt' as const) };
    });

    const timeline = labelled
      .map((f) => ({ solid: 'A', alt: 'B', neither: 'X' })[f.label])
      .join('');
    const diagnostics = [
      `swap ${SOLID_IMAGE} -> ${ALT_IMAGE}, response held ${BACKGROUND_SWAP.IMAGE_DELAY_MS}ms`,
      `reference A: ${describeFrame(referenceSolid)}`,
      `reference B: ${describeFrame(referenceAlt)}`,
      `timeline (A=solid, B=alt, X=neither): ${timeline}`,
      ...labelled
        .filter((f) => f.label === 'neither')
        .slice(0, 5)
        .map((f) => `  offending: ${describeFrame(f.frame)}`),
    ].join('\n');

    expect(frames.length, `too few frames captured\n${diagnostics}`).toBeGreaterThanOrEqual(
      SWITCH.MIN_FRAMES_EACH_SIDE * 2,
    );

    // The assertion the case exists for. A blanked plate, a green one or the raw camera all
    // land here, because none of them is within tolerance of either reference.
    const unclassified = labelled.filter((f) => f.label === 'neither');
    expect(unclassified.length, `frames published with neither image\n${diagnostics}`).toBe(
      BACKGROUND_SWAP.MAX_UNCLASSIFIED_FRAMES,
    );

    // Both images must actually appear, or the recording missed the swap and proved nothing.
    const before = labelled.filter((f) => f.label === 'solid').length;
    const after = labelled.filter((f) => f.label === 'alt').length;
    expect(before, `no frames of the outgoing image\n${diagnostics}`).toBeGreaterThanOrEqual(
      SWITCH.MIN_FRAMES_EACH_SIDE,
    );
    expect(after, `no frames of the incoming image\n${diagnostics}`).toBeGreaterThanOrEqual(
      SWITCH.MIN_FRAMES_EACH_SIDE,
    );

    // And the old plate holds for most of the wait rather than the pipeline stalling on a
    // single repeated frame: the delay has to have been spent publishing image A.
    expect(
      before,
      `the outgoing image was only held for ${before} frames\n${diagnostics}`,
    ).toBeGreaterThanOrEqual(BACKGROUND_SWAP.MIN_HELD_FRAMES);

    // The swap happens once: no flicking back to A after B has landed.
    const firstAlt = labelled.findIndex((f) => f.label === 'alt');
    const reverted = labelled.findIndex((f, i) => i > firstAlt && f.label === 'solid');
    expect(reverted, `the image reverted after the swap\n${diagnostics}`).toBe(-1);
  });
});
