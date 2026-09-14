import { noteTrackCreated } from './counters';
import { fakeMic } from './fakeMic';
import type {
  BackdropKind,
  CameraClock,
  Config,
  FakeCameraControl,
  FakeCameraDevice,
  MotionKind,
  Rect,
  Rgb,
} from './types';

/**
 * A deterministic camera.
 *
 * Browser fake-device flags are not an option across our targets: Firefox's accepts no file,
 * and WebKit and BrowserStack real devices have none at all. So `getUserMedia` is overridden
 * and fed by a canvas compositor whose output is a pure function of an integer frame index.
 *
 * That purity is what the suite needs. A static input redraws identical pixels on every tick,
 * so the stream keeps emitting frames while every frame is bit-identical — something a looping
 * video file cannot do, and exactly what the segmentation-flicker case requires. It also means
 * the harness knows where it drew the subject, so segmentation can be scored against ground
 * truth rather than a golden image.
 */

const DEVICES: FakeCameraDevice[] = [
  { deviceId: 'fake-front', label: 'Fake Camera (front, 640x480)', width: 640, height: 480, facingMode: 'user' },
  { deviceId: 'fake-wide', label: 'Fake Camera (wide, 1280x720)', width: 1280, height: 720, facingMode: 'user' },
  { deviceId: 'fake-portrait', label: 'Fake Camera (portrait, 480x640)', width: 480, height: 640, facingMode: 'user' },
  { deviceId: 'fake-back', label: 'Fake Camera (back, 1280x720)', width: 1280, height: 720, facingMode: 'environment' },
];

const DEVICE_ALIASES: Record<string, string> = {
  front: 'fake-front',
  wide: 'fake-wide',
  portrait: 'fake-portrait',
  back: 'fake-back',
};

/**
 * Where the compositor draws the subject, as a fraction of the frame.
 *
 * Sized for selfie framing: mediapipe's selfie segmenter expects a person occupying much of
 * the frame, and detects a small, distant figure far less reliably.
 */
const SUBJECT_RECT: Rect = { x: 0.2, y: 0.08, w: 0.6, h: 0.92 };

function hexToRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 29, g: 111, b: 165 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function firstNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const c = value as Record<string, unknown>;
    for (const key of ['exact', 'ideal', 'max', 'min']) {
      if (typeof c[key] === 'number') return c[key] as number;
    }
  }
  return undefined;
}

function firstString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : undefined;
  if (value && typeof value === 'object') {
    const c = value as Record<string, unknown>;
    for (const key of ['exact', 'ideal']) {
      const v = c[key];
      if (typeof v === 'string') return v;
      if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
    }
  }
  return undefined;
}

interface Source {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  track: MediaStreamTrack;
  device: FakeCameraDevice;
  width: number;
  height: number;
  /** Set when captureStream(0) + requestFrame is available; lets `manual` be exact. */
  requestFrame?: () => void;
}

export class FakeCamera implements FakeCameraControl {
  readonly installed = true;

  private sources = new Set<Source>();

  private frame = 0;

  private produced = 0;

  private frozen = false;

  private backdrop: BackdropKind;

  private backdropRgb: Rgb;

  private motion: MotionKind;

  private clock: CameraClock;

  private fps: number;

  private subjectVisible = true;

  private subjectImage: HTMLImageElement | null = null;

  private videoSource: HTMLVideoElement | null = null;

  private rafId?: number;

  private intervalId?: ReturnType<typeof setInterval>;

  private worker?: Worker;

  private lastDrawAt = 0;

  constructor(private config: Config) {
    this.backdrop = config.backdrop;
    this.backdropRgb = hexToRgb(config.backdropColor);
    this.motion = config.motion;
    this.clock = config.clock;
    this.fps = config.cameraFps;
  }

  // ------------------------------------------------------------------ install

  async install() {
    await this.loadSubject();
    if (this.config.camSrc) await this.loadVideoSource(this.config.camSrc);

    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices) throw new Error('navigator.mediaDevices is unavailable (needs a secure context)');

