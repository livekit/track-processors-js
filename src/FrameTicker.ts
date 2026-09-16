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
 * A window `setTimeout` drives the loop until the worker delivers its first tick, and for good where
 * a blob worker cannot run at all (for example a Content-Security-Policy without `worker-src blob:`).
 * It is throttled to about one tick per second while hidden, but unlike `requestAnimationFrame` it
 * never stops, so those environments get a slow loop instead of a frozen one.
 */
export function createFrameTicker(intervalMs: number, onTick: () => void): FrameTicker {
  let timeoutTicker: FrameTicker | undefined = createTimeoutTicker(intervalMs, onTick);
  let worker: Worker;

  try {
    const workerUrl = URL.createObjectURL(
      new Blob([TICKER_WORKER_SOURCE], { type: 'text/javascript' }),
    );
    worker = new Worker(workerUrl);
    URL.revokeObjectURL(workerUrl);
  } catch (e) {
    log.warn('Frame ticker worker could not be created, falling back to a window timer', e);
    return timeoutTicker;
  }

  worker.onmessage = () => {
    timeoutTicker?.stop();
    timeoutTicker = undefined;

    try {
      onTick();
    } finally {
      worker.postMessage(intervalMs);
    }
  };

  worker.onerror = (e) => {
    worker.terminate();
    log.warn('Frame ticker worker failed, falling back to a window timer', e);
    timeoutTicker ??= createTimeoutTicker(intervalMs, onTick);
  };

  worker.postMessage(intervalMs);

  return {
    stop() {
      worker.terminate();
      timeoutTicker?.stop();
    },
  };
}

function createTimeoutTicker(intervalMs: number, onTick: () => void): FrameTicker {
  let timeoutId = setTimeout(function tick() {
    timeoutId = setTimeout(tick, intervalMs);
    onTick();
  }, intervalMs);

  return {
    stop() {
      clearTimeout(timeoutId);
    },
  };
}
