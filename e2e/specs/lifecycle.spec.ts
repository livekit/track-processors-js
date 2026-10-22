import { expect, test } from '../fixtures';
import {
  captureReference,
  diffFromReference,
  sampleProcessed,
  sampleSource,
  sampleStable,
  startCamera,
} from '../helpers';
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
    // The frame to come back to. `motion: 'static'` makes the camera deterministic, so after
    // detaching, the output should be this frame again rather than merely something like it.
    await captureReference(page, 'source');

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

    // Energy alone only says the detail came back, not that the *same* image did: a frame that
    // kept the blur but regained detail elsewhere would pass it. Compare against the frame
    // captured before attaching.
    const diff = await diffFromReference(page, 'processed');
    const report = `mean ${diff.meanAbsDiff.toFixed(2)}, max ${diff.maxAbsDiff}, matching ${(diff.matchingPixelRatio * 100).toFixed(2)}%`;
    expect(diff.matchingPixelRatio, `pixels unchanged after detach: ${report}`).toBeGreaterThan(
      BLUR.RESTORED_PIXEL_RATIO_MIN,
    );
    expect(diff.meanAbsDiff, `mean pixel difference after detach: ${report}`).toBeLessThan(
      BLUR.RESTORED_MEAN_DIFF_MAX,
    );

    // And the track is still live — a detach that stops the camera would also "restore" energy.
    const snapshot = await page.evaluate(() => window.harness.snapshot());
    expect(snapshot.video?.readyState).toBe('live');
  });

  // #136: Chrome caps live WebGL contexts per GPU process, so each detach has to release the one
  // its attach made instead of leaving it to GC.
  test('B3: every detach releases its WebGL context', async ({ app }) => {
    const { page } = app;
    await app.goto({ backdrop: 'checker', motion: 'static' });
    await startCamera(page);

    const before = await page.evaluate(() => window.harness.counters().webgl.contextsLost);
    const cycles = 3;
    for (let i = 0; i < cycles; i += 1) {
      await page.click('[data-testid="attach-processor"]');
      await page.waitForFunction(() => window.harness.snapshot().videoProcessorEnabled === true);
      await page.evaluate(() => window.harness.probe.waitForFrames(5, 25_000));
      await page.click('[data-testid="detach-processor"]');
      await page.waitForFunction(() => window.harness.snapshot().videoProcessorEnabled === false);
    }

    // The webglcontextlost event is dispatched as a task after loseContext(), hence the poll.
    await expect
      .poll(() => page.evaluate(() => window.harness.counters().webgl.contextsLost))
      .toBeGreaterThanOrEqual(before + cycles);
  });

  // #142: MediaPipe rejects a failed wasm-loader script with its DOM Event, which has no message.
  test('B4: a fileset that fails to load rejects with an Error naming its URL', async ({ app }) => {
    const { page } = app;
    await page.route('**/missing-wasm/**', (route) => route.fulfill({ status: 404 }));
    await app.goto({ backdrop: 'checker', motion: 'static', wasm: '/missing-wasm' });
    await startCamera(page);

    const err = await page.evaluate(() =>
      window.harness.media.setVideoProcessorEnabled(true).then(
        () => null,
        (e: unknown) => ({
          isError: e instanceof Error,
          message: String((e as Error).message),
        }),
      ),
    );
    expect(err, 'attaching with a missing fileset resolved').not.toBeNull();
    expect(err?.isError, 'rejection value is an Error').toBe(true);
    expect(err?.message).toContain('/missing-wasm/');
  });
});
