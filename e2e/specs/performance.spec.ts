import { expect, test } from '../fixtures';
import { attachProcessor, startCamera } from '../helpers';
import { PERFORMANCE } from '../thresholds';

/**
 * G1 — the stats reported through onFrameProcessed.
 *
 * Performance complaints against this library arrive as "it got slow after updating" and are
 * impossible to adjudicate without numbers. This establishes that the numbers exist, are
 * internally consistent, and clear a floor.
 */
test.describe('frame processing stats', () => {
  test('G1: onFrameProcessed reports coherent timings at a usable frame rate', async ({ app }) => {
    const { page } = app;
    await app.goto({ backdrop: 'checker', motion: 'pan' });

    await startCamera(page);
    await attachProcessor(page);

    // Discard the warm-up: the first frame is deliberately a passthrough clone, and the
    // segmenter's first inference is far slower than its steady state.
    await page.evaluate(() => window.harness.resetStats());
    await page.evaluate(
      (frames) => window.harness.probe.waitForFrames(frames, 40_000),
      PERFORMANCE.SAMPLE_FRAMES,
    );

    const stats = await page.evaluate(() => window.harness.stats());
    const env = await page.evaluate(() => window.harness.env());
    const report = `${JSON.stringify(stats)} renderer=${env.renderer}`;

    expect(stats.frames, `too few frames recorded: ${report}`).toBeGreaterThanOrEqual(
      PERFORMANCE.SAMPLE_FRAMES / 2,
    );
    expect(stats.fps, `frame rate below floor: ${report}`).toBeGreaterThan(PERFORMANCE.MIN_FPS);

    for (const key of ['processingMs', 'segmentationMs', 'filterMs'] as const) {
      expect(Number.isFinite(stats[key].p50), `${key} is not finite: ${report}`).toBe(true);
      expect(stats[key].p50, `${key} should be positive: ${report}`).toBeGreaterThan(0);
    }

    // processingTimeMs is reported as segmentation + filter; if that stops holding, the stat
    // has silently changed meaning.
    expect(stats.processingMs.p50).toBeCloseTo(
      stats.segmentationMs.p50 + stats.filterMs.p50,
      0,
    );

    // Segmentation runs on the mediapipe delegate, not our WebGL path, and holds near 3ms on
    // both hardware and software renderers.
    expect(
      stats.segmentationMs.p50,
      `segmentation slower than expected: ${report}`,
    ).toBeLessThan(PERFORMANCE.MAX_P50_SEGMENTATION_MS);

    // The filter step is WebGL and is meaningless to time on a software rasterizer: the same
    // work measures ~2ms on a GPU and ~58ms on SwiftShader. Assert it only where the number
    // says something about the library.
    if (env.softwareRenderer) {
      test.info().annotations.push({
        type: 'notice',
        description: `software renderer (${env.renderer}) — skipped the frame-time assertion; observed p50 ${stats.processingMs.p50.toFixed(1)}ms`,
      });
      return;
    }

    expect(
      stats.processingMs.p50,
      `median processing time too high to sustain 30fps: ${report}`,
    ).toBeLessThan(PERFORMANCE.MAX_P50_PROCESSING_MS);
  });
});
