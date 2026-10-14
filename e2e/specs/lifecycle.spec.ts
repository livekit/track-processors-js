import { expect, test } from '../fixtures';
import {
  attachProcessor,
  captureReference,
  colourDistance,
  diffFromReference,
  sampleProcessed,
  sampleSource,
  sampleStable,
  startCamera,
  switchMode,
} from '../helpers';
import { BLUR, MUTE_RESTORE, VIRTUAL_BACKGROUND } from '../thresholds';

/**
 * B1, B2, B6 — attaching, detaching, and surviving a mute.
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

  /**
   * B6 — issue #41: unmuting the camera brought the background back as a flat green plate
   * instead of the configured image.
   *
   * Mute here is `enabled = false` on the source MediaStreamTrack, which is what an
   * application does to a published camera and is not `stopVideo()`: the track stays live and
   * the processor stays attached, still pulling frames from a source that has gone black. The
   * bug was in what came back when real frames resumed, so the cycle has to be driven that way
   * rather than by tearing the track down and rebuilding it.
   *
   * `backdrop: 'flat'` because the assertion is a colour match against the plate, exactly as
   * D1 does it — the same VIRTUAL_BACKGROUND numbers are reused rather than redefined.
   */
  test('B6: muting and unmuting with a virtual background brings the image back', async ({
    app,
  }) => {
    const { page } = app;
    await app.goto({ backdrop: 'flat', motion: 'static' });

    await startCamera(page);
    await attachProcessor(page);
    await switchMode(page, 'virtual-background');
    await sampleStable(page);

    const expectPlate = {
      ...VIRTUAL_BACKGROUND.COLOR,
      tolerance: VIRTUAL_BACKGROUND.TOLERANCE,
    };

    // Establish the image is there to begin with, or "it came back" means nothing.
    const settled = await sampleProcessed(page, expectPlate);
    expect(
      settled.backgroundMatchRatio!,
      'the background image was never composited in the first place',
    ).toBeGreaterThan(VIRTUAL_BACKGROUND.MATCH_RATIO_MIN);

    await page.click('[data-testid="mute-video"]');
    await page.waitForFunction(() => window.harness.snapshot().videoMuted === true);
    await page.waitForTimeout(MUTE_RESTORE.MUTED_MS);

    // Recorded, not asserted on: a muted source is black on some paths and frozen on others,
    // and which one it is here is a fact about Chrome rather than about this library. It is
    // the negative control — the same measurement taken while the image is genuinely gone.
    const muted = await sampleProcessed(page, expectPlate);

    // The clock starts before the click, so the measured recovery includes the dispatch and
    // the handler, and errs towards being too slow rather than too fast.
    const startedAt = Date.now();
    await page.click('[data-testid="unmute-video"]');

    let restored = await sampleProcessed(page, expectPlate);
    let elapsedMs = Date.now() - startedAt;
    while (
      restored.backgroundMatchRatio! <= VIRTUAL_BACKGROUND.MATCH_RATIO_MIN &&
      elapsedMs < MUTE_RESTORE.MAX_RECOVERY_MS
    ) {
      restored = await sampleProcessed(page, expectPlate);
      elapsedMs = Date.now() - startedAt;
    }

    const bg = restored.regions.bg.mean;
    const report =
      `after ${elapsedMs}ms: match ${(restored.backgroundMatchRatio! * 100).toFixed(1)}%, ` +
      `bg mean rgb(${bg.r.toFixed(0)}, ${bg.g.toFixed(0)}, ${bg.b.toFixed(0)}) ` +
      `— while muted it was ${(muted.backgroundMatchRatio! * 100).toFixed(1)}% and ` +
      `rgb(${muted.regions.bg.mean.r.toFixed(0)}, ${muted.regions.bg.mean.g.toFixed(0)}, ` +
      `${muted.regions.bg.mean.b.toFixed(0)})`;

    expect(elapsedMs, `the image did not come back in time ${report}`).toBeLessThan(
      MUTE_RESTORE.MAX_RECOVERY_MS,
    );
    expect(
      restored.backgroundMatchRatio!,
      `the background is not the configured image ${report}`,
    ).toBeGreaterThan(VIRTUAL_BACKGROUND.MATCH_RATIO_MIN);

    // A high match ratio already excludes a flat plate, but only implicitly. Naming #41's
    // green and #111's black makes a regression say which one it is rather than only that the
    // ratio dropped.
    expect(
      colourDistance(bg, MUTE_RESTORE.GREEN_PLATE),
      `the background came back as #41's green plate ${report}`,
    ).toBeGreaterThan(MUTE_RESTORE.MIN_PLATE_DISTANCE);
    expect(
      colourDistance(bg, { r: 0, g: 0, b: 0 }),
      `the background came back black ${report}`,
    ).toBeGreaterThan(MUTE_RESTORE.MIN_PLATE_DISTANCE);

    // And the track is still the one that was muted, not a replacement: #41 was reported
    // against a published track, where a silent restart would have been a different bug.
    const snapshot = await page.evaluate(() => window.harness.snapshot());
    expect(snapshot.video?.readyState).toBe('live');
    expect(snapshot.videoMuted).toBe(false);
  });
});
