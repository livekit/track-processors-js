import type { ResourceCounters } from './types';

/**
 * Resource counters for leak detection.
 *
 * `created` counts are exact and are what assertions should use. `live` counts rest on
 * FinalizationRegistry, which offers no timing guarantee and cannot be forced outside
 * Chromium's CDP — treat them as diagnostic only.
 *
 * Note that `src/webgl/index.ts` `cleanup()` never calls `loseContext()` and
 * `VideoTransformer.destroy()` only drops the reference, so contexts created per
 * setProcessor/stopProcessor cycle survive until GC. A linearly growing `webgl.created`
 * across cycles is a real library finding, not a harness artifact.
 */

let installed = false;

const counts = {
  webglCreated: 0,
  webgl1: 0,
  webgl2: 0,
  workersCreated: 0,
  workersTerminated: 0,
  audioCreated: 0,
  audioClosed: 0,
  tracksCreated: 0,
  tracksEnded: 0,
  canvasesCreated: 0,
};

const liveWebgl = new Set<WeakRef<object>>();
const liveWorkers = new Set<Worker>();
const liveAudioContexts = new Set<AudioContext>();
const liveTracks = new Set<WeakRef<MediaStreamTrack>>();

const registry =
  typeof FinalizationRegistry !== 'undefined'
    ? new FinalizationRegistry<{ set: Set<WeakRef<object>>; ref: WeakRef<object> }>((held) => {
        held.set.delete(held.ref);
      })
    : undefined;

function trackWeak(set: Set<WeakRef<any>>, value: object) {
  const ref = new WeakRef(value);
  set.add(ref);
  registry?.register(value, { set, ref });
}

function pruneDead(set: Set<WeakRef<any>>): number {
  for (const ref of set) {
    if (ref.deref() === undefined) set.delete(ref);
  }
  return set.size;
}

/** Counts a track the harness itself created, since fake tracks bypass the patched paths. */
export function noteTrackCreated(track: MediaStreamTrack) {
  counts.tracksCreated += 1;
  trackWeak(liveTracks, track);
}

export function installCounters() {
  if (installed) return;
  installed = true;

  const patchGetContext = (proto: any) => {
    if (!proto?.getContext) return;
    const original = proto.getContext;
    proto.getContext = function patched(this: any, kind: string, ...rest: unknown[]) {
      const context = original.call(this, kind, ...rest);
      if (context && (kind === 'webgl' || kind === 'webgl2' || kind === 'experimental-webgl')) {
        counts.webglCreated += 1;
        if (kind === 'webgl2') counts.webgl2 += 1;
        else counts.webgl1 += 1;
        trackWeak(liveWebgl, context);
      }
      return context;
    };
  };

  patchGetContext(typeof HTMLCanvasElement !== 'undefined' ? HTMLCanvasElement.prototype : null);
  patchGetContext(typeof OffscreenCanvas !== 'undefined' ? OffscreenCanvas.prototype : null);

  if (typeof document !== 'undefined') {
    const originalCreate = document.createElement.bind(document);
    document.createElement = function patched(tagName: string, options?: ElementCreationOptions) {
      if (String(tagName).toLowerCase() === 'canvas') counts.canvasesCreated += 1;
      return originalCreate(tagName as any, options);
    } as typeof document.createElement;
  }

  if (typeof Worker !== 'undefined') {
    const OriginalWorker = Worker;
    const PatchedWorker = function (this: any, ...args: ConstructorParameters<typeof Worker>) {
      const worker = new OriginalWorker(...args);
      counts.workersCreated += 1;
      liveWorkers.add(worker);
      const originalTerminate = worker.terminate.bind(worker);
      worker.terminate = () => {
        if (liveWorkers.delete(worker)) counts.workersTerminated += 1;
        originalTerminate();
      };
      return worker;
    } as unknown as typeof Worker;
    PatchedWorker.prototype = OriginalWorker.prototype;
    window.Worker = PatchedWorker;
  }

  const patchAudioContext = (key: 'AudioContext' | 'webkitAudioContext') => {
    const Original = (window as any)[key];
    if (typeof Original !== 'function') return;
    const Patched = function (this: any, ...args: any[]) {
      const ctx = new Original(...args);
      counts.audioCreated += 1;
      liveAudioContexts.add(ctx);
      const originalClose = ctx.close.bind(ctx);
      ctx.close = () => {
        if (liveAudioContexts.delete(ctx)) counts.audioClosed += 1;
        return originalClose();
      };
      return ctx;
    } as any;
    Patched.prototype = Original.prototype;
    (window as any)[key] = Patched;
  };
  patchAudioContext('AudioContext');
  patchAudioContext('webkitAudioContext');

  if (typeof MediaStreamTrack !== 'undefined') {
    const originalStop = MediaStreamTrack.prototype.stop;
    MediaStreamTrack.prototype.stop = function patched(this: MediaStreamTrack) {
      if (this.readyState !== 'ended') counts.tracksEnded += 1;
      return originalStop.call(this);
    };
  }
}

export function readCounters(): ResourceCounters {
  const processorCanvases =
    typeof document !== 'undefined'
      ? document.querySelectorAll('canvas[data-livekit-processor]').length
      : 0;
  const canvasesInDom =
    typeof document !== 'undefined' ? document.querySelectorAll('canvas').length : 0;

  return {
    webgl: {
      created: counts.webglCreated,
      byType: { webgl: counts.webgl1, webgl2: counts.webgl2 },
      liveWeak: pruneDead(liveWebgl),
    },
    workers: {
      created: counts.workersCreated,
      terminated: counts.workersTerminated,
      live: liveWorkers.size,
    },
    audioContexts: {
      created: counts.audioCreated,
      closed: counts.audioClosed,
      live: liveAudioContexts.size,
    },
    tracks: {
      created: counts.tracksCreated,
      ended: counts.tracksEnded,
      live: pruneDead(liveTracks),
    },
    canvases: {
      created: counts.canvasesCreated,
      inDom: canvasesInDom,
      processorCanvases,
    },
  };
}
