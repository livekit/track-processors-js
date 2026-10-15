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

/** The level names the library's `setLogLevel` accepts, in ascending severity. */
export type LogLevelName = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'silent';

/**
 * One record the library emitted through its own `setLogExtension` hook.
 *
 * Identified by origin rather than by scraping the console: loglevel binds `console.error` and
 * friends directly, so a library line carries no logger name and is indistinguishable from one
 * livekit-client or the page wrote. `setLogExtension` is the library's documented sink for its
 * internal records, which makes it the only precise answer to "what did the *library* log".
 */
export interface LibraryLogRecord {
  /** Numeric `LogLevel`, exactly as the `LogExtension` signature delivers it. */
  level: number;
  /** The same level by name, so a failure message is readable. */
  levelName: string;
  msg: string;
}

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
  /** Remove one of the primitives `BackgroundTransformer.isSupported` reads, before boot. */
  breakPrimitive?: BrokenPrimitive;
  delegate?: 'CPU' | 'GPU';
  assetPaths?: { tasksVisionFileSet?: string; modelAssetPath?: string };
  maxFps?: number;
  /** `legacy` builds through the deprecated BackgroundBlur()/VirtualBackground() factories. */
  api: 'modern' | 'legacy';
  /**
   * Level handed to the library's `setLogLevel` before the processor is constructed, plus the
   * record capture that goes with it. A parameter rather than a method because
   * `BackgroundTransformer` resolves its logger in its constructor, which `Media` runs at boot.
   * Absent means the page leaves the library's logging alone.
   */
  logLevel?: LogLevelName;
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
  /** UNMASKED_RENDERER_WEBGL, e.g. "ANGLE (Apple, Apple M1 Pro...)" or "SwiftShader". */
  renderer: string | null;
  /**
   * True when WebGL is running on a software rasterizer.
   *
   * Worth knowing before trusting any timing: this library is GPU-bound, and the filter step
   * costs roughly 20x more on SwiftShader than on a real GPU. Several filed issues (#39, #79,
   * #104) are GPU-availability problems.
   */
  softwareRenderer: boolean;
  offscreenCanvas: boolean;
  videoFrame: boolean;
  /** The fourth primitive BackgroundTransformer.isSupported reads. */
  createImageBitmap: boolean;
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
  /** True while the source camera track is muted (`enabled === false`). */
  videoMuted: boolean;
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

/**
 * A pixel-level comparison of the current frame against a stored reference.
 *
 * Region energy says a frame is *as detailed as* the reference; this says it is *the same
 * frame*. Used for passthrough and detach, where the output should be the input rather than
 * merely something with the same statistics.
 */
export interface FrameDiff {
  /** Mean per-channel absolute difference over all pixels, 0-255. */
  meanAbsDiff: number;
  /** Largest per-channel absolute difference at any single pixel, 0-255. */
  maxAbsDiff: number;
  /** Fraction of pixels whose every channel is within `tolerance`. */
  matchingPixelRatio: number;
  width: number;
  height: number;
}

/**
 * A cheap per-frame fingerprint, captured on every presented frame while recording.
 *
 * Deliberately far smaller than a FrameSample: this runs inside the requestVideoFrameCallback
 * on the main thread, so it samples at low resolution and computes only what is needed to tell
 * one visual treatment from another.
 */
export interface FrameFingerprint {
  /** Monotonic presented-frame index from the probe's rVFC counter. */
  index: number;
  t: number;
  hash: string;
  bgMean: Rgb;
  bgBlurEnergy: number;
  fgMean: Rgb;
}

export interface RecordOptions {
  /** Stop capturing after this many frames. Default 600. */
  maxFrames?: number;
  /** Longest edge of the recording canvas. Default 96 — small, to keep up with the frame rate. */
  maxDimension?: number;
  regions?: { fg?: Rect; bg?: Rect };
}

/**
 * Which track the probe reads.
 *
 * `processed` is what the application would publish, `source` bypasses the processor, and
 * `received` is the decoded far end of `harness.loopback` — the frames a remote peer actually
 * gets, after an encode/decode round trip. Only `received` can answer a case about publishing;
 * the other two are both local to the sending side.
 */
export type ProbeSource = 'processed' | 'source' | 'received';

