/* eslint-disable @typescript-eslint/naming-convention */
export const supportsOffscreenCanvas = () => typeof OffscreenCanvas !== 'undefined';

async function sleep(time: number) {
  return new Promise((resolve) => setTimeout(resolve, time));
}

export async function waitForTrackResolution(track: MediaStreamTrack) {
  const timeout = 500;

  // browsers report wrong initial resolution on iOS.
  // when slightly delaying the call to .getSettings(), the correct resolution is being reported
  await sleep(10);

  const started = Date.now();
  while (Date.now() - started < timeout) {
    const { width, height } = track.getSettings();
    if (width && height) {
      return { width, height };
    }
    await sleep(50);
  }
  return { width: undefined, height: undefined };
}

export function createCanvas(width: number, height: number) {
  if (supportsOffscreenCanvas()) {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}
