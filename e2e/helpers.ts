import type { Page } from '@playwright/test';
import type { FrameSample, ProcessorMode, Rgb } from '../examples/e2e/types';
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

export async function snapshot(page: Page) {
  return page.evaluate(() => window.harness.snapshot());
}

/** Max per-channel distance between two mean colours. */
export function colourDistance(a: Rgb, b: Rgb) {
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
}
