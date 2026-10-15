import type { EnvInfo } from '../../examples/e2e/types';
import { expect, test } from '../fixtures';
import { attachProcessor, startCamera } from '../helpers';
import { DEGRADED } from '../thresholds';

/**
 * A1, A2, A3, A4 — which pipeline the library selects, that both of them work, and what
 * happens when neither can.
 *
 * Support is inferred from the presence of a handful of globals, and the choice between the
 * insertable-streams path and the canvas.captureStream fallback follows from two of them. These
 * assertions are cheap, and they fail loudly if the environment changes underneath every other
 * spec rather than letting those fail obscurely.
 */

/**
 * What each browser is expected to report.
 *
 * Only entries confirmed by a real run belong here. A project with no entry fails rather than
 * inheriting Chrome's answers: these flags decide which pipeline the library picks, so a new
 * target has to have them observed rather than assumed. Safari is the interesting case — no
 * insertable streams, so `hasModernApiSupport` is false and the fallback becomes the live path
 * rather than something A3 has to force.
 */
const EXPECTED_CAPABILITIES: Record<string, Record<string, boolean>> = {
  chrome: {
    transformerSupported: true,
    processorSupported: true,
    hasModernApiSupport: true,
    webgl2: true,
    offscreenCanvas: true,
    videoFrame: true,
    createImageBitmap: true,
    insertableStreams: true,
    canvasCaptureStream: true,
  },
};