export interface ProbeOptions {
  /** Which track to read. 'source' bypasses the processor; 'received' is the loopback far end. */
  source?: ProbeSource;
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
    /**
     * Contexts explicitly released, via `loseContext()` or a `webglcontextlost` event.
     *
     * Zero while livekit/track-processors-js#136 is open: `cleanup()` never releases the
     * context it made. Instrumented so a fix can be asserted — `created - contextsLost` is the
     * number waiting on GC.
     */
    contextsLost: number;
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

/** Inbound-rtp stats from the receiving end of the in-page loopback. */
export interface LoopbackStatsSample {
  framesDecoded: number;
  framesReceived: number;
  framesPerSecond: number | null;
  frameWidth: number | null;
  frameHeight: number | null;
}

export interface LoopbackControl {
  /** Publish `track` through a self-connected peer pair; resolves once frames are decoding. */
  start(track: MediaStreamTrack, timeoutMs?: number): Promise<void>;
  stop(): Promise<void>;
  isConnected(): boolean;
  stats(): Promise<LoopbackStatsSample | null>;
  /** Mean decoded fps over `windowMs`, counted rather than read from `framesPerSecond`. */
  measure(windowMs?: number): Promise<{ fps: number; framesDecoded: number; elapsedMs: number }>;
  receivedTrack(): MediaStreamTrack | undefined;
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
  /**
   * Resize every live source mid-stream, with no track swap.
   *
   * This is what a resolution change looks like to the library. `restartVideo` does not test it:
   * `LocalVideoTrack.restartTrack` re-acquires the camera and then rebuilds the processor, so
   * every buffer is simply allocated at the new size and nothing ever follows a change. Resizing
   * the compositor canvas leaves the pipeline running and changes the frame size underneath it,
   * which is the path #112 and #128 are about.
   *
   * It also sidesteps `applyConstraints`, which cannot reach the source: once a processor is
   * attached, `LocalTrack.mediaStreamTrack` returns the processor's output track rather than
   * the camera's.
   */
  setResolution(width: number, height: number): void;
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
  /**
   * Rejects when the oscillator's AudioContext is not running.
   *
   * WebKit and iOS suspend an AudioContext until a user gesture, which makes every level()
   * read silent. Audio specs call this first so that failure says so rather than looking like
   * a gain bug.
   */
  assertRunning(): Promise<void>;
}

/** What `FakeMicControl.level()` returns. Named so specs can hold a measurement in a variable. */
export interface AudioLevel {
  /** Root-mean-square amplitude over the window, 0..1. */
  rms: number;
  /** Largest absolute sample in the window, 0..1. Above 1.0 would mean clipping. */
  peak: number;
  /** Centre frequency of the loudest FFT bin. 2048-point FFT, so bins are ~23 Hz apart. */
  dominantHz: number;
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
  /** Mute as an application does it: `enabled = false` on the source track, processor intact. */
  setVideoMuted(muted: boolean): Promise<TrackInfo | null>;
  switchMode(mode: ProcessorMode): Promise<TrackInfo | null>;
  setBackgroundImage(url: string): Promise<TrackInfo | null>;
  setBlurRadius(radius: number): Promise<TrackInfo | null>;
  /**
   * The library's own option merge, with nothing in between.
   *
   * Everything above routes through `switchTo()`, which substitutes a default for any option a
   * mode leaves out — so none of them can express "radius zero" or "no image". Those are exactly
   * the values #37 was about, which is why C7 needs the unmediated call.
   */
  updateTransformerOptions(opts: TransformerOptionUpdate): Promise<TrackInfo | null>;

  setAudioProcessorEnabled(enabled: boolean): Promise<TrackInfo | null>;
  setGain(value: number): void;

  /**
   * The video track a remote peer would receive — the processor's output while one is
   * attached, the raw camera otherwise.
   *
   * Exposed on the interface because a publishing case has to hand exactly this track to
   * `harness.loopback.start()`, and has to be able to name it without knowing whether a
   * processor is attached — which `LocalVideoTrack.mediaStreamTrack` cannot be read for, since
   * `setProcessor` silently repoints it at the processed track.
   */
  processedVideoTrack(): MediaStreamTrack | undefined;

  info(kind?: 'video' | 'audio'): TrackInfo | null;
}

/**
 * The part of the library's `BackgroundOptions` that can be changed on a running processor.
 *
 * `segmenterOptions` and `assetPaths` are deliberately absent: they are read once at
 * construction and need a reload to change, like the query parameters that set them.
 */
export interface TransformerOptionUpdate {
  blurRadius?: number;
  imagePath?: string;
  backgroundDisabled?: boolean;
}

export interface ProbeControl {
  sample(opts?: ProbeOptions): Promise<FrameSample>;
  sampleSeries(opts: ProbeOptions & { count: number; intervalMs?: number }): Promise<FrameSample[]>;
  /** Resolves once `count` further frames have been presented, or rejects on timeout. */
  waitForFrames(
    count: number,
    timeoutMs?: number,
  ): Promise<{ presented: number; elapsedMs: number }>;
  /** Resolves once two consecutive samples hash-match. Use before pixel assertions. */
  waitForStable(opts?: { timeoutMs?: number; intervalMs?: number }): Promise<FrameSample>;
  /** Ground truth from the compositor, or null when the source is not the fake camera. */
  expectedForegroundBox(): Rect | null;
  presentedFrames(): number;

