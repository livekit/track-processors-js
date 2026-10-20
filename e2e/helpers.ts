import type { Page } from '@playwright/test';
import type { AudioLevel, FrameDiff, FrameSample, ProcessorMode, Rgb } from '../examples/e2e/types';
import type {} from '../examples/e2e/types';

/**
 * Small helpers shared across specs.
 *
 * Setup goes through the harness API rather than the UI, so it cannot race a button's async
 * handler. Whatever a spec is actually testing should be driven through real clicks.
 */

export async function startCamera(
  page: Page,
  opts: { deviceId?: string; width?: number; height?: number } = {},
) {
  return page.evaluate((o) => window.harness.media.startVideo(o), opts);
}

export async function attachProcessor(page: Page) {
  await page.evaluate(() => window.harness.media.setVideoProcessorEnabled(true));
  await page.evaluate(() => window.harness.probe.waitForFrames(10, 25_000));
}

export async function switchMode(page: Page, mode: ProcessorMode) {
  await page.evaluate((m) => window.harness.media.switchMode(m), mode);
  await page.evaluate(() => window.harness.probe.waitForFrames(10, 25_000));
}

/** Waits until two consecutive frames are identical, then samples. Use before pixel assertions. */
export async function sampleStable(page: Page): Promise<FrameSample> {
  return page.evaluate(() => window.harness.probe.waitForStable({ timeoutMs: 15_000 }));
}

/** A sample of the unprocessed camera, for before/after comparisons. */
export async function sampleSource(page: Page): Promise<FrameSample> {
  return page.evaluate(() => window.harness.probe.sample({ source: 'source' }));
}

export async function sampleProcessed(page: Page, expectBackground?: Rgb & { tolerance?: number }) {
  return page.evaluate(
    (expect) => window.harness.probe.sample(expect ? { expectBackground: expect } : {}),
    expectBackground ?? null,
  );
}

/** Store the current frame as the baseline for `diffFromReference`. */
export async function captureReference(page: Page, source: 'processed' | 'source' = 'source') {
  return page.evaluate((src) => window.harness.probe.captureReference({ source: src }), source);
}

/** Compare the current frame against the stored reference. */
export async function diffFromReference(
  page: Page,
  source: 'processed' | 'source' = 'processed',
): Promise<FrameDiff> {
  return page.evaluate((src) => window.harness.probe.diffFromReference({ source: src }), source);
}

export async function snapshot(page: Page) {
  return page.evaluate(() => window.harness.snapshot());
}

/** Max per-channel distance between two mean colours. */
export function colourDistance(a: Rgb, b: Rgb) {
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
}

// ----------------------------------------------------------------------------------- audio

/** Starts the fake microphone. Setup, so it goes through the harness rather than the button. */
export async function startMic(page: Page, opts: { gain?: number } = {}) {
  await page.evaluate(() => window.harness.mic.assertRunning());
  return page.evaluate((o) => window.harness.media.startAudio(o), opts);
}

/**
 * Measures the audio track a remote peer would receive — the processor's output while one is
 * attached, the raw mic otherwise.
 *
 * The default window is long enough for the measuring analyser to spin up: its first reads land
 * before any audio has reached it, and they drag a short window's rms down.
 */
export async function measureLevel(page: Page, windowMs = 400): Promise<AudioLevel> {
  return page.evaluate((ms) => window.harness.mic.level(ms), windowMs);
}

/**
 * Samples the published level in short windows for `durationMs`, without blocking the caller.
 *
 * Returns a promise the spec awaits *after* driving whatever it wants covered, so the samples
 * span that action. This is how an audio spec shows that sound kept flowing across a change,
 * rather than that it was present before and after.
 */
export function monitorLevel(page: Page, durationMs: number, windowMs = 120): Promise<number[]> {
  return page.evaluate(
    async ([total, each]) => {
      const samples: number[] = [];
      const deadline = performance.now() + total;
      while (performance.now() < deadline) {
        samples.push((await window.harness.mic.level(each)).rms);
      }
      return samples;
    },
    [durationMs, windowMs] as const,
  );
}

/** `measured` relative to `reference`, in dB. 0.5x is -6.02, 2x is +6.02. */
export function decibels(measured: number, reference: number) {
  return 20 * Math.log10(measured / reference);
}
