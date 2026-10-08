import { beforeAll, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { setupWebGL } from '../src/webgl';

/**
 * Runs the WebGL compositing pipeline (the part of BackgroundProcessor after segmentation) on a
 * camera frame and its person mask: a white robot doll in front of an office, with its exact
 * silhouette standing in for MediaPipe's category mask (see fixtures/README.md).
 *
 * Output is compared with reference screenshots in __screenshots__, one per shader it depends on.
 * Update them with `pnpm test:update`.
 */

let frame: ImageBitmap;
let mask: ImageBitmap;
let background: ImageBitmap;

beforeAll(async () => {
  const load = async (name: string) =>
    createImageBitmap(await (await fetch(new URL(`./fixtures/${name}`, import.meta.url))).blob());
  [frame, mask, background] = await Promise.all([
    load('robot-office.jpg'),
    load('robot-office-mask.png'),
    load('lounge.jpg'),
  ]);
});

/**
 * Sets up the pipeline on a canvas on the page, shown at half size to keep the reference
 * screenshots small. Declare it with `using` to tear both down at the end of the test.
 */
function createRenderer(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${width / 2}px`;
  canvas.dataset.testid = 'output';
  document.body.append(canvas);

  const pipeline = setupWebGL(canvas);
  if (!pipeline) {
    throw new Error('WebGL2 is not available');
  }
  // setupWebGL created the context; asking again returns the same one.
  const gl = canvas.getContext('webgl2')!;

  /** Runs one frame through the pipeline, as BackgroundTransformer does after segmentation. */
  function process(frameImage: ImageBitmap, maskImage: ImageBitmap) {
    // The transformer sizes the canvas to each frame before handing it to the pipeline.
    canvas.width = frameImage.width;
    canvas.height = frameImage.height;
    canvas.style.width = `${frameImage.width / 2}px`;

    // MediaPipe hands over the mask as a texture in the pipeline's context.
    const maskTexture = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, maskTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, maskImage);
    pipeline!.updateMask(maskTexture);
    gl.deleteTexture(maskTexture);

    const videoFrame = new VideoFrame(frameImage, { timestamp: 0 });
    pipeline!.renderFrame(videoFrame);
    videoFrame.close();
  }

  return {
    canvas,
    pipeline,
    process,
    [Symbol.dispose]() {
      pipeline.cleanup();
      canvas.remove();
    },
  };
}

/** Pixels of an image, or of the canvas's last frame (read before the browser presents it). */
function pixels(source: ImageBitmap | HTMLCanvasElement) {
  const canvas = new OffscreenCanvas(source.width, source.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(source, 0, 0);
  return ctx.getImageData(0, 0, source.width, source.height).data;
}

function samePixels(a: Uint8ClampedArray, b: Uint8ClampedArray) {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/** A portrait frame from a landscape image: the center cropped and scaled up, as on rotation. */
function portrait(image: ImageBitmap, resizeQuality: ResizeQuality = 'high') {
  const cropWidth = (image.height * 720) / 1280;
  return createImageBitmap(image, (image.width - cropWidth) / 2, 0, cropWidth, image.height, {
    resizeWidth: 720,
    resizeHeight: 1280,
    resizeQuality,
  });
}

describe('WebGL pipeline', () => {
  // Pins the Gaussian blur at BackgroundProcessor's default radius (10), the look users get.
  it('blurs the background', async () => {
    using renderer = createRenderer(1280, 720);
    renderer.pipeline.setBlurRadius(10);
    renderer.process(frame, mask);

    await expect.element(page.getByTestId('output')).toMatchScreenshot('background-blur');
  });

  // Pins the mask feathering (box blur, at reduced resolution at 720p) and the composite.
  it('replaces the background with an image', async () => {
    using renderer = createRenderer(1280, 720);
    await renderer.pipeline.setBackgroundImage(background);
    renderer.process(frame, mask);

    await expect.element(page.getByTestId('output')).toMatchScreenshot('virtual-background');
  });

  it('keeps showing the background image on later frames and after switching back from blur', async () => {
    using renderer = createRenderer(1280, 720);
    await renderer.pipeline.setBackgroundImage(background);
    renderer.process(frame, mask);
    const first = pixels(renderer.canvas);

    renderer.process(frame, mask);
    expect(samePixels(pixels(renderer.canvas), first), 'second frame').toBe(true);

    renderer.pipeline.setBlurRadius(10);
    renderer.process(frame, mask);
    renderer.pipeline.setBlurRadius(null);
    await renderer.pipeline.setBackgroundImage(background);
    renderer.process(frame, mask);
    expect(samePixels(pixels(renderer.canvas), first), 'after blur').toBe(true);
  });

  it('passes the frame through untouched when the background is disabled', () => {
    using renderer = createRenderer(1280, 720);
    renderer.pipeline.setBlurRadius(10);
    renderer.pipeline.setBackgroundDisabled(true);
    renderer.process(frame, mask);

    expect(samePixels(pixels(renderer.canvas), pixels(frame))).toBe(true);
  });

  it('renders a resized frame as a pipeline created at that size would', async () => {
    const portraitFrame = await portrait(frame);
    const portraitMask = await portrait(mask, 'pixelated');

    using fresh = createRenderer(720, 1280);
    fresh.pipeline.setBlurRadius(10);
    fresh.process(portraitFrame, portraitMask);
    const expected = pixels(fresh.canvas);

    using resized = createRenderer(1280, 720);
    resized.pipeline.setBlurRadius(10);
    resized.process(frame, mask);
    resized.process(portraitFrame, portraitMask);

    expect(samePixels(pixels(resized.canvas), expected)).toBe(true);
  });
});
