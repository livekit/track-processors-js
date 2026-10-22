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
    createImageBitmap(
      await (
        await fetch(new URL(`./fixtures/${name}`, import.meta.url))
      ).blob()
    );

  // Zuerst alle Bilder laden
  [frame, mask, background] = await Promise.all([
    load('robot-office.jpg'),
    load('robot-office-mask.png'),
    load('lounge.jpg'),
  ]);

  // Testmaske von Category Mask auf Confidence Mask umstellen
  // Bisher: Person = 0, Hintergrund = 255
  // Neu:    Person = 255, Hintergrund = 0

  const canvas = new OffscreenCanvas(mask.width, mask.height);
  const ctx = canvas.getContext('2d')!;

  ctx.drawImage(mask, 0, 0);

  const imageData = ctx.getImageData(
    0,
    0,
    mask.width,
    mask.height,
  );

  // RGB-Werte invertieren
  for (let i = 0; i < imageData.data.length; i += 4) {
    imageData.data[i] = 255 - imageData.data[i];
    imageData.data[i + 1] = 255 - imageData.data[i + 1];
    imageData.data[i + 2] = 255 - imageData.data[i + 2];
  }

  ctx.putImageData(imageData, 0, 0);

  mask.close();
  mask = await createImageBitmap(canvas);
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
    const videoFrame = new VideoFrame(frameImage, { timestamp: 0 });

    try {
      pipeline!.updateMask(maskTexture, videoFrame);
      pipeline!.renderFrame(videoFrame);
    } finally {
      gl.deleteTexture(maskTexture);
      videoFrame.close();
    }
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

  it('passes the frame through when the blur is cleared and no image is set', () => {
    using renderer = createRenderer(1280, 720);
    renderer.pipeline.setBlurRadius(10);
    renderer.process(frame, mask);
    renderer.pipeline.setBlurRadius(null);
    renderer.process(frame, mask);

    expect(samePixels(pixels(renderer.canvas), pixels(frame))).toBe(true);
  });

  it('passes the frame through once the background image is cleared', async () => {
    using renderer = createRenderer(1280, 720);
    await renderer.pipeline.setBackgroundImage(background);
    renderer.process(frame, mask);
    await renderer.pipeline.setBackgroundImage(null);
    renderer.process(frame, mask);

    expect(samePixels(pixels(renderer.canvas), pixels(frame))).toBe(true);
  });

  it('keeps showing the previous image until the next one is ready', async () => {
    using renderer = createRenderer(1280, 720);
    await renderer.pipeline.setBackgroundImage(background);
    renderer.process(frame, mask);
    const previous = pixels(renderer.canvas);

    // The robot frame stands in for a second background image.
    const next = renderer.pipeline.setBackgroundImage(frame);
    renderer.process(frame, mask);
    expect(samePixels(pixels(renderer.canvas), previous), 'while loading').toBe(true);

    await next;
    renderer.process(frame, mask);
    expect(samePixels(pixels(renderer.canvas), previous), 'once loaded').toBe(false);
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

  // VideoTransformer.restart() runs cleanup() and then setupWebGL() on what can be the same
  // canvas, so only releaseContext() may lose the context.
  it('keeps the context through cleanup() and loses it on releaseContext()', () => {
    using renderer = createRenderer(1280, 720);
    const gl = renderer.canvas.getContext('webgl2')!;

    renderer.pipeline.cleanup();
    expect(gl.isContextLost(), 'after cleanup').toBe(false);
    expect(setupWebGL(renderer.canvas), 'set up again on the same canvas').toBeDefined();

    renderer.pipeline.releaseContext();
    expect(gl.isContextLost(), 'after releaseContext').toBe(true);
  });
});
