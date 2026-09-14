/**
 * Shared types for the e2e harness app.
 *
 * The Playwright suite imports these with `import type` so specs compile against the real
 * surface rather than a hand-maintained copy. Keep this file free of runtime imports.
 */

import type { BackgroundOptions } from '../../src';

/**
 * The stats object handed to `onFrameProcessed`.
 *
 * `FrameProcessingStats` is declared in src/transformers/BackgroundTransformer.ts and named by
 * the public `BackgroundOptions.onFrameProcessed` signature, but it is not re-exported from
 * src/index.ts — so a consumer cannot name the type it is handed. Derived from the public
 * surface here rather than reaching into the internal path, which is the pattern that broke
 * Angular builds in issue #115. A one-line export in src/index.ts would remove the need.
 */
export type FrameProcessingStats = Parameters<
  NonNullable<BackgroundOptions['onFrameProcessed']>
>[0];

export type ProcessorMode = 'background-blur' | 'virtual-background' | 'disabled';

/** What `BackgroundProcessorWrapper.mode` can report, plus "no processor attached". */
export type ReportedMode = ProcessorMode | 'legacy' | 'off';

export type PipelinePath = 'insertable-streams' | 'canvas-fallback' | 'none';

export type BackdropKind = 'flat' | 'checker' | 'gradient';

export type MotionKind = 'static' | 'pan' | 'wave';

export type CameraClock = 'raf' | 'interval' | 'worker' | 'manual';

/** Normalized to 0..1 against the frame's own width and height. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

// --------------------------------------------------------------------------- config

export interface Config {
  /** Force the canvas.captureStream fallback by removing the insertable-streams globals. */
  forceFallback: boolean;
  delegate?: 'CPU' | 'GPU';
  assetPaths?: { tasksVisionFileSet?: string; modelAssetPath?: string };
  maxFps?: number;
  /** `legacy` builds through the deprecated BackgroundBlur()/VirtualBackground() factories. */
  api: 'modern' | 'legacy';
  /** `capture` passes the processor through VideoCaptureOptions instead of setProcessor. */
  attach: 'set' | 'capture';
  mode: ProcessorMode;
  blurRadius: number;
  backgroundImage: string;
  camera: string;
  cameraWidth?: number;
  cameraHeight?: number;
  backdrop: BackdropKind;
  backdropColor: string;
  motion: MotionKind;
  clock: CameraClock;
  cameraFps: number;
  /** Override the procedural subject with an image (expects alpha). */
  subjectUrl?: string;
  /** Replace the whole compositor with a video file. Escape hatch; unused by the suite. */
  camSrc?: string;
  autostart: boolean;
  url?: string;
  token?: string;
}

// --------------------------------------------------------------------------- env & state

export interface EnvInfo {
  userAgent: string;
  /** ProcessorWrapper.hasModernApiSupport */
  hasModernApiSupport: boolean;
  /** ProcessorWrapper.isSupported */
  processorSupported: boolean;
  /** BackgroundTransformer.isSupported */
  transformerSupported: boolean;
  webgl2: boolean;
  offscreenCanvas: boolean;
  videoFrame: boolean;
  insertableStreams: boolean;
  requestVideoFrameCallback: boolean;
  canvasCaptureStream: boolean;
  audioContext: boolean;
}

export interface TrackInfo {
  id: string;
  kind: 'video' | 'audio';
  label: string;
  readyState: MediaStreamTrackState;
  /** Settings of the source track handed to the processor. */
  settings: MediaTrackSettings;
  processorName: string | null;
  processedTrackId: string | null;
  /**
   * Settings of the track the processor publishes, or null when no processor is attached.
   *
   * Frequently empty of dimensions: on the insertable-streams path the published track is a
   * MediaStreamTrackGenerator, which reports no width/height. For real output dimensions use
   * `probe.sample()`, whose width/height come from the decoded frame itself.
   */
  processedSettings: MediaTrackSettings | null;
  pipeline: PipelinePath;
  mode: ReportedMode;
}

export interface AppStateSnapshot {
  video: TrackInfo | null;
  audio: TrackInfo | null;
  videoProcessorEnabled: boolean;
  audioProcessorEnabled: boolean;
  mode: ReportedMode;
  backgroundImage: string | null;
  blurRadius: number | null;
  gain: number;
  room: { connected: boolean; name: string | null; published: boolean } | null;
}

// --------------------------------------------------------------------------- measurement

export interface RegionStats {
  mean: Rgb;
  /** Population standard deviation of luminance, 0..255. */
  stdDev: number;
  /** Mean |Laplacian| of luminance normalized to 0..1. Lower is blurrier. */
  blurEnergy: number;
  /** Fraction of pixels whose Sobel magnitude clears a fixed threshold. */
  edgeDensity: number;
}

export interface FrameSample {
  t: number;
  width: number;
  height: number;
  /** Cumulative frames presented by the probe video, when requestVideoFrameCallback exists. */
  presentedFrames: number | null;
  /** 64-bit average hash as hex. Equal hashes mean a visually identical frame. */
  hash: string;
  regions: { full: RegionStats; fg: RegionStats; bg: RegionStats };
  /** Fraction of background-region pixels within tolerance of `expectBackground`. */
  backgroundMatchRatio: number | null;
  /** Bounding box of pixels differing from the frame's own border colour. */
  foregroundBox: (Rect & { coverage: number }) | null;
  /** PNG data URL, only when `includeImage` was requested. */
  image?: string;
}

export interface ProbeOptions {
  /** Which track to read. 'source' bypasses the processor. */
  source?: 'processed' | 'source';
  regions?: { fg?: Rect; bg?: Rect };
  expectBackground?: Rgb & { tolerance?: number };
  includeImage?: boolean;
  /** Longest edge of the sampling canvas. Smaller is faster; default 320. */
  maxDimension?: number;
}

