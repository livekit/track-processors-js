import type { E2EHarness } from './harness';
import type { BackdropKind, MotionKind } from './types';

/**
 * Control wiring.
 *
 * Every control is a thin wrapper over the same harness method a spec would call, so clicking
 * a button and driving the API take an identical code path. Specs can do either: real browser
 * actions for the behaviour under test, direct calls for setup that shouldn't race the UI.
 */

const ALT_BACKGROUND = '/bg-alt.png';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function buildUi(harness: E2EHarness, render: () => void) {
  const { media, camera, config } = harness;
  const preview = $<HTMLVideoElement>('preview');

  /** Wraps a handler so a rejection lands in the log instead of as an unhandled rejection. */
  const on = (id: string, event: 'click' | 'input' | 'change', fn: () => unknown) => {
    $(id).addEventListener(event, async () => {
      try {
        await fn();
      } catch (e) {
        harness.log(`ERROR ${(e as Error).message}`);
      } finally {
        render();
      }
    });
  };

  const refreshPreview = () => {
    const track = media.processedVideoTrack();
    preview.srcObject = track ? new MediaStream([track]) : null;
    if (track) void preview.play().catch(() => undefined);
  };
  media.onChange(refreshPreview);

  // ---------------------------------------------------------------- camera

  const deviceSelect = $<HTMLSelectElement>('video-device');
  for (const device of camera.devices()) {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.label;
    deviceSelect.appendChild(option);
  }

  const readResolution = () => {
    const raw = $<HTMLSelectElement>('video-resolution').value;
    const match = /^(\d+)x(\d+)$/.exec(raw);
    return match ? { width: Number(match[1]), height: Number(match[2]) } : {};
  };

  on('start-video', 'click', () =>
    media.startVideo({ deviceId: deviceSelect.value || undefined, ...readResolution() }),
  );
  on('stop-video', 'click', () => media.stopVideo());
  on('restart-video', 'click', () =>
    media.restartVideo({ deviceId: deviceSelect.value || undefined, ...readResolution() }),
  );
  on('video-device', 'change', () => media.switchDevice('videoinput', deviceSelect.value));

  // ---------------------------------------------------------------- video processor

  on('attach-processor', 'click', () => media.setVideoProcessorEnabled(true));
  on('detach-processor', 'click', () => media.setVideoProcessorEnabled(false));
  on('switch-disabled', 'click', () => media.switchMode('disabled'));
  on('switch-blur', 'click', () => media.switchMode('background-blur'));
  on('switch-virtual', 'click', () => media.switchMode('virtual-background'));
  on('set-background', 'click', () => {
    const current = harness.snapshot().backgroundImage;
    return media.setBackgroundImage(current === ALT_BACKGROUND ? config.backgroundImage : ALT_BACKGROUND);
  });

  const blurInput = $<HTMLInputElement>('blur-radius');
  blurInput.value = String(config.blurRadius);
  $('blur-radius-value').textContent = String(config.blurRadius);
  on('blur-radius', 'change', () => {
    const radius = Number(blurInput.value);
    $('blur-radius-value').textContent = String(radius);
    return media.setBlurRadius(radius);
  });

  // ---------------------------------------------------------------- audio

  on('start-audio', 'click', () => media.startAudio());
  on('stop-audio', 'click', () => media.stopAudio());
  on('attach-gain', 'click', () => media.setAudioProcessorEnabled(true));
  on('detach-gain', 'click', () => media.setAudioProcessorEnabled(false));

  const gainInput = $<HTMLInputElement>('gain');
  on('gain', 'input', () => {
    const value = Number(gainInput.value);
    $('gain-value').textContent = value.toFixed(1);
    media.setGain(value);
  });
  on('measure-audio', 'click', async () => {
    await harness.mic.assertRunning();
    const level = await harness.mic.level();
    harness.log(
      `audio rms ${level.rms.toFixed(4)} peak ${level.peak.toFixed(4)} dominant ${Math.round(level.dominantHz)}Hz`,
    );
  });

  // ---------------------------------------------------------------- fake camera

  const backdropSelect = $<HTMLSelectElement>('backdrop');
  backdropSelect.value = config.backdrop;
  on('backdrop', 'change', () => camera.setBackdrop(backdropSelect.value as BackdropKind));

  const motionSelect = $<HTMLSelectElement>('motion');
  motionSelect.value = config.motion;
  on('motion', 'change', () => camera.setMotion(motionSelect.value as MotionKind));

  let subjectVisible = true;
  on('toggle-subject', 'click', () => {
    subjectVisible = !subjectVisible;
    camera.setSubjectVisible(subjectVisible);
    $('toggle-subject').textContent = subjectVisible ? 'Hide subject' : 'Show subject';
  });

  let frozen = false;
  on('freeze-camera', 'click', () => {
    frozen = !frozen;
    if (frozen) camera.freeze();
    else camera.resume();
    $('freeze-camera').textContent = frozen ? 'Resume' : 'Freeze';
  });

  on('step-camera', 'click', () => camera.step());
  on('end-source', 'click', () => camera.endSourceTracks());

  // ---------------------------------------------------------------- measure

  on('sample-frame', 'click', async () => {
    const sample = await harness.probe.sample();
    harness.log(
      `sample ${sample.width}x${sample.height} hash ${sample.hash} ` +
        `bgBlurEnergy ${sample.regions.bg.blurEnergy.toFixed(4)} ` +
        `fgBox ${sample.foregroundBox ? formatRect(sample.foregroundBox) : 'none'}`,
    );
  });
  on('reset-stats', 'click', () => harness.resetStats());
  on('clear-log', 'click', () => harness.clearLogs());

  // ---------------------------------------------------------------- room

  const urlInput = $<HTMLInputElement>('room-url');
  const tokenInput = $<HTMLInputElement>('room-token');
  urlInput.value = config.url ?? '';
  tokenInput.value = config.token ?? '';

  on('room-connect', 'click', () => harness.room.connect(urlInput.value, tokenInput.value));
  on('room-publish', 'click', () => harness.room.publish());
  on('room-disconnect', 'click', () => harness.room.disconnect());
}

function formatRect(rect: { x: number; y: number; w: number; h: number }) {
  const f = (n: number) => n.toFixed(2);
  return `${f(rect.x)},${f(rect.y)} ${f(rect.w)}x${f(rect.h)}`;
}
