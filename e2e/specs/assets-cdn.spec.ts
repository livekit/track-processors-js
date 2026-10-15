import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '../fixtures';
import { sampleProcessed, sampleStable, startCamera } from '../helpers';
import { BLUR, CDN_ASSETS } from '../thresholds';

/**
 * I1 — the default asset URLs.
 *
 * With no `assetPaths` override, `BackgroundTransformer.init()` builds the fileset URL from the
 * `@mediapipe/tasks-vision` pin in this package's own `package.json` and takes the model from a
 * fixed Google Storage path. Nothing in the build checks either one, so both can rot silently:
 * a CDN path that moves takes every default integration down at attach time (#17, #20), and a
 * fileset version that drifts from the pinned `@mediapipe/tasks-vision` hands the wasm runtime
 * to a JS glue layer it was not built against — the shape of the downgrade in #72, which fails
 * as corrupt output or a hang rather than as a load error.
 *
 * Split in two deliberately. The version match is the assertion worth running everywhere, and
 * it needs no network: both CDN hosts are intercepted, so I1a records what the library *asked
 * for* and compares it to the pin. The 200 check is the one that catches a CDN moving under us,
 * and it can only do that by really fetching — so it is tagged `@network` and skipped when
 * `E2E_NO_NETWORK` is set. Run it on a schedule to catch drift before users do.
 */

/** Hosts the library reaches for by default. Anything else leaving the page is a finding. */
const REMOTE = (url: string) => !url.startsWith('http://127.0.0.1') && !url.startsWith('blob:');

/**
 * The pin as the library itself reads it — `BackgroundTransformer` imports `dependencies` from
 * this same file. Derived rather than written down, or the test would need editing at the next
 * bump and would pass against a stale expectation in between.
 */
function pinnedTasksVisionVersion(): string {
  const pkg = JSON.parse(
    readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'),
  ) as { dependencies?: Record<string, string> };
  const pin = pkg.dependencies?.[CDN_ASSETS.PINNED_DEPENDENCY];
  // An exact pin, not a range: `^0.10.14` in the URL would not resolve at all, so the guard is
  // on the shape as well as the presence.
  expect(pin, `${CDN_ASSETS.PINNED_DEPENDENCY} is not pinned to an exact version`).toMatch(
    /^\d+\.\d+\.\d+$/,
  );
  return pin!;
}

/** `.../@mediapipe/tasks-vision@0.10.14/wasm/vision_wasm_internal.js` -> `0.10.14` */
function filesetVersion(url: string): string | null {
  return /\/@mediapipe\/tasks-vision@([^/]+)\//.exec(url)?.[1] ?? null;
}