test.describe('capability detection', () => {
  test('A1: the browser reports the capabilities this suite was calibrated against', async ({
    app,
  }, testInfo) => {
    await app.goto();

    const env = await app.page.evaluate(() => window.harness.env());
    const expected = EXPECTED_CAPABILITIES[testInfo.project.name];
    expect(
      expected,
      `no capability matrix for project "${testInfo.project.name}". Add one observed from a real run on that browser rather than assuming Chrome's.`,
    ).toBeDefined();

    for (const [capability, value] of Object.entries(expected)) {
      expect(env[capability as keyof typeof env], capability).toBe(value);
    }

    // The probe counts presented frames with it, so a run without it would silently measure
    // less. Required on every target, which is why it sits outside the per-browser matrix.
    expect(env.requestVideoFrameCallback, 'requestVideoFrameCallback').toBe(true);
  });

  /**
   * The predicates are derived values, and this pins them to the primitives they are derived
   * from. It holds on any browser, so it needs no matrix entry — and it is what would catch the
   * library's support checks drifting out of step with the environment on a new target.
   */
  test('A1b: the support predicates follow from the underlying primitives', async ({ app }) => {
    await app.goto();

    const env = await app.page.evaluate(() => window.harness.env());

    expect(env.transformerSupported, 'BackgroundTransformer.isSupported').toBe(
      env.offscreenCanvas && env.videoFrame && env.createImageBitmap && env.webgl2,
    );
    expect(env.hasModernApiSupport, 'ProcessorWrapper.hasModernApiSupport').toBe(
      env.insertableStreams,
    );
    expect(env.processorSupported, 'ProcessorWrapper.isSupported').toBe(
      env.hasModernApiSupport || env.canvasCaptureStream,
    );
  });

  /**
   * The four primitives `BackgroundTransformer.isSupported` reads, each removable before boot
   * with `?break=`, paired with the `env()` flag that has to go false and the name the label is
   * expected to say out loud.
   */
  const BREAKABLE_PRIMITIVES: readonly { param: string; flag: keyof EnvInfo; label: string }[] = [
    { param: 'offscreencanvas', flag: 'offscreenCanvas', label: 'OffscreenCanvas' },
    { param: 'videoframe', flag: 'videoFrame', label: 'VideoFrame' },
    { param: 'createimagebitmap', flag: 'createImageBitmap', label: 'createImageBitmap' },
    { param: 'webgl2', flag: 'webgl2', label: 'webgl2' },
  ];

  /**
   * A2 — an unsupported environment has to degrade to a disabled control.
   *
   * `BackgroundProcessor()` throws when any one of those primitives is missing, and issues #10
   * and #38 are both what an app gets for not asking first: the throw escapes module scope or a
   * click handler, and the user is left with a white screen or an uncaught error instead of a
   * button that says why it cannot run. The documented message is still the library's — but
   * only for a caller that deliberately asks for it.
   *
   * One test per primitive, because each is a separate route into the same state and a partial
   * support check (reading three of the four, say) would otherwise pass.
   */
  for (const primitive of BREAKABLE_PRIMITIVES) {
    test(`A2: without ${primitive.label} the processor control is disabled, not throwing`, async ({
      app,
    }) => {
      const { page } = app;
      // That this returns at all is half the case: `goto` fails on `body.dataset.bootError`,
      // which is what #10's white screen looks like from out here.
      await app.goto({ break: primitive.param });

      const env = await page.evaluate(() => window.harness.env());
      expect(env[primitive.flag], `?break=${primitive.param} should have removed it`).toBe(false);
      expect(env.transformerSupported, 'BackgroundTransformer.isSupported').toBe(false);

      // Losing background processing must not take the rest of the app with it.
      await startCamera(page);
      await expect(page.locator('body')).toHaveAttribute('data-video-track', 'live');

      const attach = page.getByTestId('attach-processor');
      await expect(attach, 'attach control').toBeDisabled();
      await expect(page.getByTestId('processor-unsupported'), 'explanatory label').toBeVisible();

      // The label's wording is read from the mirrored dataset value rather than from rendered
      // text, per the house rule — but it still has to name what is missing, since "disabled
      // with no reason" is the other half of what #38 reported.
      const reason = await page.evaluate(() => document.body.dataset.processorUnsupportedReason);
      expect(reason, 'reason').toContain(DEGRADED.REASON_PREFIX);
      expect(reason, 'reason names the missing primitive').toContain(primitive.label);

      // Now press it for real. A disabled control dispatches no click, so this has to leave the
      // app exactly where it was — no processor attached, and nothing thrown out of a handler.
      await attach.click({ force: true });
      await expect(page.locator('body')).toHaveAttribute('data-video-processor', 'false');

      // The throw is still there for a caller that asks for it by name. The app does not: it
      // checks `supportsBackgroundProcessors()` and never constructs one here.
      const construction = await page.evaluate(() => window.harness.tryCreateProcessor());
      expect(construction.ok, 'BackgroundProcessor() should refuse').toBe(false);
      expect(construction.error, 'documented message').toBe(DEGRADED.TRANSFORMER_ERROR);

      // Nothing reached `window.onerror`: the app fixture fails any test whose run produced a
      // page error or a logged harness error, so it is not asserted again here.
    });
  }

  /**
   * The other direction, and what keeps the four above honest: a harness that disabled the
   * control unconditionally, or a `?break=` that quietly did nothing, would pass all of them.
   */
  test('A2b: with every primitive present the control is live and carries no reason', async ({
    app,
  }) => {
    const { page } = app;
    await app.goto();

    await expect(page.locator('body')).toHaveAttribute('data-processor-supported', 'true');
    await expect(page.getByTestId('attach-processor')).toBeEnabled();
    await expect(page.getByTestId('processor-unsupported')).toBeHidden();
    const reason = await page.evaluate(() => document.body.dataset.processorUnsupportedReason);
    expect(reason, 'no reason when nothing is missing').toBeUndefined();
  });

  test('A4: the modern path adds no canvas to the document', async ({ app }) => {
    const { page } = app;
    await app.goto();
    await startCamera(page);
    await attachProcessor(page);

    const state = await page.evaluate(() => ({
      pipeline: window.harness.snapshot().video?.pipeline,
      processorCanvases: window.harness.counters().canvases.processorCanvases,
    }));

    expect(state.pipeline).toBe('insertable-streams');
    // The fallback reuses a canvas[data-livekit-processor] in the DOM. Finding one here would
    // mean the fallback had quietly become the default path.
    expect(state.processorCanvases).toBe(0);
  });

  test('A3: ?fallback=1 runs the canvas path and still produces frames', async ({ app }) => {
    const { page } = app;
    // Removes MediaStreamTrackGenerator/Processor before boot. This is what makes the
    // Safari-only code path testable under Chrome, where there are working devtools.
    await app.goto({ fallback: 1, backdrop: 'flat' });

    const env = await page.evaluate(() => window.harness.env());
    expect(env.hasModernApiSupport, 'globals should have been removed').toBe(false);
    expect(env.insertableStreams).toBe(false);
    // Support overall must survive: the fallback is still supported.
    expect(env.processorSupported).toBe(true);

    await startCamera(page);
    await attachProcessor(page);

    const state = await page.evaluate(async () => {
      const sample = await window.harness.probe.sample();
      return {
        pipeline: window.harness.snapshot().video?.pipeline,
        processorCanvases: window.harness.counters().canvases.processorCanvases,
        width: sample.width,
        height: sample.height,
      };
    });

    expect(state.pipeline).toBe('canvas-fallback');
    expect(state.processorCanvases).toBe(1);
    // Geometry must survive the extra canvas hop, which is where #128 found its bugs.
    expect(state.width).toBe(1280);
    expect(state.height).toBe(720);
  });
});
