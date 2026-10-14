import type {
  FrameDiff,
  FrameFingerprint,
  FrameSample,
  ProbeControl,
  ProbeOptions,
  RecordOptions,
  Rect,
  RegionStats,
  Rgb,
  TemporalStability,
  TemporalStabilityOptions,
} from './types';

/**
 * Pixel and frame-rate measurement.
 *
 * Reads `processor.processedTrack` through its own video element. It must never read the
 * on-page preview: that is CSS-mirrored, and mirrored pixels would invert every geometry
 * assertion.
 *
 * The element is positioned offscreen rather than hidden. Chrome and WebKit stop decoding into
 * a `display: none` video — and `visibility: hidden` is also unsafe on WebKit — after which
 * drawImage yields a blank or stale frame.
 */

const DEFAULT_MAX_DIMENSION = 320;
const DEFAULT_TOLERANCE = 28;
/** Small enough that fingerprinting keeps up with a 30fps track on the main thread. */
const RECORD_MAX_DIMENSION = 96;
const RECORD_MAX_FRAMES = 600;
/** Two seconds of a 30fps track: long enough for shimmer to show, short enough to stay cheap. */
const STABILITY_FRAMES = 60;
/** Big enough that the silhouette is several hundred pixels long, small enough to keep up. */
const STABILITY_MAX_DIMENSION = 160;

type TrackResolver = (source: 'processed' | 'source') => MediaStreamTrack | undefined;

export class Probe implements ProbeControl {
  private video: HTMLVideoElement;

  private canvas: HTMLCanvasElement;

  private ctx: CanvasRenderingContext2D;

  private presented = 0;

  private boundTrackId: string | null = null;

  private rvfcHandle?: number;

  private recordCanvas: HTMLCanvasElement;

  private recordCtx: CanvasRenderingContext2D;

  private recorded: FrameFingerprint[] | null = null;

  private reference: { data: Uint8ClampedArray; width: number; height: number } | null = null;

  private recordOpts: Required<Pick<RecordOptions, 'maxFrames' | 'maxDimension'>> &
    Pick<RecordOptions, 'regions'> = {
    maxFrames: RECORD_MAX_FRAMES,
    maxDimension: RECORD_MAX_DIMENSION,
  };

  constructor(
    private resolveTrack: TrackResolver,
    private groundTruth: () => Rect | null,
  ) {
    this.video = document.createElement('video');
    this.video.autoplay = true;
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.setAttribute('data-testid', 'probe-video');
    Object.assign(this.video.style, {
      position: 'fixed',
      left: '-10000px',
      top: '0',
      width: '320px',
      height: '240px',
      pointerEvents: 'none',
    });
    document.body.appendChild(this.video);

    this.canvas = document.createElement('canvas');
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Could not get a 2d context for the probe');
    this.ctx = ctx;

    // A separate canvas so a concurrent sample() cannot clobber a recording mid-frame.
    this.recordCanvas = document.createElement('canvas');
    const recordCtx = this.recordCanvas.getContext('2d', { willReadFrequently: true });
    if (!recordCtx) throw new Error('Could not get a 2d context for the probe recorder');
    this.recordCtx = recordCtx;
  }

  presentedFrames() {
    return this.presented;
  }

  expectedForegroundBox() {
    return this.groundTruth();
  }

  // ------------------------------------------------------------------ binding

  private async bind(source: 'processed' | 'source') {
    const track = this.resolveTrack(source);
    if (!track) throw new Error(`No ${source} track to probe. Start the camera first.`);

    if (this.boundTrackId !== track.id) {
      this.boundTrackId = track.id;
      this.presented = 0;
      this.video.srcObject = new MediaStream([track]);
      this.startFrameCounter();
      await this.video.play().catch(() => undefined);
    }
    await this.waitForData();
  }

  private startFrameCounter() {
    const anyVideo = this.video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
      cancelVideoFrameCallback?: (handle: number) => void;
    };
    if (typeof anyVideo.requestVideoFrameCallback !== 'function') return;

