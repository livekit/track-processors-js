import { expect, test } from '../fixtures';
import { captureReference, diffFromReference, sampleSource, sampleStable } from '../helpers';
import { BLUR, CAPTURE_TIME } from '../thresholds';

/**
 * B5 — handing the processor to `createLocalVideoTrack` instead of calling `setProcessor`.
 *
 * `VideoCaptureOptions.processor` is honoured inside `createLocalTracks`, so an integration can
 * have the effect running from the first published frame rather than attaching it afterwards.
 * [#50](https://github.com/livekit/track-processors-js/issues/50) is that route failing with
 * `DataCloneError: a TransformStream could not be cloned` — the insertable-streams transform
 * being structured-cloned across a worker boundary while the track is still being created. It
 * is an exception rather than a pixel artifact, so the first thing this case asserts is that
 * track creation succeeds and no such error reaches the console, `pageerror` or the harness log.
 * The string is in `FORBIDDEN_CONSOLE` as well, so a regression is caught suite-wide.
 *
 * Creation succeeding is not enough on its own — a track created with the processor silently
 * dropped would also "succeed" — so the blur is then measured against a raw baseline, and the
 * output compared against the same effect attached the ordinary way on the same page.
 *
 * The page is loaded with `?attach=capture`, which is what makes the `start-video` button route
 * through `createLocalVideoTrack({ processor })`. That click is the behaviour under test; both
 * unprocessed camera starts around it are setup and go through the harness API.
 */
test.describe('capture-time attachment', () => {
  test('B5: a processor passed at capture time produces a processed track', async ({ app }) => {
    const { page } = app;
    await app.goto({ attach: 'capture', backdrop: 'checker', motion: 'static' });

    // The raw baseline has to be taken before any processor exists on the track: once one is
    // attached `LocalVideoTrack.mediaStreamTrack` *is* the processed track, so `sampleSource()`
    // would return treated frames and the comparison below could not fail. On this page the
    // camera would come up processed, so it is started explicitly unprocessed and stopped again.
    await page.evaluate(() => window.harness.media.startVideo({ processorAtCapture: false }));
    const raw = await sampleSource(page);
    expect(
      raw.regions.bg.blurEnergy,
      'the checker backdrop should carry high-frequency detail to blur away',
    ).toBeGreaterThan(BLUR.RAW_BG_ENERGY_MIN);
    const webglBefore = await page.evaluate(() => window.harness.counters().webgl.created);
    await page.evaluate(() => window.harness.media.stopVideo());

    // #50: this is the call that threw. A rejection here surfaces as an ERROR line in the
    // harness log — the UI wraps every handler — and as a track with no processor on it.
    await page.click('[data-testid="start-video"]');
    await page.waitForFunction(() => window.harness.snapshot().video !== null);

    const errors = [...app.consoleErrors, ...app.pageErrors, ...(await app.logs())].filter((line) =>
      CAPTURE_TIME.CLONE_ERROR_PATTERN.test(line),
    );
    expect(errors, 'creating the track at capture time threw #50').toEqual([]);

    // Waiting on `video !== null` rather than on `videoProcessorEnabled` so a dropped processor
    // fails here, naming what is missing, instead of timing out with nothing to say.
    // `processedTrackId` matching `id` is the load-bearing half: `setProcessor` leaves the
    // LocalVideoTrack pointing at the processor's output, and the capture-time route has to do
    // the same, or what gets published is the raw camera.
    const info = await page.evaluate(() => window.harness.snapshot().video);
    expect(info!.processorName, 'no processor on the capture-time track').not.toBeNull();
    expect(
      info!.processedTrackId,
      'the track that would be published is not the processor output',
    ).toBe(info!.id);

    const flow = await page.evaluate(() => window.harness.probe.waitForFrames(15, 25_000));
    expect(flow.presented).toBeGreaterThanOrEqual(15);

    const captured = await sampleStable(page);
    const reduction = 1 - captured.regions.bg.blurEnergy / raw.regions.bg.blurEnergy;
    expect(
      reduction,
      `background energy ${raw.regions.bg.blurEnergy.toFixed(4)} -> ${captured.regions.bg.blurEnergy.toFixed(4)}`,
    ).toBeGreaterThan(BLUR.MIN_REDUCTION);
    // And the subject stayed sharper than its background, so this is segmentation rather than a
    // blur smeared over the whole frame.
    expect(
      captured.regions.fg.blurEnergy / captured.regions.bg.blurEnergy,
      `fg ${captured.regions.fg.blurEnergy.toFixed(4)} vs bg ${captured.regions.bg.blurEnergy.toFixed(4)}`,
    ).toBeGreaterThan(BLUR.FG_OVER_BG_MIN);

    // The frame the ordinary route is compared against.
    await captureReference(page, 'processed');
    const webglAfterCapture = await page.evaluate(() => window.harness.counters().webgl.created);

    // The comparison: the same processor, the same camera and the same page, attached the way
    // every other spec attaches it. Anything the two outputs disagree on is the capture-time
    // route's doing.
    await page.evaluate(() => window.harness.media.stopVideo());
    await page.evaluate(() => window.harness.media.startVideo({ processorAtCapture: false }));
    const webglBeforeSet = await page.evaluate(() => window.harness.counters().webgl.created);
    await page.click('[data-testid="attach-processor"]');
    await page.waitForFunction(() => window.harness.snapshot().videoProcessorEnabled === true);
    await page.evaluate(() => window.harness.probe.waitForFrames(15, 25_000));
    await sampleStable(page);

    const diff = await diffFromReference(page, 'processed');
    const report = `mean ${diff.meanAbsDiff.toFixed(2)}, max ${diff.maxAbsDiff}, matching ${(diff.matchingPixelRatio * 100).toFixed(2)}%`;
    expect(
      diff.matchingPixelRatio,
      `capture-time output differs from the setProcessor output: ${report}`,
    ).toBeGreaterThan(CAPTURE_TIME.SAME_OUTPUT_PIXEL_RATIO_MIN);
    expect(
      diff.meanAbsDiff,
      `capture-time output differs from the setProcessor output: ${report}`,
    ).toBeLessThan(CAPTURE_TIME.SAME_OUTPUT_MEAN_DIFF_MAX);

    // Both attachments cost about the same number of WebGL contexts. A capture-time route that
    // built its pipeline twice — plausible, since the track is created and then has a processor
    // set on it — would double this while every pixel assertion above still passed. The absolute
    // count is #136 and is not asserted; only the two routes relative to each other are.
    const captureCost = webglAfterCapture - webglBefore;
    const setCost =
      (await page.evaluate(() => window.harness.counters().webgl.created)) - webglBeforeSet;
    expect(
      captureCost / setCost,
      `capture-time attach created ${captureCost} WebGL contexts, setProcessor ${setCost}`,
    ).toBeLessThan(CAPTURE_TIME.MAX_WEBGL_COST_RATIO);
  });
});
