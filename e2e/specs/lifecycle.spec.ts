import { expect, test } from '../fixtures';
import { sampleProcessed, sampleSource, sampleStable, startCamera } from '../helpers';
import { BLUR } from '../thresholds';

/**
 * B1, B2 — attaching and detaching the processor.
 *
 * Driven through the real buttons rather than the API, because the point is that the whole path
 * works, and because every one of the filed lifecycle bugs surfaced through ordinary use.
 *
 * The clean-console assertion these tests depend on lives in the `app` fixture and runs after
 * every test, so #47's "Empty video frame" and #89's "InvalidStateError: Stream closed" are
 * caught here without either spec mentioning them.
 */
test.describe('processor lifecycle', () => {
  test('B1: attaching blur produces live, blurred frames', async ({ app }) => {
    const { page } = app;
    await app.goto({ backdrop: 'checker', motion: 'static' });

    await startCamera(page);
    const raw = await sampleSource(page);
    expect(
      raw.regions.bg.blurEnergy,
      'the checker backdrop should carry high-frequency detail to blur away',
    ).toBeGreaterThan(BLUR.RAW_BG_ENERGY_MIN);

    await page.click('[data-testid="attach-processor"]');
    await page.waitForFunction(() => window.harness.snapshot().videoProcessorEnabled === true);

    // Frames must actually be flowing, not merely a canvas that looks painted.
    const flow = await page.evaluate(() => window.harness.probe.waitForFrames(15, 25_000));
    expect(flow.presented).toBeGreaterThanOrEqual(15);

    const blurred = await sampleStable(page);
    const reduction = 1 - blurred.regions.bg.blurEnergy / raw.regions.bg.blurEnergy;
    expect(
      reduction,
      `background energy ${raw.regions.bg.blurEnergy.toFixed(4)} -> ${blurred.regions.bg.blurEnergy.toFixed(4)}`,
    ).toBeGreaterThan(BLUR.MIN_REDUCTION);

    // Segmentation is doing its job when the subject stays sharper than its background. Without
    // this, a processor that simply blurred the entire frame would pass the assertion above.
    const sharpness = blurred.regions.fg.blurEnergy / blurred.regions.bg.blurEnergy;
    expect(
      sharpness,
      `fg ${blurred.regions.fg.blurEnergy.toFixed(4)} vs bg ${blurred.regions.bg.blurEnergy.toFixed(4)}`,
    ).toBeGreaterThan(BLUR.FG_OVER_BG_MIN);
  });

  test('B2: detaching restores the unprocessed frames', async ({ app }) => {
    const { page } = app;
    await app.goto({ backdrop: 'checker', motion: 'static' });

    await startCamera(page);
    const raw = await sampleSource(page);

    await page.click('[data-testid="attach-processor"]');
    await page.waitForFunction(() => window.harness.snapshot().videoProcessorEnabled === true);
    await page.evaluate(() => window.harness.probe.waitForFrames(15, 25_000));
    const blurred = await sampleStable(page);
    expect(blurred.regions.bg.blurEnergy).toBeLessThan(raw.regions.bg.blurEnergy);

    await page.click('[data-testid="detach-processor"]');
    await page.waitForFunction(() => window.harness.snapshot().videoProcessorEnabled === false);
    await page.evaluate(() => window.harness.probe.waitForFrames(10, 25_000));

    const restored = await sampleProcessed(page);
    const ratio = restored.regions.bg.blurEnergy / raw.regions.bg.blurEnergy;
    expect(
      ratio,
      `background energy after detach ${restored.regions.bg.blurEnergy.toFixed(4)} vs raw ${raw.regions.bg.blurEnergy.toFixed(4)}`,
    ).toBeGreaterThan(BLUR.RESTORED_RATIO_MIN);

    // And the track is still live — a detach that stops the camera would also "restore" energy.
    const snapshot = await page.evaluate(() => window.harness.snapshot());
    expect(snapshot.video?.readyState).toBe('live');
  });
});
