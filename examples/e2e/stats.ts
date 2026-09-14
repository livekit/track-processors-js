import type { FrameProcessingStats, Percentiles, ProcessorStatsSnapshot } from './types';

/**
 * Ring buffer fed by `onFrameProcessed`. Deliberately does no DOM work per frame — the panel
 * renders on its own interval — because the callback runs inside the transform path and the
 * segmenter already blocks the event loop for tens of milliseconds.
 */

const CAPACITY = 600;

interface Entry {
  t: number;
  processingMs: number;
  segmentationMs: number;
  filterMs: number;
}

const entries: Entry[] = [];
let total = 0;

export function recordFrame(stats: FrameProcessingStats) {
  total += 1;
  entries.push({
    t: performance.now(),
    processingMs: stats.processingTimeMs,
    segmentationMs: stats.segmentationTimeMs,
    filterMs: stats.filterTimeMs,
  });
  if (entries.length > CAPACITY) entries.splice(0, entries.length - CAPACITY);
}

export function resetStats() {
  entries.length = 0;
  total = 0;
}

function percentiles(values: number[]): Percentiles {
  if (values.length === 0) return { mean: 0, p50: 0, p95: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const mean = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
  return { mean, p50: at(0.5), p95: at(0.95) };
}

export function snapshotStats(): ProcessorStatsSnapshot {
  const windowMs =
    entries.length > 1 ? entries[entries.length - 1].t - entries[0].t : 0;
  return {
    frames: total,
    fps: windowMs > 0 ? ((entries.length - 1) * 1000) / windowMs : 0,
    windowMs,
    processingMs: percentiles(entries.map((e) => e.processingMs)),
    segmentationMs: percentiles(entries.map((e) => e.segmentationMs)),
    filterMs: percentiles(entries.map((e) => e.filterMs)),
  };
}
