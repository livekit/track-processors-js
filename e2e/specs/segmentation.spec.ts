import type { TemporalStability } from '../../examples/e2e/types';
import { expect, test } from '../fixtures';
import { attachProcessor, startCamera } from '../helpers';
import { SEGMENTATION, VIRTUAL_BACKGROUND } from '../thresholds';

function describe(label: string, stability: TemporalStability) {
  return [
    `${label}: flipRate=${(stability.flipRate * 100).toFixed(3)}%`,
    `peak=${(stability.maxFlipRate * 100).toFixed(3)}%`,
    `everFlipped=${(stability.unstablePixelRatio * 100).toFixed(3)}%`,
    `fg=${(stability.foregroundRatio * 100).toFixed(1)}%`,
    `over ${stability.transitions} transitions at ${stability.width}x${stability.height}`,
  ].join(' ');
}

test.describe('segmentation quality', () => {
  /**
   * H2 — temporal stability on a static input.
   *
   * The most-upvoted complaint in the tracker is that mask edges shimmer and crawl on a subject
   * that is not moving (#76, #98). This is that complaint as a number, and the metric any future
   * smoothing work would be judged by.
   *
   * `motion=static` redraws byte-identical pixels on every compositor tick, so with a flat
   * virtual background in place every pixel that changes side between two consecutive *output*
   * frames is the segmenter changing its mind — there is no input change left to blame it on.
   * The result is a fraction of the frame rather than a count, so it does not move with
   * resolution.
   *
   * The second measurement is the control. Under `motion=pan` the subject really does move, and
   * the same measurement must report a materially higher rate: one that stayed small whatever
   * the input did would pass the first assertion while proving nothing.
   */
  test('H2: a static subject does not make the mask flicker', async ({ app }) => {
    const { page } = app;
    await app.goto({ backdrop: 'flat', motion: 'static' });
    await startCamera(page);
    await attachProcessor(page);

    // A flat plate behind the subject is what makes foreground and background separable by
    // colour, so what is measured is the mask rather than the backdrop.
    await page.click('[data-testid="switch-virtual"]');
    await page.waitForFunction(
      () => window.harness.snapshot().mode === 'virtual-background',
      null,
      {
        timeout: 25_000,
      },
    );
    await page.evaluate(() => window.harness.probe.waitForFrames(15, 25_000));

    const measure = () =>
      page.evaluate((opts) => window.harness.probe.measureTemporalStability(opts), {
        frames: SEGMENTATION.SAMPLE_FRAMES,
        background: { ...VIRTUAL_BACKGROUND.COLOR, tolerance: VIRTUAL_BACKGROUND.TOLERANCE },
        timeoutMs: 30_000,
      });

    await page.evaluate(() => window.harness.resetStats());
    const still = await measure();
    const stats = await page.evaluate(() => window.harness.stats());

    // The subject moves, and the measurement has to notice. Driven through the harness rather
    // than a reload: re-attaching the processor would leak another WebGL context (#136).
    await page.evaluate(() => window.harness.camera.setMotion('pan'));
    await page.evaluate(() => window.harness.probe.waitForFrames(15, 25_000));
    const moving = await measure();

    const diagnostics = [
      describe('static', still),
      describe('pan   ', moving),
      `segmenter: ${stats.frames} frames, segmentationMs p50 ${stats.segmentationMs.p50.toFixed(2)}`,
    ].join('\n');

    // Zero flips is also what a frozen pipeline reports, so first establish there was something
    // to flip: a subject was segmented, and the segmenter ran at least once per frame measured
    // rather than the track repeating one cached result.
    expect(still.foregroundRatio, `no subject segmented\n${diagnostics}`).toBeGreaterThan(
      SEGMENTATION.FOREGROUND_RATIO_MIN,
    );
    expect(still.foregroundRatio, `frame is all foreground\n${diagnostics}`).toBeLessThan(
      SEGMENTATION.FOREGROUND_RATIO_MAX,
    );
    expect(
      still.transitions,
      `too few frames to judge stability\n${diagnostics}`,
    ).toBeGreaterThanOrEqual(SEGMENTATION.MIN_TRANSITIONS);
    expect(stats.frames, `fewer frames segmented than measured\n${diagnostics}`).toBeGreaterThan(
      still.transitions,
    );
    expect(
      stats.segmentationMs.p50,
      `segmentation reported no work\n${diagnostics}`,
    ).toBeGreaterThan(0);

    expect(still.flipRate, `mask flickers on a static input\n${diagnostics}`).toBeLessThan(
      SEGMENTATION.MAX_STATIC_FLIP_RATE,
    );
    expect(still.maxFlipRate, `a single frame flickered badly\n${diagnostics}`).toBeLessThan(
      SEGMENTATION.MAX_STATIC_PEAK_FLIP_RATE,
    );

    expect(
      moving.flipRate,
      `the measurement does not respond to a moving subject, so the static result means nothing\n${diagnostics}`,
    ).toBeGreaterThan(SEGMENTATION.MIN_MOVING_FLIP_RATE);
  });
});
