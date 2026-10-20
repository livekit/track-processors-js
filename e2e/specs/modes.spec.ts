import type { Page } from '@playwright/test';
import type { FrameFingerprint, ProcessorMode } from '../../examples/e2e/types';
import { expect, test } from '../fixtures';
import {
  attachProcessor,
  colourDistance,
  sampleProcessed,
  sampleSource,
  sampleStable,
  startCamera,
  switchMode,
} from '../helpers';
import {
  BLUR,
  FALSY_OPTIONS,
  PASSTHROUGH,
  SWITCH,
  TEXTURE_RELEASE,
  VIRTUAL_BACKGROUND,
} from '../thresholds';

const BUTTON: Record<ProcessorMode, string> = {
  'background-blur': '[data-testid="switch-blur"]',
  'virtual-background': '[data-testid="switch-virtual"]',
  disabled: '[data-testid="switch-disabled"]',
};

/** The second plate the harness ships, flat #00FFFF. C2 uses it as a distinguishable successor. */
const ALT_IMAGE = '/bg-alt.png';

/**
 * "Swap bg image" — re-enters virtual-background with the other image.
 *
 * It moves to bg-alt.png while the current image is the configured one, which is the only
 * direction C2 needs.
 */
const SWAP_BUTTON = '[data-testid="set-background"]';

/**
 * Captures a fingerprint of the settled output.
 *
 * Recorded rather than sampled, because `sample()` works at a different resolution than the
 * recorder and blur energy is resolution-dependent — a reference taken one way could not be
 * compared against frames captured the other.
 */
async function captureReference(page: Page): Promise<FrameFingerprint> {
  await page.evaluate(() => window.harness.probe.startRecording({ maxFrames: 30 }));
  await page.evaluate(() => window.harness.probe.waitForFrames(10, 20_000));
  const frames = await page.evaluate(() => window.harness.probe.stopRecording());
  expect(frames.length, 'no frames recorded for the reference').toBeGreaterThan(0);
  return frames[frames.length - 1];
}

/** Normalized distance from a reference. <= 1 means "this frame shows that treatment". */
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