    if (this.rvfcHandle !== undefined) anyVideo.cancelVideoFrameCallback?.(this.rvfcHandle);
    const step = () => {
      this.presented += 1;
      if (this.recorded && this.recorded.length < this.recordOpts.maxFrames) {
        try {
          this.recorded.push(this.fingerprint());
        } catch {
          // A frame that cannot be read (zero-sized, or the track just ended) is skipped
          // rather than aborting the recording.
        }
      }
      this.rvfcHandle = anyVideo.requestVideoFrameCallback!(step);
    };
    this.rvfcHandle = anyVideo.requestVideoFrameCallback(step);
  }

  private async waitForData(timeoutMs = 5000) {
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
      if (this.video.readyState >= 2 && this.video.videoWidth > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('Probe video never produced data');
  }

  // ------------------------------------------------------------------ recording

  async startRecording(opts: RecordOptions = {}) {
    await this.bind('processed');
    this.recordOpts = {
      maxFrames: opts.maxFrames ?? RECORD_MAX_FRAMES,
      maxDimension: opts.maxDimension ?? RECORD_MAX_DIMENSION,
      regions: opts.regions,
    };
    this.recorded = [];
    if (this.rvfcHandle === undefined) {
      throw new Error('requestVideoFrameCallback is unavailable; per-frame recording needs it');
    }
  }

  stopRecording(): FrameFingerprint[] {
    const frames = this.recorded ?? [];
    this.recorded = null;
    return frames;
  }

  isRecording() {
    return this.recorded !== null;
  }

  private fingerprint(): FrameFingerprint {
    const srcW = this.video.videoWidth;
    const srcH = this.video.videoHeight;
    if (!srcW || !srcH) throw new Error('no frame');

    const scale = Math.min(1, this.recordOpts.maxDimension / Math.max(srcW, srcH));
    const w = Math.max(2, Math.round(srcW * scale));
    const h = Math.max(2, Math.round(srcH * scale));
    this.recordCanvas.width = w;
    this.recordCanvas.height = h;
    this.recordCtx.drawImage(this.video, 0, 0, w, h);
    const { data } = this.recordCtx.getImageData(0, 0, w, h);

    const fg = this.recordOpts.regions?.fg ??
      this.groundTruth() ?? { x: 0.25, y: 0.15, w: 0.5, h: 0.85 };
    const inFg = rectPredicate(fg, w, h);
    const inBg = this.recordOpts.regions?.bg
      ? rectPredicate(this.recordOpts.regions.bg, w, h)
      : (x: number, y: number) => !inFg(x, y);

    const bg = analyze(data, w, h, inBg);
    const fgStats = analyze(data, w, h, inFg);

    return {
      index: this.presented,
      t: performance.now(),
      hash: averageHash(data, w, h),
      bgMean: bg.mean,
      bgBlurEnergy: bg.blurEnergy,
      fgMean: fgStats.mean,
    };
  }

  // ------------------------------------------------------------------ sampling

  /** Bind, draw the current frame to the sampling canvas and hand back its pixels. */
  private async readFrame(opts: ProbeOptions = {}) {
    await this.bind(opts.source ?? 'processed');

    const srcW = this.video.videoWidth;
    const srcH = this.video.videoHeight;
    const max = opts.maxDimension ?? DEFAULT_MAX_DIMENSION;
    const scale = Math.min(1, max / Math.max(srcW, srcH));
    const w = Math.max(2, Math.round(srcW * scale));
    const h = Math.max(2, Math.round(srcH * scale));

    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx.drawImage(this.video, 0, 0, w, h);
    const { data } = this.ctx.getImageData(0, 0, w, h);

    return { data, w, h, srcW, srcH };
  }

  async sample(opts: ProbeOptions = {}): Promise<FrameSample> {
    const { data, w, h, srcW, srcH } = await this.readFrame(opts);

    const fg = opts.regions?.fg ?? this.groundTruth() ?? { x: 0.25, y: 0.15, w: 0.5, h: 0.85 };
    const bg = opts.regions?.bg;

    const inFg = rectPredicate(fg, w, h);
    const inBg = bg ? rectPredicate(bg, w, h) : (x: number, y: number) => !inFg(x, y);

    const tolerance = opts.expectBackground?.tolerance ?? DEFAULT_TOLERANCE;

    return {
      t: performance.now(),
      width: srcW,
      height: srcH,
      presentedFrames: this.rvfcHandle !== undefined ? this.presented : null,
      hash: averageHash(data, w, h),
      regions: {
        full: analyze(data, w, h, () => true),
        fg: analyze(data, w, h, inFg),
        bg: analyze(data, w, h, inBg),
      },
      backgroundMatchRatio: opts.expectBackground
        ? matchRatio(data, w, h, inBg, opts.expectBackground, tolerance)
        : null,
      foregroundBox: foregroundBox(data, w, h, tolerance),
      ...(opts.includeImage ? { image: this.canvas.toDataURL('image/png') } : {}),
    };
  }

  async sampleSeries(opts: ProbeOptions & { count: number; intervalMs?: number }) {
    const samples: FrameSample[] = [];
    for (let i = 0; i < opts.count; i += 1) {
      samples.push(await this.sample(opts));
      if (i < opts.count - 1) {
        await new Promise((resolve) => setTimeout(resolve, opts.intervalMs ?? 33));
      }
    }
    return samples;
  }

  async waitForFrames(count: number, timeoutMs = 10_000) {
    await this.bind('processed');
    if (this.rvfcHandle === undefined) {
      throw new Error('requestVideoFrameCallback is unavailable; use room.measure() instead');
    }
    const start = this.presented;
    const startedAt = performance.now();
    while (performance.now() - startedAt < timeoutMs) {
      if (this.presented - start >= count) {
        return { presented: this.presented - start, elapsedMs: performance.now() - startedAt };
      }
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    throw new Error(`Only ${this.presented - start} of ${count} frames arrived in ${timeoutMs}ms`);
  }

  // ------------------------------------------------------------------ reference diffing

  /**
   * Grab the current frame as the reference for later `diffFromReference` calls.
   *
   * Only one reference is held; capturing again replaces it.
   */
  async captureReference(opts: ProbeOptions = {}) {
    const { data, w, h } = await this.readFrame(opts);
    // Copy: getImageData hands back a view that the next draw would overwrite.
    this.reference = { data: new Uint8ClampedArray(data), width: w, height: h };
    return { width: w, height: h };
  }

  async diffFromReference(opts: ProbeOptions & { tolerance?: number } = {}): Promise<FrameDiff> {
    const reference = this.reference;
    if (!reference) throw new Error('No reference captured. Call captureReference() first.');

    const { data, w, h } = await this.readFrame(opts);
    if (w !== reference.width || h !== reference.height) {
      throw new Error(
        `Frame is ${w}x${h} but the reference is ${reference.width}x${reference.height}; they cannot be compared`,
      );
    }

    const tolerance = opts.tolerance ?? DEFAULT_TOLERANCE;
    let sum = 0;
    let max = 0;
    let matching = 0;
    const pixels = w * h;

    for (let i = 0; i < pixels; i += 1) {
      const o = i * 4;
      const dr = Math.abs(data[o] - reference.data[o]);
      const dg = Math.abs(data[o + 1] - reference.data[o + 1]);
      const db = Math.abs(data[o + 2] - reference.data[o + 2]);
      sum += dr + dg + db;
      const worst = Math.max(dr, dg, db);
      if (worst > max) max = worst;
      if (worst <= tolerance) matching += 1;
    }

    return {
      meanAbsDiff: pixels ? sum / (pixels * 3) : 0,
      maxAbsDiff: max,
      matchingPixelRatio: pixels ? matching / pixels : 0,
      width: w,
      height: h,
    };
  }

  // ------------------------------------------------------------------ temporal stability

  /**
   * Counts pixels whose foreground/background classification flips between consecutive frames.
   *
   * Driven by `requestVideoFrameCallback` rather than by polling, for the same reason the
   * recorder is: a poll can only report the frames it happened to catch, and shimmer is
   * precisely what happens between them. Every presented frame is classified.
   *
   * Classification is a colour match against a fixed palette — the virtual-background plate, or
   * the first frame's border ring. The palette is learned once and reused, so a flip always
   * means the pixel changed side, never that the classifier drifted.
   */
  async measureTemporalStability(opts: TemporalStabilityOptions = {}): Promise<TemporalStability> {
    await this.bind('processed');
    const anyVideo = this.video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
    };
    if (typeof anyVideo.requestVideoFrameCallback !== 'function') {
      throw new Error('requestVideoFrameCallback is unavailable; stability needs every frame');
    }

    const wanted = opts.frames ?? STABILITY_FRAMES;
    const timeoutMs = opts.timeoutMs ?? 20_000;
    const maxDimension = opts.maxDimension ?? STABILITY_MAX_DIMENSION;
    const tolerance = opts.background?.tolerance ?? DEFAULT_TOLERANCE;

    // A canvas of its own, so a concurrent sample() or recording cannot clobber a frame
    // mid-classification.
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Could not get a 2d context for the stability measurement');

    let palette: Rgb[] | null = opts.background
      ? [{ r: opts.background.r, g: opts.background.g, b: opts.background.b }]
      : null;
    let previous: Uint8Array | null = null;
    let everFlipped = new Uint8Array(0);
    let unstablePixels = 0;
    const rates: number[] = [];
    let backgroundPixels = 0;
    let observed = 0;
    let w = 0;
    let h = 0;

    const classifyOne = () => {
      const srcW = this.video.videoWidth;
      const srcH = this.video.videoHeight;
      if (!srcW || !srcH) throw new Error('no frame');

      const scale = Math.min(1, maxDimension / Math.max(srcW, srcH));
      const fw = Math.max(2, Math.round(srcW * scale));
      const fh = Math.max(2, Math.round(srcH * scale));
      canvas.width = fw;
      canvas.height = fh;
      ctx.drawImage(this.video, 0, 0, fw, fh);
      const { data } = ctx.getImageData(0, 0, fw, fh);

      if (!palette) palette = borderPalette(data, fw, fh);
      if (palette.length === 0) throw new Error('no background palette could be learned');

      const mask = classifyBackground(data, fw * fh, palette, tolerance);
      for (let i = 0; i < mask.length; i += 1) backgroundPixels += mask[i];

      // A resolution change mid-run makes the two masks incomparable; start again from here
      // rather than reporting a flip for every pixel.
      if (previous && previous.length === mask.length) {
        let flips = 0;
        for (let i = 0; i < mask.length; i += 1) {
          if (mask[i] !== previous[i]) {
            flips += 1;
            if (everFlipped[i] === 0) {
              everFlipped[i] = 1;
              unstablePixels += 1;
            }
          }
        }
        rates.push(flips / mask.length);
      } else {
        everFlipped = new Uint8Array(mask.length);
        unstablePixels = 0;
      }

      previous = mask;
      observed += 1;
      w = fw;
      h = fh;
    };

    await new Promise<void>((resolve) => {
      const deadline = performance.now() + timeoutMs;
      // Belt and braces: if frames stop arriving altogether the callback never runs again, so
      // the deadline check inside it would never fire either.
      const timer = setTimeout(resolve, timeoutMs + 250);
      const step = () => {
        try {
          classifyOne();
        } catch {
          // A frame that cannot be read — zero-sized, or the track just ended — is skipped
          // rather than aborting the measurement.
        }
        if (observed >= wanted || performance.now() > deadline) {
          clearTimeout(timer);
          resolve();
          return;
        }
        anyVideo.requestVideoFrameCallback!(step);
      };
      anyVideo.requestVideoFrameCallback!(step);
    });

    if (rates.length === 0) {
      throw new Error(`Stability needs at least two comparable frames; got ${observed}`);
    }

    const pixels = w * h;
    return {
      frames: observed,
      transitions: rates.length,
      pixels,
      width: w,
      height: h,
      flipRate: rates.reduce((sum, r) => sum + r, 0) / rates.length,
      maxFlipRate: rates.reduce((max, r) => Math.max(max, r), 0),
      rates,
      unstablePixelRatio: pixels ? unstablePixels / pixels : 0,
      foregroundRatio: observed && pixels ? 1 - backgroundPixels / (observed * pixels) : 0,
    };
  }

  async waitForStable(opts: { timeoutMs?: number; intervalMs?: number } = {}) {
    const deadline = performance.now() + (opts.timeoutMs ?? 5000);
    let previous = await this.sample();
    while (performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, opts.intervalMs ?? 50));
      const next = await this.sample();
      if (next.hash === previous.hash) return next;
      previous = next;
    }
    throw new Error('Frames never stabilized; is the input set to motion=static?');
  }
}

