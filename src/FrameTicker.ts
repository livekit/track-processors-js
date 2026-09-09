import { LoggerNames, getLogger } from './logger';

const log = getLogger(LoggerNames.ProcessorWrapper);

// One timer per request, never an interval: the next tick is only armed once the previous frame
// has been rendered, so slow hardware simply lowers the frame rate instead of queueing up work
// the main thread can never catch up with.
const TICKER_WORKER_SOURCE = 'onmessage = (e) => { setTimeout(() => postMessage(0), e.data); };';

export interface FrameTicker {
  stop(): void;
}

/**
 * Drives the fallback render loop from a worker timer, so it keeps running while the window is not
 * being painted.
 *
 * A minimised or occluded window drops to roughly one `requestAnimationFrame` callback per second,
 * and a hidden document also has its window timers throttled, which would leave the canvas, and
 * therefore the processed track every remote participant receives, frozen on its last frame. Worker
 * timers are exempt from both, and `canvas.captureStream()` keeps emitting for as long as something
 * paints the canvas.
 *
 * `requestAnimationFrame` is only used where a blob worker cannot run at all (for example a
 * Content-Security-Policy without `worker-src blob:`), so those environments keep exactly today's
 * behaviour instead of losing the loop entirely.
 */
export function createFrameTicker(intervalMs: number, onTick: () => void): FrameTicker {
  let worker: Worker;

  try {
    const workerUrl = URL.createObjectURL(
      new Blob([TICKER_WORKER_SOURCE], { type: 'text/javascript' }),
    );
    worker = new Worker(workerUrl);
    URL.revokeObjectURL(workerUrl);
  } catch (e) {
    log.warn('Frame ticker worker could not be created, falling back to requestAnimationFrame', e);
    return createRequestAnimationFrameTicker(onTick);
  }

  let fallback: FrameTicker | undefined;
  let ticked = false;

  const useAnimationFrameFallback = (reason: string, e?: unknown) => {
    if (fallback) {
      return;
    }

    worker.terminate();
    log.warn(`Frame ticker worker ${reason}, falling back to requestAnimationFrame`, e);
    fallback = createRequestAnimationFrameTicker(onTick);
  };

  worker.onmessage = () => {
    ticked = true;

    try {
      onTick();
    } finally {
      worker.postMessage(intervalMs);
    }
  };

  worker.onerror = (e) => useAnimationFrameFallback('failed', e);

  // A blocked worker reports itself through `onerror` rather than by throwing, so a browser that
  // does neither would leave the loop with no clock at all.
  const startTimeout = setTimeout(() => {
    if (!ticked) {
      useAnimationFrameFallback('did not start');
    }
  }, Math.max(1000, intervalMs * 10));

  worker.postMessage(intervalMs);

  return {
    stop() {
      clearTimeout(startTimeout);
      worker.terminate();
      fallback?.stop();
    },
  };
}

function createRequestAnimationFrameTicker(onTick: () => void): FrameTicker {
  let frameId = requestAnimationFrame(function tick() {
    frameId = requestAnimationFrame(tick);
    onTick();
  });

  return {
    stop() {
      cancelAnimationFrame(frameId);
    },
  };
}
