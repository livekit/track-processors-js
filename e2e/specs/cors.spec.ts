import type { Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { type App, expect, test } from '../fixtures';
import { attachProcessor, startCamera } from '../helpers';
import { CROSS_ORIGIN_BACKGROUND, VIRTUAL_BACKGROUND } from '../thresholds';

/**
 * D2 — a virtual background served from another origin.
 *
 * `BackgroundTransformer.loadAndSetBackground` sets `img.crossOrigin = 'Anonymous'` before
 * assigning `src`, which is what PR #42 added so the loaded bitmap is not tainted and
 * `createImageBitmap` can hand it to WebGL. The flip side is that the image is then subject to
 * a CORS check, and a CDN that does not opt this origin in makes the load fail — which is the
 * configuration mistake this case is about.
 *
 * The two tests are each other's control: identical bytes, identical URL, identical route
 * handler, and one header different.
 */

/** A host that exists nowhere. Nothing reaches the network; `page.route` answers every hit. */
const CDN_IMAGE = 'https://cdn.example.test/bg.png';

/** "Switch to virtual background" — the real control, since that is the behaviour under test. */
const SWITCH_VIRTUAL = '[data-testid="switch-virtual"]';

/**
 * The same plate `/bg-solid.png` serves, read off disk so both legs send byte-identical
 * responses. Reusing the harness's own image is what lets the loaded leg assert against
 * `VIRTUAL_BACKGROUND.COLOR` rather than inventing a second flat colour.
 */
const PLATE = fs.readFileSync(
  path.join(__dirname, '..', '..', 'examples', 'e2e', 'public', 'bg-solid.png'),
);

/**
 * Serves `CDN_IMAGE` with a given `Access-Control-Allow-Origin`, and counts the hits.
 *
 * The blocked leg sends a header naming a *different* origin rather than sending none at all:
 * `route.fulfill` injects `access-control-allow-origin: *` into any fulfilled response that
 * lacks one, so "no header" is not expressible through interception — it arrives at the
 * renderer already opted in, and the image loads. A mismatched value fails the identical check
 * in the identical place, and Chrome says so in as many words ("has a value ... that is not
 * equal to the supplied origin"), which is what the test reads back.
 */
async function serveCrossOriginPlate(page: Page, allowOrigin: string) {
  const state = { requests: 0 };
  await page.route(CDN_IMAGE, async (route) => {
    state.requests += 1;
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      // The image must not come out of Chrome's decoded-image cache on a later load; see D4.
      headers: { 'access-control-allow-origin': allowOrigin, 'cache-control': 'no-store' },
      body: PLATE,
    });
  });
  return state;
}

/** Rec. 709 luma of a region mean. A black region is 0. */
function luma(mean: { r: number; g: number; b: number }) {
  return 0.2126 * mean.r + 0.7152 * mean.g + 0.0722 * mean.b;
}

/**
 * Fingerprints every presented frame for `count` frames, and reduces them to the three things
 * "the pipeline is still alive" means: frames arrived, at a sane rate, and they were not all
 * the same picture.
 *
 * Every frame rather than polling, for the reason C1b and D4 record: a poll can only report the
 * frames it happened to catch. And `waitForFrames` alone is not enough — it counts presented
 * frames, so a pipeline re-presenting one stale frame forever would satisfy it.
 */
async function recordLiveness(page: Page, count: number) {
  await page.evaluate(() => window.harness.probe.startRecording({ maxFrames: 400 }));
  await page.evaluate((n) => window.harness.probe.waitForFrames(n, 25_000), count);
  const frames = await page.evaluate(() => window.harness.probe.stopRecording());
  expect(frames.length, 'no frames were recorded at all').toBeGreaterThan(1);

  const spanMs = frames[frames.length - 1].t - frames[0].t;
  return {
    frames: frames.length,
    spanMs,
    fps: spanMs > 0 ? (1000 * (frames.length - 1)) / spanMs : 0,
    distinctHashes: new Set(frames.map((frame) => frame.hash)).size,
    minForegroundLuma: Math.min(...frames.map((frame) => luma(frame.fgMean))),
  };
}

/** Console lines Chrome writes when it blocks a subresource on the CORS check. */
function corsBlocks(app: App) {
  return app.consoleErrors.filter(
    (line) => /blocked by CORS policy/.test(line) && line.includes(CDN_IMAGE),
  );
}