// --------------------------------------------------------------------------- pixel maths

type Predicate = (x: number, y: number) => boolean;

function rectPredicate(rect: Rect, w: number, h: number): Predicate {
  const x0 = rect.x * w;
  const y0 = rect.y * h;
  const x1 = (rect.x + rect.w) * w;
  const y1 = (rect.y + rect.h) * h;
  return (x, y) => x >= x0 && x < x1 && y >= y0 && y < y1;
}

function luma(data: Uint8ClampedArray, i: number) {
  return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
}

function analyze(data: Uint8ClampedArray, w: number, h: number, include: Predicate): RegionStats {
  let n = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumL = 0;
  let sumL2 = 0;

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!include(x, y)) continue;
      const i = (y * w + x) * 4;
      sumR += data[i];
      sumG += data[i + 1];
      sumB += data[i + 2];
      const l = luma(data, i);
      sumL += l;
      sumL2 += l * l;
      n += 1;
    }
  }

  if (n === 0) {
    return { mean: { r: 0, g: 0, b: 0 }, stdDev: 0, blurEnergy: 0, edgeDensity: 0 };
  }

  const meanL = sumL / n;
  const variance = Math.max(0, sumL2 / n - meanL * meanL);

  // Laplacian and Sobel need neighbours, so interior pixels only.
  let lapSum = 0;
  let lapCount = 0;
  let edges = 0;
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      if (!include(x, y)) continue;
      const i = (y * w + x) * 4;
      const c = luma(data, i);
      const up = luma(data, i - w * 4);
      const down = luma(data, i + w * 4);
      const left = luma(data, i - 4);
      const right = luma(data, i + 4);

      lapSum += Math.abs(4 * c - up - down - left - right);
      const gx = right - left;
      const gy = down - up;
      if (Math.sqrt(gx * gx + gy * gy) > 40) edges += 1;
      lapCount += 1;
    }
  }

  return {
    mean: { r: sumR / n, g: sumG / n, b: sumB / n },
    stdDev: Math.sqrt(variance),
    blurEnergy: lapCount ? lapSum / lapCount / 255 : 0,
    edgeDensity: lapCount ? edges / lapCount : 0,
  };
}