  /**
   * Fingerprint every presented frame until `stopRecording`.
   *
   * This is how mode-switch artifacts are caught: polling with `sample()` cannot prove that no
   * bad frame was published, only that none happened to be observed. Recording sees every frame
   * the track actually delivered.
   */
  startRecording(opts?: RecordOptions): Promise<void>;
  stopRecording(): FrameFingerprint[];
  isRecording(): boolean;

  /**
   * Store the current frame to compare later frames against.
   *
   * Captured at the same scale the diff uses, so source and processed frames stay comparable as
   * long as the track dimensions match — which E1 asserts separately.
   */
  captureReference(opts?: ProbeOptions): Promise<{ width: number; height: number }>;
  /** Compare the current frame against the stored reference. */
  diffFromReference(opts?: ProbeOptions & { tolerance?: number }): Promise<FrameDiff>;

  /**
   * Classify every pixel of every presented frame as foreground or background, and count the
   * ones that change class between consecutive frames.
   *
   * On a static input every flip is segmentation instability rather than input change, which is
   * what makes mask shimmer (#76, #98) an objective number instead of a complaint.
   */
  measureTemporalStability(opts?: TemporalStabilityOptions): Promise<TemporalStability>;
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
  /** Records the library emitted through `setLogExtension`. Empty unless `?loglevel=` was set. */
  libraryLogs(): LibraryLogRecord[];
  clearLibraryLogs(): void;

  stats(): ProcessorStatsSnapshot;
  resetStats(): void;
  counters(): ResourceCounters;

  /** Whether a processor can be built here, and what is missing when it cannot. */
  support(): ProcessorSupport;
  /**
   * Construct a processor deliberately and catch what it throws.
   *
   * The app never calls `BackgroundProcessor()` when `support().supported` is false, which is
   * the whole point of A2 — so a spec that wants to see the documented message needs a way to
   * ask for it explicitly.
   */
  tryCreateProcessor(): ProcessorConstruction;

  camera: FakeCameraControl;
  mic: FakeMicControl;
  media: MediaControl;
  probe: ProbeControl;
  room: RoomControl;
  /** An in-page peer connection, for cases about what reaches the encoder. */
  loopback: LoopbackControl;
}

declare global {
  interface Window {
    harness: Harness;
  }
}

// --------------------------------------------------------------------------- degradation

/**
 * A primitive `?break=` takes away before boot.
 *
 * `BackgroundTransformer.isSupported` reads exactly these four, so removing any one of them is
 * enough to make the library unsupported — which is the environment issues #10 and #38 were
 * reported from, and the one the app has to degrade in rather than throw out of.
 */
export type BrokenPrimitive = 'offscreencanvas' | 'videoframe' | 'createimagebitmap' | 'webgl2';

/** Whether this browser can run a processor, and why not when it cannot. */
export interface ProcessorSupport {
  supported: boolean;
  /** The primitives the library's support checks wanted and did not find. */
  missing: string[];
  /** Shown in the UI beside the disabled controls, and mirrored onto `document.body.dataset`. */
  reason: string | null;
}

/** The outcome of calling `BackgroundProcessor()` on purpose, with its throw caught. */
export interface ProcessorConstruction {
  ok: boolean;
  error: string | null;
}

// --------------------------------------------------------------------------- temporal stability

export interface TemporalStabilityOptions {
  /** How many consecutive presented frames to classify. Default 60. */
  frames?: number;
  timeoutMs?: number;
  /**
   * Longest edge of the classification canvas. Default 160.
   *
   * The flip *rate* is resolution-independent in the sense that it is a fraction rather than a
   * count, but not scale-free: mask churn lives on the silhouette, whose share of the frame
   * grows as resolution falls. Compare runs taken at one `maxDimension`.
   */
  maxDimension?: number;
  /**
   * The plate colour that counts as background — the flat virtual background, normally. Omitted,
   * the background is learned from the first frame's border ring, as `foregroundBox` does, and
   * the same palette then classifies every later frame so a flip means the pixel moved, not that
   * the classifier did.
   */
  background?: Rgb & { tolerance?: number };
}

/**
 * How much the foreground/background split moves from one presented frame to the next.
 *
 * Fed a byte-identical input, a stable segmenter produces the same mask every frame and every
 * number here is zero.
 */
export interface TemporalStability {
  /** Frames actually classified. */
  frames: number;
  /** Frame-to-frame transitions measured, i.e. `frames - 1`. */
  transitions: number;
  pixels: number;
  width: number;
  height: number;
  /** Mean fraction of pixels that changed class per transition. The headline number. */
  flipRate: number;
  /** Worst single transition, which is what a viewer notices. */
  maxFlipRate: number;
  /** Every transition's rate, for diagnostics. */
  rates: number[];
  /** Fraction of pixels that flipped at least once over the whole run — the shimmer band. */
  unstablePixelRatio: number;
  /**
   * Mean fraction of pixels classified foreground.
   *
   * A sanity check on the classifier: at 0 or 1 it found no subject at all, and a flip rate of
   * zero would then mean nothing.
   */
  foregroundRatio: number;
}
