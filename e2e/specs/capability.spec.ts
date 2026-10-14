import { expect, test } from '../fixtures';
import { attachProcessor, startCamera } from '../helpers';

/**
 * A1, A3, A4 — which pipeline the library selects, and that both of them work.
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
