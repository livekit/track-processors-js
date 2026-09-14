import type { E2EHarness } from './harness';

/**
 * Renders the readouts and mirrors the values a spec is most likely to wait on onto
 * `document.body.dataset`, so selectors never have to read button label text.
 */

const REFRESH_MS = 500;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function round(value: number, places = 1) {
  return Number(value.toFixed(places));
}

export function startPanel(harness: E2EHarness) {
  const state = $('state-readout');
  const stats = $('stats-readout');
  const env = $('env-readout');
  const counters = $('counters-readout');
  const log = $('log');

  env.textContent = JSON.stringify(harness.env(), null, 2);

  const render = () => {
    const snapshot = harness.snapshot();
    state.textContent = JSON.stringify(snapshot, null, 2);

    const s = harness.stats();
    stats.textContent = s.frames
      ? [
          `frames      ${s.frames}`,
          `fps         ${round(s.fps)}`,
          `processing  p50 ${round(s.processingMs.p50)}ms  p95 ${round(s.processingMs.p95)}ms`,
          `segmentation p50 ${round(s.segmentationMs.p50)}ms  p95 ${round(s.segmentationMs.p95)}ms`,
          `filter      p50 ${round(s.filterMs.p50)}ms  p95 ${round(s.filterMs.p95)}ms`,
        ].join('\n')
      : 'no frames yet';

    counters.textContent = JSON.stringify(harness.counters(), null, 2);
    log.textContent = harness.logs().slice(-100).join('\n');
    log.scrollTop = log.scrollHeight;

    const { dataset } = document.body;
    dataset.ready = String(harness.isReady);
    dataset.mode = snapshot.mode;
    dataset.pipeline = snapshot.video?.pipeline ?? 'none';
    dataset.videoProcessor = String(snapshot.videoProcessorEnabled);
    dataset.audioProcessor = String(snapshot.audioProcessorEnabled);
    dataset.videoTrack = snapshot.video ? 'live' : 'none';
    // A MediaStreamTrackGenerator track reports no width/height, so processedSettings is
    // usually empty on the modern path. Fall back to the source, and note that the only
    // reliable measure of real output size is probe.sample().width/height.
    const settings = snapshot.video?.processedSettings?.width
      ? snapshot.video.processedSettings
      : snapshot.video?.settings;
    dataset.resolution = settings?.width ? `${settings.width}x${settings.height}` : 'none';
  };

  render();
  setInterval(render, REFRESH_MS);
  return render;
}
