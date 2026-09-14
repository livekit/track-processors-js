import { expect, test } from '../fixtures';
import { attachProcessor, startCamera } from '../helpers';

/**
 * A1, A3, A4 — which pipeline the library selects, and that both of them work.
 *
 * Support is inferred from the presence of four globals, and the choice between the
 * insertable-streams path and the canvas.captureStream fallback follows from two of them. These
 * assertions are cheap, and they fail loudly if the environment changes underneath every other
 * spec rather than letting those fail obscurely.
 */
test.describe('capability detection', () => {
  test('A1: Chrome reports full modern support', async ({ app }) => {
    await app.goto();

    const env = await app.page.evaluate(() => window.harness.env());

    expect(env.transformerSupported, 'BackgroundTransformer.isSupported').toBe(true);
    expect(env.processorSupported, 'ProcessorWrapper.isSupported').toBe(true);
    expect(env.hasModernApiSupport, 'ProcessorWrapper.hasModernApiSupport').toBe(true);
    expect(env.webgl2).toBe(true);
    expect(env.offscreenCanvas).toBe(true);
    expect(env.videoFrame).toBe(true);
    expect(env.insertableStreams).toBe(true);
    // The probe's frame counting depends on this; a run without it would silently measure less.
    expect(env.requestVideoFrameCallback).toBe(true);
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
