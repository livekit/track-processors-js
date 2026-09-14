import { BackgroundTransformer, ProcessorWrapper } from '../../src';
import { readCounters } from './counters';
import type { FakeCamera } from './fakeCamera';
import { fakeMic } from './fakeMic';
import { Media } from './media';
import { Probe } from './probe';
import { RoomMode } from './room';
import { resetStats, snapshotStats } from './stats';
import type { AppStateSnapshot, Config, EnvInfo, Harness } from './types';

const MAX_LOG_LINES = 500;

export class E2EHarness implements Harness {
  readonly version = 1 as const;

  isReady = false;

  camera: FakeCamera;

  mic = fakeMic;

  media: Media;

  probe: Probe;

  room: RoomMode;

  config: Readonly<Config>;

  private lines: string[] = [];

  private error: string | null = null;

  private readyResolve!: () => void;

  private readyPromise = new Promise<void>((resolve) => {
    this.readyResolve = resolve;
  });

  constructor(config: Config, camera: FakeCamera, media: Media) {
    this.config = Object.freeze({ ...config });
    this.camera = camera;
    this.media = media;

    this.probe = new Probe(
      (source) =>
        source === 'source' ? media.sourceVideoTrack() : media.processedVideoTrack(),
      () => camera.subjectRect(),
    );

    this.room = new RoomMode(config, media, (message) => this.log(message));

    fakeMic.setMeasurementSource(() => media.processedAudioTrack());
    this.captureErrors();
  }

  markReady() {
    this.isReady = true;
    this.readyResolve();
  }

  whenReady() {
    return this.readyPromise;
  }

  // ------------------------------------------------------------------ logging

  log(...args: unknown[]) {
    const line = args
      .map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a)))
      .join(' ');
    this.lines.push(`${new Date().toISOString().slice(11, 23)} ${line}`);
    if (this.lines.length > MAX_LOG_LINES) this.lines.splice(0, this.lines.length - MAX_LOG_LINES);
    if (line.startsWith('ERROR')) this.error = line;
  }

  logs() {
    return [...this.lines];
  }

  lastError() {
    return this.error;
  }

  clearLogs() {
    this.lines = [];
    this.error = null;
  }

  private captureErrors() {
    window.addEventListener('error', (e) => this.log(`ERROR ${e.message}`));
    window.addEventListener('unhandledrejection', (e) =>
      this.log(`ERROR unhandled rejection: ${String((e as PromiseRejectionEvent).reason)}`),
    );
  }

  // ------------------------------------------------------------------ introspection

  env(): EnvInfo {
    let webgl2 = false;
    let renderer: string | null = null;
    try {
      const gl = document.createElement('canvas').getContext('webgl2');
      webgl2 = !!gl;
      const info = gl?.getExtension('WEBGL_debug_renderer_info');
      if (gl && info) renderer = gl.getParameter(info.UNMASKED_RENDERER_WEBGL) as string;
    } catch {
      webgl2 = false;
    }
    const softwareRenderer = /swiftshader|llvmpipe|software|microsoft basic/i.test(renderer ?? '');
    return {
      userAgent: navigator.userAgent,
      hasModernApiSupport: ProcessorWrapper.hasModernApiSupport,
      processorSupported: ProcessorWrapper.isSupported,
      transformerSupported: BackgroundTransformer.isSupported,
      webgl2,
      renderer,
      softwareRenderer,
      offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
      videoFrame: typeof VideoFrame !== 'undefined',
      insertableStreams:
        typeof MediaStreamTrackGenerator !== 'undefined' &&
        typeof MediaStreamTrackProcessor !== 'undefined',
      requestVideoFrameCallback:
        typeof HTMLVideoElement !== 'undefined' &&
        'requestVideoFrameCallback' in HTMLVideoElement.prototype,
      canvasCaptureStream:
        typeof HTMLCanvasElement !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype,
      audioContext: typeof AudioContext !== 'undefined',
    };
  }

  snapshot(): AppStateSnapshot {
    return {
      video: this.media.info('video'),
      audio: this.media.info('audio'),
      videoProcessorEnabled: this.media.videoProcessorEnabled,
      audioProcessorEnabled: this.media.audioProcessorEnabled,
      mode: this.media.reportedMode(),
      backgroundImage: this.config.backgroundImage,
      blurRadius: this.config.blurRadius,
      gain: this.media.gain,
      room: this.room.snapshot(),
    };
  }

  stats() {
    return snapshotStats();
  }

  resetStats() {
    resetStats();
  }

  counters() {
    return readCounters();
  }
}
