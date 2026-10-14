import { expect, test } from '../fixtures';
import { sampleProcessed, sampleStable, snapshot, startCamera } from '../helpers';
import { ASSET_FAILURE, BLUR } from '../thresholds';

/**
 * I4 — a bad asset path.
 *
 * `assetPaths.tasksVisionFileSet` and `assetPaths.modelAssetPath` are read once inside
 * `BackgroundProcessor()` and fetched in `BackgroundTransformer.init()`, which runs inside
 * `LocalTrack.setProcessor()`. A typo, a stale pin or a CDN outage therefore surfaces at attach
 * time, in the middle of a user action, rather than at construction — which is what makes the
 * failure mode worth a test of its own (#17, #58).
 *
 * Two things have to hold. The attach must *fail*, promptly and visibly: an integration that
 * hangs has nothing to show the user and nothing to retry, and a 30-second silent wait is
 * indistinguishable from a working app that is merely slow. And the failure must leave the
 * track usable, so that fixing the path and attaching again works without reloading.
 */
test.describe('asset paths', () => {
  test('I4: a 404 fileset fails fast, and attaching again with a valid one recovers', async ({
    app,
  }) => {
    const { page } = app;

    // The 404 is injected rather than configured, so the processor keeps its real default
    // paths and the recovery half exercises the genuine CDN URL rather than a second override.
    // Flipping a flag instead of calling unroute() keeps both halves on one counter, so the
    // test can prove the valid fileset was actually fetched after the bad one.
    let blocked = true;
    let blockedRequests = 0;
    let servedRequests = 0;
    await page.route('**/cdn.jsdelivr.net/npm/@mediapipe/tasks-vision**', (route) => {
      if (blocked) {
        blockedRequests += 1;
        return route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' });
      }
      servedRequests += 1;
      return route.continue();
    });

    await app.goto();
    await startCamera(page);

    // Baseline for the recovery assertion, taken before anything is attached.
    await sampleStable(page);
    const raw = await sampleProcessed(page);
    expect(raw.regions.bg.blurEnergy, 'camera backdrop has no detail to blur').toBeGreaterThan(
      BLUR.RAW_BG_ENERGY_MIN,
    );

    // ---------------------------------------------------------------- fails fast

    const startedAt = Date.now();
    await page.click('[data-testid="attach-processor"]');

    // The harness logs whatever a click handler threw, so this is the failure arriving where a
    // real integration would catch it. Bounded explicitly: the assertion is not that an error
    // eventually appears but that it appears *soon*, which is the half a hang would break.
    await page.waitForFunction(() => window.harness.lastError() !== null, null, {
      timeout: ASSET_FAILURE.MAX_SURFACE_MS,
    });
    const surfacedMs = Date.now() - startedAt;
    expect(surfacedMs, 'attach failure took too long to surface').toBeLessThan(
      ASSET_FAILURE.MAX_SURFACE_MS,
    );
    expect(blockedRequests, 'the fileset was never requested').toBeGreaterThan(0);

    // And it leaves no half-attached state behind: a UI that thinks the processor is on, with
    // no processed track behind it, is the shape #17 reports.
    const failedState = await page.evaluate(() => ({ ...document.body.dataset }));
    expect(failedState.videoProcessor, 'UI claims the processor attached').toBe('false');
    expect(failedState.mode).toBe('off');
    expect(failedState.pipeline).toBe('none');

    const afterFailure = await snapshot(page);
    expect(afterFailure.video?.processedTrackId, 'a processed track survived a failed init').toBe(
      null,
    );
    // The camera itself must be untouched, or there would be nothing left to retry with.
    expect(afterFailure.video?.readyState, 'the failure took the source track down').toBe('live');

    // ---------------------------------------------------------------- what the caller is told

    // Taken through the API rather than the button because the click handler only keeps
    // `e.message`, and the point here is the rejection itself. The teeth are in `outcome`:
    // resolving while the segmenter failed to load is the silent-failure variant of #17, and
    // would leave the app showing a working processor over a track that never gets a frame.
    const rejection = await page.evaluate(async () => {
      try {
        await window.harness.media.setVideoProcessorEnabled(true);
        return { outcome: 'resolved', described: '' };
      } catch (e: any) {
        return {
          outcome: 'rejected',
          // Whatever a caller could show a user: a wrapped Error's text today or tomorrow,
          // plus the fields mediapipe's raw load event carries.
          described: [e?.message, String(e), e?.target?.src].filter(Boolean).join(' '),
        };
      }
    });
    expect(rejection.outcome, 'attach resolved although the segmenter never loaded').toBe(
      'rejected',
    );
    // Descriptive enough to act on means naming the asset that could not be loaded. Note how
    // little of that is true today: the rejection is mediapipe's bare script-load `Event`, so
    // `message` is undefined and `String(e)` is "[object Event]" — only `event.target.src`
    // identifies the fileset, and only because the library forwards the event untouched
    // (#17, #58). A wrapped `Error` naming the path would satisfy this too.
    expect(rejection.described, 'the failure does not say which asset failed').toContain(
      'tasks-vision',
    );

    // ---------------------------------------------------------------- recovers

    blocked = false;
    // The error has been asserted on; clearing it keeps the fixture's automatic
    // "harness logged an error" check — which every other spec relies on — meaningful here.
    await page.evaluate(() => window.harness.clearLogs());

    await page.click('[data-testid="attach-processor"]');
    await page.waitForFunction(() => document.body.dataset.videoProcessor === 'true', null, {
      timeout: ASSET_FAILURE.MAX_RECOVERY_MS,
    });
    await page.evaluate(() => window.harness.probe.waitForFrames(10, 25_000));
    expect(servedRequests, 'the valid fileset was never fetched').toBeGreaterThan(0);

    // Attached is not the same as working: `processedVideoTrack()` falls back to the raw camera
    // whenever the processor is off, so the output has to be checked for the effect itself.
    const recovered = await snapshot(page);
    expect(recovered.video?.processedTrackId, 'no processed track after recovery').not.toBeNull();

    await sampleStable(page);
    const blurred = await sampleProcessed(page);
    const reduction = 1 - blurred.regions.bg.blurEnergy / raw.regions.bg.blurEnergy;
    expect(
      reduction,
      `background energy ${raw.regions.bg.blurEnergy.toFixed(4)} -> ` +
        `${blurred.regions.bg.blurEnergy.toFixed(4)} after recovery`,
    ).toBeGreaterThan(BLUR.MIN_REDUCTION);
  });
});