    // Both targets are required, for two different reasons.
    //
    // The prototype, because plain assignment to the instance is not reliable on WebKit.
    //
    // The instance, because livekit-client bundles webrtc-adapter, which on import captures the
    // native getUserMedia and installs its own shim as an *own* property of
    // navigator.mediaDevices. An own property shadows the prototype, so a prototype-only
    // override is never reached and every request hits the real camera — which in headless
    // Chrome surfaces as "NotAllowedError: Permission denied".
    //
    // Ordering matters too: this runs from boot(), by which point every static import
    // (livekit-client and its adapter included) has already been evaluated. Installing any
    // earlier would just be overwritten again.
    const define = (target: object, name: string, value: unknown) => {
      Object.defineProperty(target, name, { value, configurable: true, writable: true });
    };
    const getUserMedia = (constraints: MediaStreamConstraints) => this.getUserMedia(constraints);
    const enumerateDevices = async () => this.enumerateDevices();

    define(MediaDevices.prototype, 'getUserMedia', getUserMedia);
    define(mediaDevices, 'getUserMedia', getUserMedia);
    define(MediaDevices.prototype, 'enumerateDevices', enumerateDevices);
    define(mediaDevices, 'enumerateDevices', enumerateDevices);

    this.startClock();
    this.draw();
  }

  private async loadSubject() {
    const url = this.config.subjectUrl ?? '/subject.png';
    try {
      this.subjectImage = await loadImage(url);
    } catch {
      // No cutout committed, or the override 404'd. The procedural figure is the default and
      // needs no asset; see drawProceduralSubject.
      this.subjectImage = null;
    }
  }

  private async loadVideoSource(url: string) {
    const video = document.createElement('video');
    video.src = url;
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    await video.play().catch(() => undefined);
    this.videoSource = video;
  }

  // ------------------------------------------------------------------ gUM

  private async getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
    const stream = new MediaStream();

    if (constraints.video) {
      stream.addTrack(this.createVideoTrack(constraints.video));
    }
    if (constraints.audio) {
      stream.addTrack(fakeMic.createTrack());
    }
    if (stream.getTracks().length === 0) {
      throw new DOMException('At least one of audio and video must be requested', 'TypeError');
    }
    return stream;
  }

  private resolveDevice(constraint: boolean | MediaTrackConstraints): FakeCameraDevice {
    if (typeof constraint !== 'object') return this.defaultDevice();
    const requestedId = firstString(constraint.deviceId);
    if (requestedId) {
      const byId = DEVICES.find((d) => d.deviceId === requestedId);
      if (byId) return byId;
    }
    const facing = firstString(constraint.facingMode);
    if (facing) {
      const byFacing = DEVICES.find((d) => d.facingMode === facing);
      if (byFacing) return byFacing;
    }
    return this.defaultDevice();
  }

  private defaultDevice(): FakeCameraDevice {
    const id = DEVICE_ALIASES[this.config.camera] ?? this.config.camera;
    return DEVICES.find((d) => d.deviceId === id) ?? DEVICES[0];
  }

  private createVideoTrack(constraint: boolean | MediaTrackConstraints): MediaStreamTrack {
    const device = this.resolveDevice(constraint);
    const c: MediaTrackConstraints = typeof constraint === 'object' ? constraint : {};

    const width =
      firstNumber(c.width) ?? this.config.cameraWidth ?? device.width;
    const height =
      firstNumber(c.height) ?? this.config.cameraHeight ?? device.height;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get a 2d context for the fake camera');

    // captureStream(0) only emits on requestFrame, which is what makes `manual` exact. It is
    // not reliable on WebKit, so fall back to a timed capture and let the clock drive it.
    let stream: MediaStream;
    let requestFrame: (() => void) | undefined;
    if (this.clock === 'manual') {
      stream = canvas.captureStream(0);
      const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
      if (typeof track?.requestFrame === 'function') {
        requestFrame = () => track.requestFrame();
      } else {
        stream = canvas.captureStream(this.fps);
      }
    } else {
      stream = canvas.captureStream(this.fps);
    }

    const track = stream.getVideoTracks()[0];
    const source: Source = { canvas, ctx, track, device, width, height, requestFrame };

    // `ProcessorWrapper.setup` blocks on waitForTrackResolution polling getSettings().width,
    // and a canvas-captured track does not always populate it. Define it on the instance —
    // not via a Proxy, which would break `new MediaStreamTrackProcessor({ track })` and
    // `pc.addTrack`, both of which require a genuine platform object.
    Object.defineProperty(track, 'getSettings', {
      value: (): MediaTrackSettings => ({
        width: source.width,
        height: source.height,
        frameRate: this.fps,
        deviceId: device.deviceId,
        groupId: 'fake-camera',
        facingMode: device.facingMode,
        aspectRatio: source.width / source.height,
      }),
      configurable: true,
      writable: true,
    });
    Object.defineProperty(track, 'applyConstraints', {
      value: async (next?: MediaTrackConstraints) => {
        const w = firstNumber(next?.width);
        const h = firstNumber(next?.height);
        if (w && h) this.resize(source, w, h);
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(track, 'label', { value: device.label, configurable: true });

    const originalStop = track.stop.bind(track);
    track.stop = () => {
      this.sources.delete(source);
      originalStop();
    };
    track.addEventListener('ended', () => this.sources.delete(source));

    this.sources.add(source);
    noteTrackCreated(track);
    this.drawSource(source);
    return track;
  }

  private async enumerateDevices(): Promise<MediaDeviceInfo[]> {
    const video = DEVICES.map((d) => ({
      deviceId: d.deviceId,
      groupId: 'fake-camera',
      kind: 'videoinput' as const,
      label: d.label,
      toJSON() {
        return this;
      },
    }));
    const audio = [
      {
        deviceId: 'fake-mic',
        groupId: 'fake-audio',
        kind: 'audioinput' as const,
        label: 'Fake Microphone (tone)',
        toJSON() {
          return this;
        },
      },
      {
        deviceId: 'fake-speaker',
        groupId: 'fake-audio',
        kind: 'audiooutput' as const,
        label: 'Fake Speaker',
        toJSON() {
          return this;
        },
      },
    ];
    return [...video, ...audio] as unknown as MediaDeviceInfo[];
  }

  private resize(source: Source, width: number, height: number) {
    source.width = width;
    source.height = height;
    source.canvas.width = width;
    source.canvas.height = height;
    this.drawSource(source);
  }

  // ------------------------------------------------------------------ clock

  private startClock() {
    this.stopClock();
    switch (this.clock) {
      case 'raf': {
        const loop = () => {
          this.rafId = requestAnimationFrame(loop);
          const now = performance.now();
          if (now - this.lastDrawAt < 1000 / this.fps - 1) return;
          this.lastDrawAt = now;
          this.tick();
        };
        this.rafId = requestAnimationFrame(loop);
        break;
      }
      case 'interval':
        this.intervalId = setInterval(() => this.tick(), 1000 / this.fps);
        break;
      case 'worker': {
        // Worker timers are exempt from the throttling browsers apply to hidden documents,
        // so this keeps the source alive for the backgrounded-tab cases.
        const src = `let id; onmessage = (e) => {
          clearInterval(id);
          if (e.data.stop) return;
          id = setInterval(() => postMessage(0), e.data.intervalMs);
        };`;
        const blob = new Blob([src], { type: 'application/javascript' });
        this.worker = new Worker(URL.createObjectURL(blob));
        this.worker.onmessage = () => this.tick();
        this.worker.postMessage({ intervalMs: 1000 / this.fps });
        break;
      }
      case 'manual':
        break;
    }
  }

  private stopClock() {
    if (this.rafId !== undefined) cancelAnimationFrame(this.rafId);
    if (this.intervalId !== undefined) clearInterval(this.intervalId);
    this.worker?.terminate();
    this.rafId = undefined;
    this.intervalId = undefined;
    this.worker = undefined;
  }

  private tick() {
    if (this.frozen) return;
    if (this.motion !== 'static') this.frame += 1;
    this.draw();
  }

  // ------------------------------------------------------------------ drawing

  private draw() {
    for (const source of this.sources) this.drawSource(source);
    this.produced += 1;
  }

  private drawSource(source: Source) {
    const { ctx, width, height } = source;

    if (this.videoSource && this.videoSource.readyState >= 2) {
      drawCover(ctx, this.videoSource, width, height);
    } else {
      this.drawBackdrop(ctx, width, height);
      if (this.subjectVisible) this.drawSubject(ctx, width, height);
    }
    source.requestFrame?.();
  }

  private drawBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const { r, g, b } = this.backdropRgb;
    switch (this.backdrop) {
      case 'flat':
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fillRect(0, 0, w, h);
        break;
      case 'gradient': {
        const grad = ctx.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0, `rgb(${r}, ${g}, ${b})`);
        grad.addColorStop(1, `rgb(${255 - r}, ${255 - g}, ${255 - b})`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
        break;
      }
      case 'checker': {
        // High-frequency detail, so blur assertions get a wide signal-to-noise margin.
        const cell = Math.max(8, Math.round(Math.min(w, h) / 16));
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = `rgb(${255 - r}, ${255 - g}, ${255 - b})`;
        for (let y = 0; y < h; y += cell) {
          for (let x = 0; x < w; x += cell) {
            if (((x / cell) | 0) % 2 === ((y / cell) | 0) % 2) ctx.fillRect(x, y, cell, cell);
          }
        }
        break;
      }
    }
  }

  private offset(): { dx: number; dy: number } {
    const n = this.frame;
    switch (this.motion) {
      case 'pan':
        return { dx: 0.08 * Math.sin((2 * Math.PI * n) / 120), dy: 0 };
      case 'wave':
        return { dx: 0, dy: 0.02 * Math.sin((2 * Math.PI * n) / 60) };
      case 'static':
      default:
        return { dx: 0, dy: 0 };
    }
  }

  private drawSubject(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const rect = this.subjectRect();
    const x = rect.x * w;
    const y = rect.y * h;
    const rw = rect.w * w;
    const rh = rect.h * h;

    if (this.subjectImage) {
      ctx.drawImage(this.subjectImage, x, y, rw, rh);
      return;
    }
    drawProceduralSubject(ctx, x, y, rw, rh);
  }

  // ------------------------------------------------------------------ control surface

  devices() {
    return DEVICES.map((d) => ({ ...d }));
  }

  setBackdrop(kind: BackdropKind, color?: string) {
    this.backdrop = kind;
    if (color) this.backdropRgb = hexToRgb(color);
    this.draw();
  }

  setMotion(mode: MotionKind) {
    this.motion = mode;
    this.draw();
  }

  setClock(mode: CameraClock) {
    this.clock = mode;
    this.startClock();
  }

  setSubjectVisible(visible: boolean) {
    this.subjectVisible = visible;
    this.draw();
  }

  async setSubjectImage(url: string | null) {
    this.subjectImage = url ? await loadImage(url) : null;
    this.draw();
  }

  setFrame(n: number) {
    this.frame = n;
    this.draw();
  }

  async step(frames = 1) {
    this.frame += frames;
    this.draw();
    // Give the capture pipeline a turn to deliver the frame we just requested.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  freeze() {
    this.frozen = true;
  }

  resume() {
    this.frozen = false;
  }

  frameIndex() {
    return this.frame;
  }

  framesProduced() {
    return this.produced;
  }

  subjectRect(): Rect {
    const { dx, dy } = this.offset();
    return {
      x: SUBJECT_RECT.x + dx,
      y: SUBJECT_RECT.y + dy,
      w: SUBJECT_RECT.w,
      h: SUBJECT_RECT.h,
    };
  }

  backdropColor(): Rgb {
    return { ...this.backdropRgb };
  }

  endSourceTracks() {
    for (const source of [...this.sources]) {
      source.track.dispatchEvent(new Event('ended'));
      source.track.stop();
    }
  }

  emitDeviceChange() {
    navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
  }
}

// --------------------------------------------------------------------------- helpers

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load image: ${url}`));
    img.src = url;
  });
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource & { videoWidth?: number; videoHeight?: number },
  w: number,
  h: number,
) {
  const sw = source.videoWidth ?? w;
  const sh = source.videoHeight ?? h;
  const scale = Math.max(w / sw, h / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.drawImage(source, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

/**
 * A head-and-shoulders figure drawn from primitives, so the harness needs no committed photo.
 *
 * mediapipe's selfie segmenter is trained on real photographs, so mask quality against this is
 * lower than against a real subject — fine for geometry, liveness and pipeline assertions,
 * which is most of the suite. Drop a real cutout at `public/subject.png` (or pass `?subject=`)
 * and it is used instead; the segmentation-quality cases want that.
 */
function drawProceduralSubject(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const cx = x + w / 2;
  const headR = w * 0.26;
  const headCy = y + headR * 1.15;
  const shoulderY = headCy + headR * 1.5;

  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
  ctx.shadowBlur = Math.max(2, w * 0.025);

  // Torso. A vertical gradient reads as lit clothing rather than a flat fill, which the
  // segmenter handles noticeably better than a single colour.
  const shirt = ctx.createLinearGradient(0, shoulderY, 0, y + h);
  shirt.addColorStop(0, '#4a5a78');
  shirt.addColorStop(1, '#2d3850');
  ctx.fillStyle = shirt;
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.52, y + h);
  ctx.quadraticCurveTo(cx - w * 0.5, shoulderY + h * 0.1, cx - w * 0.3, shoulderY);
  ctx.quadraticCurveTo(cx, shoulderY - h * 0.06, cx + w * 0.3, shoulderY);
  ctx.quadraticCurveTo(cx + w * 0.5, shoulderY + h * 0.1, cx + w * 0.52, y + h);
  ctx.closePath();
  ctx.fill();

  // Neck, shaded towards the jaw.
  const neck = ctx.createLinearGradient(0, headCy, 0, shoulderY);
  neck.addColorStop(0, '#a8764f');
  neck.addColorStop(1, '#c99a72');
  ctx.fillStyle = neck;
  ctx.fillRect(cx - headR * 0.34, headCy + headR * 0.5, headR * 0.68, headR * 1.1);

  // Head, lit from the upper left.
  const skin = ctx.createRadialGradient(
    cx - headR * 0.3,
    headCy - headR * 0.35,
    headR * 0.1,
    cx,
    headCy,
    headR * 1.25,
  );
  skin.addColorStop(0, '#f0c9a4');
  skin.addColorStop(0.6, '#d9a377');
  skin.addColorStop(1, '#a8764f');
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.ellipse(cx, headCy, headR * 0.84, headR, 0, 0, Math.PI * 2);
  ctx.fill();

  // Ears
  ctx.beginPath();
  ctx.ellipse(cx - headR * 0.84, headCy + headR * 0.05, headR * 0.13, headR * 0.22, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + headR * 0.84, headCy + headR * 0.05, headR * 0.13, headR * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = 0;

  // Hair
  ctx.fillStyle = '#3a2b23';
  ctx.beginPath();
  ctx.ellipse(cx, headCy - headR * 0.18, headR * 0.9, headR * 0.78, 0, Math.PI, 0);
  ctx.fill();

  // Eyes, brows and mouth. Interior facial detail is what most distinguishes a face from an
  // oval to the segmenter.
  ctx.fillStyle = '#ffffff';
  const eyeY = headCy - headR * 0.05;
  const eyeDx = headR * 0.33;
  const eyeRx = headR * 0.17;
  const eyeRy = headR * 0.1;
  for (const sign of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + sign * eyeDx, eyeY, eyeRx, eyeRy, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#2b2119';
  for (const sign of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(cx + sign * eyeDx, eyeY, eyeRy * 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = '#3a2b23';
  ctx.lineWidth = Math.max(1, headR * 0.07);
  for (const sign of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(cx + sign * eyeDx, eyeY - headR * 0.22, eyeRx * 1.1, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
  }
  ctx.strokeStyle = '#8f5a44';
  ctx.lineWidth = Math.max(1, headR * 0.06);
  ctx.beginPath();
  ctx.arc(cx, headCy + headR * 0.28, headR * 0.3, Math.PI * 0.15, Math.PI * 0.85);
  ctx.stroke();

  // Nose
  ctx.strokeStyle = 'rgba(140, 92, 60, 0.7)';
  ctx.lineWidth = Math.max(1, headR * 0.05);
  ctx.beginPath();
  ctx.moveTo(cx, eyeY + headR * 0.05);
  ctx.lineTo(cx - headR * 0.08, headCy + headR * 0.14);
  ctx.stroke();

  ctx.restore();
}