function matchRatio(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  include: Predicate,
  expect: Rgb,
  tolerance: number,
): number {
  let n = 0;
  let hits = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!include(x, y)) continue;
      const i = (y * w + x) * 4;
      const distance = Math.max(
        Math.abs(data[i] - expect.r),
        Math.abs(data[i + 1] - expect.g),
        Math.abs(data[i + 2] - expect.b),
      );
      if (distance <= tolerance) hits += 1;
      n += 1;
    }
  }
  return n ? hits / n : 0;
}

/**
 * Bounding box of everything that differs from the frame's own background.
 *
 * The background is learned from a border ring rather than from the compositor, so this stays
 * correct in blur and virtual-background modes alike, where the background is a different
 * colour each time.
 *
 * It has to be learned as a small *palette*, not a mean: the default `checker` backdrop has two
 * alternating colours whose average is a mid-grey that matches neither, which would classify
 * the entire frame as foreground and return a full-frame box.
 */
function foregroundBox(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  tolerance: number,
): (Rect & { coverage: number }) | null {
  const palette = borderPalette(data, w, h);
  if (palette.length === 0) return null;

  const isBackground = (i: number) =>
    palette.some(
      (c) =>
        Math.max(
          Math.abs(data[i] - c.r),
          Math.abs(data[i + 1] - c.g),
          Math.abs(data[i + 2] - c.b),
        ) <= tolerance,
    );

  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  let differing = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      if (isBackground(i)) continue;
      differing += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;

  return {
    x: minX / w,
    y: minY / h,
    w: (maxX - minX + 1) / w,
    h: (maxY - minY + 1) / h,
    coverage: differing / (w * h),
  };
}

