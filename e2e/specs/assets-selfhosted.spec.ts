import { expect, test } from '../fixtures';
import { sampleSource, sampleStable, startCamera } from '../helpers';
import { BLUR, SELF_HOSTED_ASSETS } from '../thresholds';

/**
 * I2 — fully self-hosted assets, with both CDNs blocked.
 *
 * `BackgroundTransformer.init()` fetches two things the library does not ship with: the
 * tasks-vision wasm fileset from `cdn.jsdelivr.net`, and the selfie segmenter model from
 * `storage.googleapis.com`. An integration that cannot reach either — an air-gapped deployment,
 * a locked-down CSP, an enterprise proxy, or simply jsdelivr having a bad day — has `assetPaths`
 * and nothing else, and both halves have to work: overriding only `tasksVisionFileSet` still
 * leaves the model on the public internet (#35, #68).
 *
 * So the CDNs are not merely unused here, they are **aborted at the route level**. The abort is
 * what gives this teeth: it fails if the library silently falls back to a default path, if
 * `assetPaths` is honoured for one asset but not the other, or if a request is issued and its
 * result discarded. The assertion is "zero external requests attempted", not "the page still
 * worked".
 *
 * Initialising is not enough either. `?assets=local` would also "pass" against a model that
 * loads and never produces a mask, so the output is measured against a raw baseline exactly as
 * `B1` does — taken before the attach, because `sampleSource()` returns treated frames once a
 * processor is on the track.
 *
 * What makes it possible is local serving: the dev server exposes the fileset straight out of
 * `node_modules/@mediapipe/tasks-vision/wasm` and the model from a one-time cache (the plugin in
 * `examples/e2e/vite.config.js`), which is the fix `e2e/AGENTS.md` records under "Known slow
 * spot". Nothing here is specific to this one case: any spec can take `assets: 'local'`.
 *
 * NEGATIVE CONTROL (not committed — it asserts that a blocked CDN breaks an attach, which `I4`
 * already owns): drop `assets: 'local'` from the `app.goto()` below and change nothing else, so
 * the library falls back to its default CDN paths against the same aborted routes. Observed: one
 * external request attempted (`cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm/
 * vision_wasm_internal.js`), no `/mediapipe/` request at all, the attach failing 113 ms after the
 * click with `document.body.dataset.videoProcessor` still `false`, and the wait below timing out
 * — the test fails in 20.6 s. That is what rules out a warm HTTP cache, or anything other than
 * the local copies, having answered in the passing run.
 */
test.describe('self-hosted assets', () => {
  test('I2: assets served locally initialise and segment with the CDN blocked', async ({ app }) => {
    const { page } = app;

    // Every request the page attempts, recorded before anything is blocked: `page.on('request')`
    // fires for aborted requests too, which is the only way to tell "never asked" apart from
    // "asked and was refused" — the second is still a CDN dependency in production.
    const external: string[] = [];
    const localAssets: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
      if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
        if (url.pathname.startsWith('/mediapipe/')) localAssets.push(url.pathname);
        return;
      }
      external.push(request.url());
    });

    // Aborted rather than answered with a 404: a 404 is a reachable server, and both mediapipe
    // and the library could in principle do something with one. `net::ERR_FAILED` is what an
    // unreachable CDN actually looks like.
    await page.route(/jsdelivr\.net/, (route) => route.abort());
    await page.route(/storage\.googleapis\.com/, (route) => route.abort());

    await app.goto({ assets: 'local', backdrop: 'checker', motion: 'static' });

    // `assetPaths` is read once inside `BackgroundProcessor()` and never again, so a harness-side
    // typo would otherwise surface only as an unexplained timeout further down.
    const configured = await page.evaluate(() => window.harness.config.assetPaths);
    expect(configured, 'the harness did not configure local asset paths').toEqual({
      tasksVisionFileSet: '/mediapipe/wasm',
      modelAssetPath: '/mediapipe/selfie_segmenter.tflite',
    });

    await startCamera(page);
    const raw = await sampleSource(page);
    expect(
      raw.regions.bg.blurEnergy,
      'the checker backdrop should carry high-frequency detail to blur away',
    ).toBeGreaterThan(BLUR.RAW_BG_ENERGY_MIN);

    // ---------------------------------------------------------------- it initialises

    const startedAt = Date.now();
    await page.click('[data-testid="attach-processor"]');
    await page.waitForFunction(() => document.body.dataset.videoProcessor === 'true', null, {
      timeout: SELF_HOSTED_ASSETS.MAX_ATTACH_MS,
    });
    const attachMs = Date.now() - startedAt;
    expect(attachMs, 'attaching with local assets took too long').toBeLessThan(
      SELF_HOSTED_ASSETS.MAX_ATTACH_MS,
    );

    const flow = await page.evaluate(() => window.harness.probe.waitForFrames(15, 25_000));
    expect(flow.presented, 'no frames reached the probe').toBeGreaterThanOrEqual(15);

    // ---------------------------------------------------------------- and segments

    const blurred = await sampleStable(page);
    const reduction = 1 - blurred.regions.bg.blurEnergy / raw.regions.bg.blurEnergy;
    expect(
      reduction,
      `background energy ${raw.regions.bg.blurEnergy.toFixed(4)} -> ${blurred.regions.bg.blurEnergy.toFixed(4)}`,
    ).toBeGreaterThan(BLUR.MIN_REDUCTION);

    // The model is the half that cannot be served out of `node_modules`, so it is the half most
    // likely to be quietly missing. A uniformly blurred frame would satisfy the reduction above
    // with no segmentation at all; only the subject staying sharper than its background says a
    // mask came back.
    const sharpness = blurred.regions.fg.blurEnergy / blurred.regions.bg.blurEnergy;
    expect(
      sharpness,
      `fg ${blurred.regions.fg.blurEnergy.toFixed(4)} vs bg ${blurred.regions.bg.blurEnergy.toFixed(4)}`,
    ).toBeGreaterThan(BLUR.FG_OVER_BG_MIN);

    // ---------------------------------------------------------------- with nothing external

    // Checked after the pixels, so a failure here reads as "it worked, but it cheated" rather
    // than hiding a broken pipeline behind a network assertion.
    expect(external, 'the page reached outside the harness origin').toEqual([]);
    // And the local copies were genuinely fetched over the wire this run: without this, a
    // processor that somehow needed no assets at all would satisfy the line above.
    expect(localAssets, 'the local fileset was never requested').toContain(
      '/mediapipe/wasm/vision_wasm_internal.js',
    );
    expect(localAssets, 'the local model was never requested').toContain(
      '/mediapipe/selfie_segmenter.tflite',
    );
  });
});