/** Rejections the harness caught out of a control's handler. `ui.ts` logs one line per throw. */
async function surfacedErrors(app: App) {
  return (await app.logs()).filter((line) => line.includes('ERROR'));
}

test.describe('cross-origin virtual background', () => {
  /**
   * Both legs load in `background-blur` and switch, rather than starting in
   * `virtual-background`.
   *
   * `BackgroundTransformer`'s constructor calls `update()` without awaiting it, so a failing
   * `imagePath` passed at construction rejects with nothing attached to catch it — an
   * unhandled rejection during boot, before the app can even see it. That is a real bug
   * (observed; see the commit message), but it is not what this case is about, and a test
   * provoking it cannot pass the `app` fixture's `pageErrors` assertion. Switching after
   * construction drives the same `loadAndSetBackground` call through the path an application
   * can actually handle.
   */
  async function bootInBlurMode(app: App) {
    // `motion: 'pan'` so the source genuinely changes frame to frame: on a static input a
    // frozen pipeline and a working one produce the same hashes, and the liveness half of
    // this case would assert nothing. `backdrop: 'flat'` keeps the plate match exact.
    await app.goto({
      backdrop: 'flat',
      motion: 'pan',
      mode: 'background-blur',
      bg: CDN_IMAGE,
      loglevel: 'error',
    });
    await startCamera(app.page);
    await attachProcessor(app.page);
  }

  test('D2: a cross-origin image renders when the response allows this origin', async ({
    app,
    baseURL,
  }) => {
    const { page } = app;
    const cdn = await serveCrossOriginPlate(page, new URL(baseURL!).origin);

    await bootInBlurMode(app);
    await page.click(SWITCH_VIRTUAL);
    await page.evaluate(() => window.harness.probe.waitForFrames(10, 25_000));

    // The plate has to actually be on screen: this is the half that makes the blocked leg
    // below mean something, since both legs would otherwise just be "no magenta".
    const sample = await page.evaluate(
      (expected) => window.harness.probe.sample({ expectBackground: expected }),
      { ...VIRTUAL_BACKGROUND.COLOR, tolerance: VIRTUAL_BACKGROUND.TOLERANCE },
    );
    expect(sample.backgroundMatchRatio, 'no background match was computed').not.toBeNull();
    expect(
      sample.backgroundMatchRatio!,
      'the cross-origin plate did not reach the compositor',
    ).toBeGreaterThan(VIRTUAL_BACKGROUND.MATCH_RATIO_MIN);

    // And it came from the cross-origin URL, not from a same-origin fallback or a cache.
    expect(cdn.requests, 'the cross-origin image was not fetched').toBe(
      CROSS_ORIGIN_BACKGROUND.EXPECTED_IMAGE_REQUESTS,
    );
    expect(corsBlocks(app), 'an allowed origin was still blocked').toEqual([]);
    expect(await surfacedErrors(app), 'the allowed leg surfaced an error').toEqual([]);
  });

  test('D2: a cross-origin image blocked by CORS fails once and keeps the pipeline running', async ({
    app,
  }) => {
    const { page } = app;
    // Byte-identical to the leg above. Only the header value differs.
    const cdn = await serveCrossOriginPlate(page, 'https://denied.example.test');

    await bootInBlurMode(app);
    await page.click(SWITCH_VIRTUAL);
    await page.evaluate(() => window.harness.probe.waitForFrames(10, 25_000));

    // A CORS failure, not a 404 — different code path, and D3 is the one that covers 404s.
    // Chrome's wording is what distinguishes them: the response was fulfilled with status 200
    // above, so the only thing that can have stopped it is the CORS check. Asserting on that
    // string is a known fragility, and it is the only signal that tells the two apart.
    expect(
      corsBlocks(app),
      `expected exactly one CORS block; console was:\n${app.consoleErrors.join('\n')}`,
    ).toHaveLength(1);

    // The failure is real, not a silent success: the plate is absent.
    const failed = await page.evaluate(
      (expected) => window.harness.probe.sample({ expectBackground: expected }),
      { ...VIRTUAL_BACKGROUND.COLOR, tolerance: VIRTUAL_BACKGROUND.TOLERANCE },
    );
    expect(
      failed.backgroundMatchRatio!,
      'the blocked image rendered anyway, so this leg proves nothing',
    ).toBeLessThan(CROSS_ORIGIN_BACKGROUND.FAILED_MATCH_RATIO_MAX);

    // Counted, not assumed. One attempt and one surfaced error, before any frames go by.
    expect(cdn.requests, 'the image was requested more than once').toBe(
      CROSS_ORIGIN_BACKGROUND.EXPECTED_IMAGE_REQUESTS,
    );
    const afterSwitch = await surfacedErrors(app);
    expect(
      afterSwitch,
      `errors surfaced by the failed switch:\n${afterSwitch.join('\n')}`,
    ).toHaveLength(CROSS_ORIGIN_BACKGROUND.EXPECTED_ERROR_COUNT);

    // ---- the assertion this case exists for: it degrades, it does not stop ----
    const live = await recordLiveness(page, CROSS_ORIGIN_BACKGROUND.LIVENESS_FRAMES);
    const report =
      `${live.frames} frames in ${Math.round(live.spanMs)}ms (${live.fps.toFixed(1)}fps), ` +
      `${live.distinctHashes} distinct hashes, min fg luma ${live.minForegroundLuma.toFixed(1)}`;

    expect(live.fps, `the pipeline slowed to a crawl: ${report}`).toBeGreaterThan(
      CROSS_ORIGIN_BACKGROUND.MIN_FPS,
    );
    // Not frozen: a pipeline re-presenting one stale frame keeps `presentedFrames` rising.
    expect(live.distinctHashes, `the output froze: ${report}`).toBeGreaterThanOrEqual(
      CROSS_ORIGIN_BACKGROUND.MIN_DISTINCT_HASHES,
    );
    // Not black. Only the *subject* is asserted on: the background region does go black when
    // the image is missing, which is a degradation rather than a stoppage, so pinning it here
    // would fail a future fix that fell back to the camera or to the previous plate instead.
    expect(live.minForegroundLuma, `the output went black: ${report}`).toBeGreaterThan(
      CROSS_ORIGIN_BACKGROUND.MIN_FOREGROUND_LUMA,
    );

    const degraded = await page.evaluate(() => window.harness.probe.sample());
    expect(
      degraded.regions.full.stdDev,
      `the frame is flat, so nothing is being composited: ${report}`,
    ).toBeGreaterThan(CROSS_ORIGIN_BACKGROUND.MIN_FULL_STDDEV);
    expect(
      degraded.regions.fg.blurEnergy,
      `the subject lost its detail: ${report}`,
    ).toBeGreaterThan(CROSS_ORIGIN_BACKGROUND.MIN_FOREGROUND_ENERGY);

    // Once, not once per frame (#M4). Nothing new may have appeared while those frames went by.
    expect(
      await surfacedErrors(app),
      'the failure was re-reported while frames were flowing',
    ).toHaveLength(CROSS_ORIGIN_BACKGROUND.EXPECTED_ERROR_COUNT);
    expect(corsBlocks(app), 'the image was re-requested and re-blocked').toHaveLength(1);
    expect(cdn.requests, 'the image was re-requested per frame').toBe(
      CROSS_ORIGIN_BACKGROUND.EXPECTED_IMAGE_REQUESTS,
    );
    // The library's own logger must not run per frame either. `<=` rather than `=== 0` so a
    // fix that starts logging this once lands as a pass, not as a failure here.
    const libraryErrors = await page.evaluate(() =>
      window.harness.libraryLogs().filter((record) => record.levelName === 'error'),
    );
    expect(
      libraryErrors.length,
      `the library logged ${libraryErrors.length} errors:\n${libraryErrors.map((r) => r.msg).join('\n')}`,
    ).toBeLessThanOrEqual(CROSS_ORIGIN_BACKGROUND.EXPECTED_ERROR_COUNT);

    // The whole point of this test is the error above, and it has now been counted twice. The
    // `app` fixture's blanket "the harness logged an error" check runs next and would report
    // it a third time as a failure, so retire it deliberately rather than loosening the
    // fixture for every other spec.
    await page.evaluate(() => window.harness.clearLogs());
  });
});