/** The up-to-3 most common colours around the frame edge, coarsely quantized. */
function borderPalette(data: Uint8ClampedArray, w: number, h: number): Rgb[] {
  const BUCKET = 32;
  const bins = new Map<number, { r: number; g: number; b: number; n: number }>();
  const ring = Math.max(1, Math.round(Math.min(w, h) * 0.04));

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (x >= ring && y >= ring && x < w - ring && y < h - ring) continue;
      const i = (y * w + x) * 4;
      const key =
        ((data[i] / BUCKET) | 0) * 10_000 +
        ((data[i + 1] / BUCKET) | 0) * 100 +
        ((data[i + 2] / BUCKET) | 0);
      const bin = bins.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
      bin.r += data[i];
      bin.g += data[i + 1];
      bin.b += data[i + 2];
      bin.n += 1;
      bins.set(key, bin);
    }
  }

  const border = [...bins.values()].sort((a, b) => b.n - a.n);
  const totalBorderPixels = border.reduce((sum, bin) => sum + bin.n, 0);
  if (totalBorderPixels === 0) return [];

  // Ignore rare bins: they are usually the subject intruding into the ring, or blur bleed.
  return border
    .filter((bin) => bin.n / totalBorderPixels >= 0.08)
    .slice(0, 3)
    .map((bin) => ({ r: bin.r / bin.n, g: bin.g / bin.n, b: bin.b / bin.n }));
}

