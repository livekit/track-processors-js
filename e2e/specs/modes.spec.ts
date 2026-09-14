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
import { PASSTHROUGH, SWITCH, VIRTUAL_BACKGROUND } from '../thresholds';

const BUTTON: Record<ProcessorMode, string> = {
  'background-blur': '[data-testid="switch-blur"]',
  'virtual-background': '[data-testid="switch-virtual"]',
  disabled: '[data-testid="switch-disabled"]',
};

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
    await attachProcessor(page);

    const source = await sampleSource(page);
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
      await page.waitForFunction(
        (expected) => window.harness.snapshot().mode === expected,
        to,
        { timeout: 25_000 },
      );
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
});
