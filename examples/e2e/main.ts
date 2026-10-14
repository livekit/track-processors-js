import { parseConfig } from './config';
import { E2EHarness } from './harness';
import { installMocks } from './install';
import { installLogCapture } from './logCapture';
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

  // Before `new Media`, which constructs the processor: BackgroundTransformer resolves its
  // logger in its own constructor, so a level applied afterwards would be testing a different
  // thing than an integration that configures logging at startup.
  installLogCapture(config);

  const media = new Media(config, recordFrame);
  const harness = new E2EHarness(config, camera, media);
  window.harness = harness;

  const render = startPanel(harness);
  buildUi(harness, render);
  media.onChange(render);

  harness.log(`booted with ${window.location.search || '(no query params)'}`);
  const env = harness.env();
  const support = harness.support();
  if (!support.supported) {
    // Deliberately not an ERROR line. An unsupported browser is a state the app degrades into
    // (#10, #38), not a failure: no processor was constructed, and the controls that would
    // need one are disabled and say why.
    harness.log(`degraded: ${support.reason}`);
  }
  harness.log(
    `pipeline available: ${env.hasModernApiSupport ? 'insertable-streams' : 'canvas-fallback'}`,
  );

  if (config.autostart) {
    await media.startVideo();
    if (config.mode !== 'disabled' && support.supported) {
      await media.setVideoProcessorEnabled(true);
    }
  }

  harness.markReady();
  render();
}

boot().catch((e) => {
  // Boot failures must be visible to a spec, which may never get a harness object.
  document.body.dataset.bootError = (e as Error).message;
  const log = document.getElementById('log');
  if (log)
    log.textContent = `ERROR boot failed: ${(e as Error).message}\n${(e as Error).stack ?? ''}`;
  console.error('[e2e] boot failed', e);
});