export interface Percentiles {
  mean: number;
  p50: number;
  p95: number;
}

export interface ProcessorStatsSnapshot {
  frames: number;
  /** Frames per second over the retained window. */
  fps: number;
  windowMs: number;
  processingMs: Percentiles;
  segmentationMs: Percentiles;
  filterMs: Percentiles;
}

export interface ResourceCounters {
  webgl: {
    created: number;
    byType: { webgl: number; webgl2: number };
    /** Best effort. GC timing is not controllable, so treat as diagnostic only. */
    liveWeak: number;
  };
  workers: { created: number; terminated: number; live: number };
  audioContexts: { created: number; closed: number; live: number };
  tracks: { created: number; ended: number; live: number };
  canvases: { created: number; inDom: number; processorCanvases: number };
}

export interface SenderStatsSample {
  framesEncoded: number;
  framesSent: number;
  framesPerSecond: number | null;
  frameWidth: number | null;
  frameHeight: number | null;
  qualityLimitationReason?: string;
}

// --------------------------------------------------------------------------- controls

export interface FakeCameraDevice {
  deviceId: string;
  label: string;
  width: number;
  height: number;
  facingMode: 'user' | 'environment';
}

export interface FakeCameraControl {
  readonly installed: boolean;
  devices(): FakeCameraDevice[];
  setBackdrop(kind: BackdropKind, color?: string): void;
  setMotion(mode: MotionKind): void;
  setClock(mode: CameraClock): void;
  setSubjectVisible(visible: boolean): void;
  /** Swap the subject for an image at `url`; pass null to return to the procedural figure. */
  setSubjectImage(url: string | null): Promise<void>;
  setFrame(n: number): void;
  /** Advance the frame index. Only deterministic under clock 'manual'. */
  step(frames?: number): Promise<void>;
  freeze(): void;
  resume(): void;
  frameIndex(): number;
  framesProduced(): number;
  /** Ground truth: where the compositor actually drew the subject. */
  subjectRect(): Rect;
  backdropColor(): Rgb;
  /** Ends every live fake source track, exercising the media-exhausted path. */
  endSourceTracks(): void;
  emitDeviceChange(): void;
}

export interface FakeMicControl {
  readonly installed: boolean;
  setFrequency(hz: number): void;
  setAmplitude(a: number): void;
  /** Measures the published audio track. Returns silence-level rms if nothing is flowing. */
  level(windowMs?: number): Promise<{ rms: number; peak: number; dominantHz: number }>;
}

export interface StartVideoOptions {
  deviceId?: string;
  width?: number;
  height?: number;
  /** Attach through VideoCaptureOptions.processor rather than a later setProcessor call. */
  processorAtCapture?: boolean;
}

export interface MediaControl {
  startVideo(opts?: StartVideoOptions): Promise<TrackInfo>;
  stopVideo(): Promise<void>;
  restartVideo(opts?: { deviceId?: string; width?: number; height?: number }): Promise<TrackInfo>;
  startAudio(opts?: { gain?: number }): Promise<TrackInfo>;
  stopAudio(): Promise<void>;
  switchDevice(kind: MediaDeviceKind, deviceId: string): Promise<void>;

  setVideoProcessorEnabled(enabled: boolean): Promise<TrackInfo | null>;
  switchMode(mode: ProcessorMode): Promise<TrackInfo | null>;
  setBackgroundImage(url: string): Promise<TrackInfo | null>;
  setBlurRadius(radius: number): Promise<TrackInfo | null>;

  setAudioProcessorEnabled(enabled: boolean): Promise<TrackInfo | null>;
  setGain(value: number): void;

  info(kind?: 'video' | 'audio'): TrackInfo | null;
}

export interface ProbeControl {
  sample(opts?: ProbeOptions): Promise<FrameSample>;
  sampleSeries(
    opts: ProbeOptions & { count: number; intervalMs?: number },
  ): Promise<FrameSample[]>;
  /** Resolves once `count` further frames have been presented, or rejects on timeout. */
  waitForFrames(count: number, timeoutMs?: number): Promise<{ presented: number; elapsedMs: number }>;
  /** Resolves once two consecutive samples hash-match. Use before pixel assertions. */
  waitForStable(opts?: { timeoutMs?: number; intervalMs?: number }): Promise<FrameSample>;
  /** Ground truth from the compositor, or null when the source is not the fake camera. */
  expectedForegroundBox(): Rect | null;
  presentedFrames(): number;
}

export interface RoomControl {
  connect(url?: string, token?: string): Promise<void>;
  disconnect(): Promise<void>;
  publish(): Promise<void>;
  unpublish(): Promise<void>;
  isConnected(): boolean;
  senderStats(): Promise<SenderStatsSample | null>;
  /** framesEncoded delta and mean fps over `windowMs`. The freeze-detection primitive. */
  measure(windowMs: number): Promise<{ fps: number; framesEncodedDelta: number }>;
}

export interface Harness {
  readonly version: 1;
  readonly isReady: boolean;
  whenReady(): Promise<void>;

  config: Readonly<Config>;
  env(): EnvInfo;
  snapshot(): AppStateSnapshot;
  logs(): string[];
  lastError(): string | null;
  clearLogs(): void;

  stats(): ProcessorStatsSnapshot;
  resetStats(): void;
  counters(): ResourceCounters;

  camera: FakeCameraControl;
  mic: FakeMicControl;
  media: MediaControl;
  probe: ProbeControl;
  room: RoomControl;
}

declare global {
  interface Window {
    harness: Harness;
  }
}
