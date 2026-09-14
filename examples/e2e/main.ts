import { parseConfig } from './config';
import { E2EHarness } from './harness';
import { installMocks } from './install';
import { Media } from './media';
import { startPanel } from './panel';
import { recordFrame } from './stats';
import { buildUi } from './ui';

async function boot() {
  const config = parseConfig();

  // First statement, before anything touches navigator.mediaDevices or makes a WebGL context.
  // Called rather than relying on an import side effect, so prettier's import sorting can't
  // silently move it.
  const camera = await installMocks(config);

  const media = new Media(config, recordFrame);
  const harness = new E2EHarness(config, camera, media);
  window.harness = harness;

  const render = startPanel(harness);
  buildUi(harness, render);
  media.onChange(render);

  harness.log(`booted with ${window.location.search || '(no query params)'}`);
  const env = harness.env();
  if (!env.transformerSupported) {
    harness.log(
      'ERROR BackgroundTransformer is unsupported here ' +
        `(webgl2=${env.webgl2} offscreenCanvas=${env.offscreenCanvas} videoFrame=${env.videoFrame}). ` +
        'Processor cases will fail at construction.',
    );
  }
  harness.log(
    `pipeline available: ${env.hasModernApiSupport ? 'insertable-streams' : 'canvas-fallback'}`,
  );

  if (config.autostart) {
    await media.startVideo();
    if (config.mode !== 'disabled') await media.setVideoProcessorEnabled(true);
  }

  harness.markReady();
  render();
}

boot().catch((e) => {
  // Boot failures must be visible to a spec, which may never get a harness object.
  document.body.dataset.bootError = (e as Error).message;
  const log = document.getElementById('log');
  if (log) log.textContent = `ERROR boot failed: ${(e as Error).message}\n${(e as Error).stack ?? ''}`;
  console.error('[e2e] boot failed', e);
});