test.describe('default CDN assets', () => {
  test('I1a: the default fileset URL carries the pinned @mediapipe/tasks-vision version', async ({
    app,
  }) => {
    const { page } = app;
    const pinned = pinnedTasksVisionVersion();

    // Both hosts are intercepted so this half is hermetic: it asserts on the URL the library
    // asked for, which is where the pin shows up, and never leaves the machine. 404 rather
    // than abort because the app's handling of exactly that is already covered by I4 — here it
    // is only a way to end the attach quickly once the URL has been observed.
    const intercepted: string[] = [];
    const block = async (pattern: string) =>
      page.route(pattern, (route) => {
        intercepted.push(route.request().url());
        return route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' });
      });
    await block(CDN_ASSETS.FILESET_GLOB);
    await block(CDN_ASSETS.MODEL_GLOB);

    const requested: string[] = [];
    page.on('request', (r) => requested.push(r.url()));

    await app.goto();
    await startCamera(page);

    // Through the UI: the asset fetch is the behaviour under test and it is a click away in any
    // real integration.
    await page.click('[data-testid="attach-processor"]');

    // Waiting on the request itself rather than on the failure keeps this independent of how
    // the library reports a bad fileset.
    await expect
      .poll(() => intercepted.filter(filesetVersion).length, {
        message: 'the fileset was never requested',
        timeout: CDN_ASSETS.MAX_REQUEST_WAIT_MS,
      })
      .toBeGreaterThan(0);

    const filesetUrls = intercepted.filter((url) => filesetVersion(url) !== null);
    for (const url of filesetUrls) {
      expect(url, 'fileset URL is not the documented jsDelivr path').toContain(
        CDN_ASSETS.FILESET_PREFIX,
      );
      expect(
        filesetVersion(url),
        `fileset URL ${url} does not match the pinned ${CDN_ASSETS.PINNED_DEPENDENCY}@${pinned}`,
      ).toBe(pinned);
    }

    // And nothing escaped the routes, which is what makes this half safe to run offline and in
    // CI. If the library grows a fourth asset on a host not listed here, it shows up as a
    // request that was never intercepted.
    expect(
      requested.filter(REMOTE).filter((url) => !intercepted.includes(url)),
      'an outbound request bypassed the intercepts',
    ).toEqual([]);

    // Settle the failed attach before handing back to the fixture, whose automatic
    // "harness logged an error" check would otherwise trip on the deliberate 404.
    await page.waitForFunction(() => window.harness.lastError() !== null, null, {
      timeout: CDN_ASSETS.MAX_REQUEST_WAIT_MS,
    });
    expect(await page.evaluate(() => document.body.dataset.videoProcessor)).toBe('false');
    await page.evaluate(() => window.harness.clearLogs());
  });

  test('I1b: the default CDN assets all answer 200 and produce a working segmenter @network', async ({
    app,
  }) => {
    test.skip(
      !!process.env.E2E_NO_NETWORK,
      'reaches cdn.jsdelivr.net and storage.googleapis.com for real',
    );
    const { page } = app;
    const pinned = pinnedTasksVisionVersion();

    // Recorded rather than predicted: the point is to document what the library actually
    // fetches — which is also the list a self-hosting integration has to mirror — instead of
    // asserting against a guess that would keep passing if the library stopped fetching at all.
    const responses: Array<{ url: string; status: number }> = [];
    page.on('response', (r) => responses.push({ url: r.url(), status: r.status() }));

    await app.goto();
    await startCamera(page);

    // Raw baseline, taken before anything is attached: once a processor is set,
    // `sampleSource()` returns treated frames, so a before/after taken afterwards compares a
    // frame with itself.
    await sampleStable(page);
    const raw = await sampleProcessed(page);

    await page.click('[data-testid="attach-processor"]');

    // The status assertions come before the wait on the attach, on purpose. A CDN answering
    // anything but 200 also stops the attach, so waiting for `videoProcessor` first would turn
    // every asset failure into a bare 40-second timeout with nothing in it about which asset
    // broke — which is the diagnosis this case exists to hand whoever reads the scheduled run.
    // So: settle as soon as the three assets are in, or the moment one of them is not a 200.
    const remoteResponses = () => responses.filter((r) => REMOTE(r.url));
    await expect
      .poll(
        () => {
          const seen = remoteResponses();
          return (
            seen.some((r) => r.status !== CDN_ASSETS.OK_STATUS) ||
            CDN_ASSETS.EXPECTED_SUFFIXES.every((s) => seen.some((r) => r.url.endsWith(s)))
          );
        },
        {
          message: 'the default assets were never all fetched',
          timeout: CDN_ASSETS.MAX_ATTACH_MS,
        },
      )
      .toBe(true);

    const remote = remoteResponses();
    const describe = remote.map((r) => `${r.status} ${r.url}`).join('\n');

    // Every asset the library reached for, and nothing that 3xx'd, 4xx'd or 5xx'd on the way.
    // A redirect counts as a change worth looking at: neither host issued one when this was
    // calibrated, so one appearing means a path has moved under the pin.
    for (const { status } of remote) {
      expect(status, `asset did not answer 200:\n${describe}`).toBe(CDN_ASSETS.OK_STATUS);
    }
    for (const needle of CDN_ASSETS.EXPECTED_SUFFIXES) {
      expect(
        remote.some((r) => r.url.endsWith(needle)),
        `${needle} was never fetched; observed:\n${describe}`,
      ).toBe(true);
    }
    expect(
      remote.some((r) => r.url === CDN_ASSETS.MODEL_URL),
      `the model URL moved; observed:\n${describe}`,
    ).toBe(true);
    // The live URLs have to carry the pin too — this is the half that would catch the CDN
    // serving a version the package.json check cannot see.
    for (const { url } of remote.filter((r) => filesetVersion(r.url))) {
      expect(filesetVersion(url), `live fileset URL ${url} is off the pin`).toBe(pinned);
    }

    await page.waitForFunction(() => document.body.dataset.videoProcessor === 'true', null, {
      timeout: CDN_ASSETS.MAX_ATTACH_MS,
    });
    await page.evaluate(() => window.harness.probe.waitForFrames(10, 25_000));

    // A 200 is not the same as a usable asset: a fileset that loads but segments nothing would
    // pass every check above. The blur has to actually land on the background.
    await sampleStable(page);
    const blurred = await sampleProcessed(page);
    expect(raw.regions.bg.blurEnergy, 'camera backdrop has no detail to blur').toBeGreaterThan(
      BLUR.RAW_BG_ENERGY_MIN,
    );
    const reduction = 1 - blurred.regions.bg.blurEnergy / raw.regions.bg.blurEnergy;
    expect(
      reduction,
      `background energy ${raw.regions.bg.blurEnergy.toFixed(4)} -> ` +
        `${blurred.regions.bg.blurEnergy.toFixed(4)} with the default CDN assets`,
    ).toBeGreaterThan(BLUR.MIN_REDUCTION);
  });
});