/**
 * One byte per pixel: 1 where the pixel matches the background palette, 0 where it does not.
 *
 * The same rule `foregroundBox` applies, kept per pixel instead of reduced to a bounding box,
 * because the question here is which pixels changed side rather than how far the subject reaches.
 */
function classifyBackground(
  data: Uint8ClampedArray,
  pixels: number,
  palette: Rgb[],
  tolerance: number,
): Uint8Array {
  const mask = new Uint8Array(pixels);
  for (let i = 0; i < pixels; i += 1) {
    const o = i * 4;
    for (let c = 0; c < palette.length; c += 1) {
      const colour = palette[c];
      const distance = Math.max(
        Math.abs(data[o] - colour.r),
        Math.abs(data[o + 1] - colour.g),
        Math.abs(data[o + 2] - colour.b),
      );
      if (distance <= tolerance) {
        mask[i] = 1;
        break;
      }
    }
  }
  return mask;
}

/** 8x8 average hash. Equal hashes mean a visually identical frame. */
function averageHash(data: Uint8ClampedArray, w: number, h: number): string {
  const cells = new Float64Array(64);
  const counts = new Float64Array(64);
  for (let y = 0; y < h; y += 1) {
    const cy = Math.min(7, Math.floor((y / h) * 8));
    for (let x = 0; x < w; x += 1) {
      const cx = Math.min(7, Math.floor((x / w) * 8));
      const cell = cy * 8 + cx;
      cells[cell] += luma(data, (y * w + x) * 4);
      counts[cell] += 1;
    }
  }
  let total = 0;
  for (let i = 0; i < 64; i += 1) {
    cells[i] = counts[i] ? cells[i] / counts[i] : 0;
    total += cells[i];
  }
  const mean = total / 64;

  let hex = '';
  for (let nibble = 0; nibble < 16; nibble += 1) {
    let value = 0;
    for (let bit = 0; bit < 4; bit += 1) {
      if (cells[nibble * 4 + bit] >= mean) value |= 1 << (3 - bit);
    }
    hex += value.toString(16);
  }
  return hex;
}