test.describe('mode switching', () => {
  test('C1: blur to virtual background lands in the right state', async ({ app }) => {
    const { page } = app;
    await app.goto({ backdrop: 'checker', motion: 'static' });
    await startCamera(page);
    await attachProcessor(page);

    await page.click(BUTTON['virtual-background']);
    await page.waitForFunction(() => window.harness.snapshot().mode === 'virtual-background');
    await page.evaluate(() => window.harness.probe.waitForFrames(10, 25_000));
    await sampleStable(page);

    const sample = await sampleProcessed(page, {
      ...VIRTUAL_BACKGROUND.COLOR,
      tolerance: VIRTUAL_BACKGROUND.TOLERANCE,
    });
    expect(sample.backgroundMatchRatio).not.toBeNull();
    expect(sample.backgroundMatchRatio!).toBeGreaterThan(VIRTUAL_BACKGROUND.MATCH_RATIO_MIN);
  });

  test('C3: disabled mode is true passthrough', async ({ app }) => {
    const { page } = app;
    await app.goto({ backdrop: 'checker', motion: 'static' });
    await startCamera(page);
    // Sampled before attaching, and that ordering is load-bearing. `setProcessor` leaves
    // `LocalVideoTrack.mediaStreamTrack` pointing at the processed track, so a 'source' sample
    // taken after attach returns treated frames — measured identical, hash and all, to
    // `sampleProcessed()`. Taken that way the ratio below compares passthrough against a
    // *blurred* baseline, reads 4.14 rather than 1.0, and still clears the floor when
    // `disabled` leaves the blur on. Which is to say it would pass whatever happened.
    const source = await sampleSource(page);

    await attachProcessor(page);
    await switchMode(page, 'disabled');
    await sampleStable(page);
    const passed = await sampleProcessed(page);

    expect(colourDistance(passed.regions.bg.mean, source.regions.bg.mean)).toBeLessThan(
      PASSTHROUGH.MEAN_TOLERANCE,
    );
    expect(colourDistance(passed.regions.fg.mean, source.regions.fg.mean)).toBeLessThan(
      PASSTHROUGH.MEAN_TOLERANCE,
    );
    // Detail must survive: a "disabled" mode that still blurred would pass a mean-only check.
    const energyRatio = passed.regions.bg.blurEnergy / source.regions.bg.blurEnergy;
    expect(
      energyRatio,
      `passthrough energy ${passed.regions.bg.blurEnergy.toFixed(4)} vs source ${source.regions.bg.blurEnergy.toFixed(4)}`,
    ).toBeGreaterThan(PASSTHROUGH.ENERGY_RATIO_MIN);
  });

  /**
   * The artifact test.
   *
   * Every published frame must carry either the old treatment or the new one. Not a grey flash
   * (#96), not a green plate (#41), not a black frame (#111), not the raw camera showing
   * through (#85) — and not a frame that flips back after the switch has taken effect.
   *
   * Polling with sample() cannot prove this: it would only show that no bad frame happened to be
   * observed. So every presented frame across the transition is fingerprinted, and each is
   * classified against references captured from the settled state in this same run.
   */
  const transitions: Array<[ProcessorMode, ProcessorMode]> = [
    ['background-blur', 'virtual-background'],
    ['virtual-background', 'background-blur'],
    ['background-blur', 'disabled'],
  ];

  for (const [from, to] of transitions) {
    test(`C1b: ${from} to ${to} publishes no intermediate frame`, async ({ app }) => {
      const { page } = app;
      await app.goto({ backdrop: 'checker', motion: 'static' });
      await startCamera(page);
      await attachProcessor(page);

      // References for both treatments, from this run and this machine, so the tolerances only
      // have to absorb frame-to-frame noise.
      await switchMode(page, from);
      await sampleStable(page);
      const referenceFrom = await captureReference(page);

      await switchMode(page, to);
      await sampleStable(page);
      const referenceTo = await captureReference(page);

      expect(
        distance(referenceTo, referenceFrom),
        `the two modes are not distinguishable: ${describeFrame(referenceFrom)} vs ${describeFrame(referenceTo)}`,
      ).toBeGreaterThan(1);

      await switchMode(page, from);
      await sampleStable(page);

      // Record across the switch, driving it through the real button.
      await page.evaluate(() => window.harness.probe.startRecording({ maxFrames: 300 }));
      await page.evaluate(() => window.harness.probe.waitForFrames(5, 10_000));
      await page.click(BUTTON[to]);
      await page.waitForFunction((expected) => window.harness.snapshot().mode === expected, to, {
        timeout: 25_000,
      });
      await page.evaluate(() => window.harness.probe.waitForFrames(8, 20_000));
      const frames = await page.evaluate(() => window.harness.probe.stopRecording());

      const labelled = frames.map((frame) => {
        const dFrom = distance(frame, referenceFrom);
        const dTo = distance(frame, referenceTo);
        const best = Math.min(dFrom, dTo);
        if (best > 1) return { frame, label: 'neither' as const };
        return { frame, label: dFrom <= dTo ? ('from' as const) : ('to' as const) };
      });

      const timeline = labelled
        .map((f) => ({ from: 'F', to: 'T', neither: 'X' })[f.label])
        .join('');
      const diagnostics = [
        `transition ${from} -> ${to}`,
        `reference ${from}: ${describeFrame(referenceFrom)}`,
        `reference ${to}:   ${describeFrame(referenceTo)}`,
        `timeline (F=${from}, T=${to}, X=neither): ${timeline}`,
        ...labelled
          .filter((f) => f.label === 'neither')
          .slice(0, 5)
          .map((f) => `  offending: ${describeFrame(f.frame)}`),
      ].join('\n');

      expect(frames.length, `too few frames captured\n${diagnostics}`).toBeGreaterThanOrEqual(
        SWITCH.MIN_FRAMES_EACH_SIDE * 2,
      );

      const unclassified = labelled.filter((f) => f.label === 'neither');
      expect(unclassified.length, `intermediate frames published\n${diagnostics}`).toBe(
        SWITCH.MAX_UNCLASSIFIED_FRAMES,
      );

      // Both sides must actually be present, or the recording missed the switch entirely and
      // the assertion above proved nothing.
      const beforeCount = labelled.filter((f) => f.label === 'from').length;
      const afterCount = labelled.filter((f) => f.label === 'to').length;
      expect(beforeCount, `no frames of the old treatment\n${diagnostics}`).toBeGreaterThanOrEqual(
        SWITCH.MIN_FRAMES_EACH_SIDE,
      );
      expect(afterCount, `no frames of the new treatment\n${diagnostics}`).toBeGreaterThanOrEqual(
        SWITCH.MIN_FRAMES_EACH_SIDE,
      );

      // And the change happens once: no flipping back after it has taken effect.
      const firstTo = labelled.findIndex((f) => f.label === 'to');
      const revertedAt = labelled.findIndex((f, i) => i > firstTo && f.label === 'from');
      expect(revertedAt, `treatment reverted after switching\n${diagnostics}`).toBe(-1);
    });
  }

  /**
   * C7 — a falsy option value is an instruction, not a missing argument.
   *
   * #37: option updates were merged behind `if (opts.x)` style guards, so `blurRadius: 0` and
   * `imagePath: undefined` were indistinguishable from "caller said nothing about this" and the
   * effect stayed on. Both are the only way to turn an effect off without changing mode, and
   * both go through `updateTransformerOptions` — which is why these drive that call directly
   * rather than a button: `switchTo()`, and every control built on it, substitutes a default for
   * anything a mode leaves out and so can never carry a falsy value through.
   */
  test('C7: blurRadius 0 clears the blur', async ({ app }) => {
    /**
     * Currently broken, in a different way than #37 described.
     *
     * `blurRadius: 0` now reaches the GL layer — `setBlurRadius(0)` stores null, since zero is
     * falsy there too — but nothing then puts the camera back behind the subject: the composite
     * keeps using the (cleared) background texture, so the output is the subject over black.
     * Measured bg energy 0.0030 against a raw 0.0700, i.e. flatter than the blur it replaced.
     *
     * So the assertion below is what the API promises, and Playwright will report this test as
     * unexpectedly passing once that is fixed — which is the signal to drop this annotation.
     */
    test.fail();

    const { page } = app;
    await app.goto({ backdrop: 'checker', motion: 'static' });
    await startCamera(page);

    // Before attaching: `setProcessor` swaps the track's own mediaStreamTrack for the processed
    // one, so once a processor is running the 'source' probe reads the treated frame too.
    const source = await sampleSource(page);

    await attachProcessor(page);
    await sampleStable(page);
    const blurred = await sampleProcessed(page);

    // Precondition: the blur is on, or "clearing it" would assert nothing.
    const reduction = 1 - blurred.regions.bg.blurEnergy / source.regions.bg.blurEnergy;
    expect(
      reduction,
      `blur never took effect: ${blurred.regions.bg.blurEnergy.toFixed(4)}`,
    ).toBeGreaterThan(BLUR.MIN_REDUCTION);

    await page.evaluate(() => window.harness.media.updateTransformerOptions({ blurRadius: 0 }));
    await page.evaluate(() => window.harness.probe.waitForFrames(10, 25_000));
    await sampleStable(page);
    const cleared = await sampleProcessed(page);

    const ratio = cleared.regions.bg.blurEnergy / source.regions.bg.blurEnergy;
    expect(
      ratio,
      `radius 0 did not restore the camera background: source ${source.regions.bg.blurEnergy.toFixed(4)}, ` +
        `blurred ${blurred.regions.bg.blurEnergy.toFixed(4)}, cleared ${cleared.regions.bg.blurEnergy.toFixed(4)}`,
    ).toBeGreaterThan(FALSY_OPTIONS.CLEARED_ENERGY_RATIO_MIN);
  });

  test('C7b: imagePath undefined clears the virtual background', async ({ app }) => {
    const { page } = app;
    await app.goto({ backdrop: 'checker', motion: 'static' });
    await startCamera(page);

    // Sampled before attaching, for the reason given in C7 above.
    const source = await sampleSource(page);

    await attachProcessor(page);
    await switchMode(page, 'virtual-background');
    await sampleStable(page);

    const expectPlate = { ...VIRTUAL_BACKGROUND.COLOR, tolerance: VIRTUAL_BACKGROUND.TOLERANCE };
    const composited = await sampleProcessed(page, expectPlate);

    // Precondition, as above: the plate has to be there before clearing it means anything.
    expect(composited.backgroundMatchRatio).not.toBeNull();
    expect(composited.backgroundMatchRatio!).toBeGreaterThan(VIRTUAL_BACKGROUND.MATCH_RATIO_MIN);

    await page.evaluate(() =>
      window.harness.media.updateTransformerOptions({ imagePath: undefined }),
    );
    await page.evaluate(() => window.harness.probe.waitForFrames(10, 25_000));
    await sampleStable(page);
    const cleared = await sampleProcessed(page, expectPlate);

    const report =
      `plate match ${composited.backgroundMatchRatio!.toFixed(3)} -> ${cleared.backgroundMatchRatio!.toFixed(3)}, ` +
      `bg energy source ${source.regions.bg.blurEnergy.toFixed(4)}, ` +
      `composited ${composited.regions.bg.blurEnergy.toFixed(4)}, cleared ${cleared.regions.bg.blurEnergy.toFixed(4)}`;

    expect(cleared.backgroundMatchRatio!, `the plate is still there: ${report}`).toBeLessThan(
      FALSY_OPTIONS.CLEARED_MATCH_RATIO_MAX,
    );

    // The plate being gone is not the same as the camera being back: a black or frozen frame
    // would also stop matching magenta. The checker detail returning is what says the background
    // is camera content again.
    const ratio = cleared.regions.bg.blurEnergy / source.regions.bg.blurEnergy;
    expect(ratio, `the camera background did not return: ${report}`).toBeGreaterThan(
      FALSY_OPTIONS.CLEARED_ENERGY_RATIO_MIN,
    );
  });

  /**
   * C2 — the reverse of C1, and what that switch leaves behind.
   *
   * The "no bad frame in this direction" half is already C1b's: it parameterises over
   * `virtual-background -> background-blur` and asserts zero unclassified frames across it. So
   * the landing state is asserted here cheaply, and the effort goes into the half nothing else
   * covers — whether leaving virtual-background releases the background image, or leaves the
   * plate sitting in the GL texture it was uploaded to.
   *
   * It cannot be read off GL state from the page, so it is observed by its consequence. Once
   * the switch to blur has settled, the spec goes back to virtual-background with a *different*
   * image (bg-alt.png, cyan) and holds that image's response back. `BackgroundTransformer.update`
   * clears the blur radius synchronously and only then awaits the new image, so for the whole of
   * that window the compositor is in "custom background, nothing blurring" state and renders
   * whatever is still in `bgTexture`. Released, that window shows the empty placeholder;
   * retained, it shows bg-solid.png — the magenta plate the user already navigated away from.
   *
   * Guards [#85](https://github.com/livekit/track-processors-js/issues/85): the background the
   * caller no longer asked for must not come back.
   */
  test('C2: virtual background to blur releases the background image texture', async ({ app }) => {
    /**
     * Currently broken, and the same root cause D4 ran into from the other side.
     *
     * `setBackgroundImage(null)` — which is what both `switchTo({ mode: 'background-blur' })` and
     * `setBlurRadius()` reach — nulls `customBackgroundImage` and `backgroundSourceImage` but
     * never writes to `bgTexture`. The plate stays uploaded, unused while a blur radius is set,
     * and composites again the moment the pipeline is back in "custom background, nothing
     * blurring" state. Observed 25 frames of the abandoned magenta plate, bg=(254,1,254) at
     * energy 0.0063 — byte-identical to the reference captured before the switch.
     *
     * So the assertion below is what leaving a mode ought to mean, and Playwright will report
     * this test as unexpectedly passing once that is fixed, which is the signal to drop this
     * annotation. The fix is not simply clearing the texture here: TEXTURE_RELEASE records why
     * that reintroduces #105, which D4 guards.
     */
    test.fail();

    const { page } = app;

    // Widens the window a retained texture would be visible in. Counted, so the spec can prove
    // the delay actually applied rather than the image arriving from cache.
    let altRequests = 0;
    await page.route(`**${ALT_IMAGE}`, async (route) => {
      altRequests += 1;
      await new Promise((resolve) => setTimeout(resolve, TEXTURE_RELEASE.PROBE_IMAGE_DELAY_MS));
      await route.fulfill({ response: await route.fetch() });
    });

    await app.goto({ backdrop: 'checker', motion: 'static', mode: 'virtual-background' });
    await startCamera(page);

    // Before attaching: `setProcessor` repoints the track's mediaStreamTrack at the processed
    // track, so a 'source' sample taken afterwards returns treated frames.
    const source = await sampleSource(page);

    await attachProcessor(page);
    await sampleStable(page);

    const expectPlate = { ...VIRTUAL_BACKGROUND.COLOR, tolerance: VIRTUAL_BACKGROUND.TOLERANCE };
    const plated = await sampleProcessed(page, expectPlate);
    expect(plated.backgroundMatchRatio, 'the virtual background never came up').not.toBeNull();
    expect(plated.backgroundMatchRatio!).toBeGreaterThan(VIRTUAL_BACKGROUND.MATCH_RATIO_MIN);
    const referencePlate = await captureReference(page);

    // The switch under test, through the real button.
    await page.click(BUTTON['background-blur']);
    await page.waitForFunction(() => window.harness.snapshot().mode === 'background-blur');
    await page.evaluate(() => window.harness.probe.waitForFrames(10, 25_000));
    await sampleStable(page);

    // C1's assertions, in reverse: the switch has to land on a working blur, not merely report
    // the new mode.
    const blurred = await sampleProcessed(page, expectPlate);
    const reduction = 1 - blurred.regions.bg.blurEnergy / source.regions.bg.blurEnergy;
    expect(
      reduction,
      `blur did not take effect: raw ${source.regions.bg.blurEnergy.toFixed(4)} -> ${blurred.regions.bg.blurEnergy.toFixed(4)}`,
    ).toBeGreaterThan(BLUR.MIN_REDUCTION);
    expect(
      blurred.regions.fg.blurEnergy / blurred.regions.bg.blurEnergy,
      `subject is not sharper than the background: fg ${blurred.regions.fg.blurEnergy.toFixed(4)}, bg ${blurred.regions.bg.blurEnergy.toFixed(4)}`,
    ).toBeGreaterThan(BLUR.FG_OVER_BG_MIN);
    expect(
      blurred.backgroundMatchRatio!,
      'the magenta plate is still composited after switching to blur',
    ).toBeLessThan(FALSY_OPTIONS.CLEARED_MATCH_RATIO_MAX);

    const referenceBlur = await captureReference(page);
    expect(
      distance(referenceBlur, referencePlate),
      `plate and blur are not distinguishable: ${describeFrame(referencePlate)} vs ${describeFrame(referenceBlur)}`,
    ).toBeGreaterThan(1);

    // Return to virtual-background with the other image, with its response held back, and
    // fingerprint every frame published while the pipeline waits for it.
    await page.evaluate(() => window.harness.probe.startRecording({ maxFrames: 300 }));
    await page.evaluate(() => window.harness.probe.waitForFrames(5, 10_000));
    const delivered = page.waitForResponse(`**${ALT_IMAGE}`, { timeout: 30_000 });
    await page.click(SWAP_BUTTON);
    await delivered;
    await page.evaluate(() => window.harness.probe.waitForFrames(8, 20_000));
    const frames = await page.evaluate(() => window.harness.probe.stopRecording());

    const stale = frames.filter((frame) => distance(frame, referencePlate) <= 1);
    const timeline = frames
      .map((frame) => {
        if (distance(frame, referencePlate) <= 1) return 'S';
        if (distance(frame, referenceBlur) <= 1) return 'B';
        return '.';
      })
      .join('');
    const diagnostics = [
      `reference bg-solid plate: ${describeFrame(referencePlate)}`,
      `reference blur:           ${describeFrame(referenceBlur)}`,
      `timeline (S=old plate, B=blur, .=other): ${timeline}`,
      ...stale.slice(0, 5).map((frame) => `  stale: ${describeFrame(frame)}`),
    ].join('\n');

    // If the swap had been served from cache the delay would never have applied and the window
    // the stale texture is visible in would have been too short to land on any frame.
    expect(altRequests, 'the new image did not go through the throttled route').toBe(1);
    expect(frames.length, `too few frames captured\n${diagnostics}`).toBeGreaterThanOrEqual(
      TEXTURE_RELEASE.MIN_PROBE_FRAMES,
    );

    expect(
      stale.length,
      `the background image was still bound after switching away from it\n${diagnostics}`,
    ).toBe(TEXTURE_RELEASE.MAX_STALE_PLATE_FRAMES);
  });
});
