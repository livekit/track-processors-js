import { beforeAll, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { type MaskBlending, setupWebGL } from '../src/webgl';

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
let office: ImageBitmap;

beforeAll(async () => {
  const load = async (name: string) =>
    createImageBitmap(await (await fetch(new URL(`./fixtures/${name}`, import.meta.url))).blob());
  [frame, mask, background, office] = await Promise.all([
    load('robot-office.jpg'),
    load('robot-office-mask.png'),
    load('lounge.jpg'),
    load('office.jpg'),
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
  function process(
    frameImage: ImageBitmap,
    maskImage: ImageBitmap,
    maskBlending: MaskBlending = 'binary',
    alphaIsBackground = false,
  ) {
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
    pipeline!.updateMask(maskTexture, maskBlending, alphaIsBackground, videoFrame);
    gl.deleteTexture(maskTexture);

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

/** The share of pixels that differ visibly between two images. */
function changedShare(a: Uint8ClampedArray, b: Uint8ClampedArray) {
  let changed = 0;
  for (let i = 0; i < a.length; i += 4) {
    const difference = Math.max(
      Math.abs(a[i] - b[i]),
      Math.abs(a[i + 1] - b[i + 1]),
      Math.abs(a[i + 2] - b[i + 2]),
    );
    if (difference > 16) {
      changed++;
    }
  }
  return changed / (a.length / 4);
}

/** A mask that marks the whole frame as background. */
function backgroundOnly(width: number, height: number) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, width, height);
  return createImageBitmap(canvas);
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

  it('composites the same after the segmenter changes the blend function', () => {
    using renderer = createRenderer(1280, 720);
    renderer.pipeline.setBlurRadius(10);
    renderer.process(frame, mask);
    const expected = pixels(renderer.canvas);

    const gl = renderer.canvas.getContext('webgl2')!;
    gl.blendFunc(gl.ONE, gl.ONE);
    renderer.process(frame, mask);

    expect(samePixels(pixels(renderer.canvas), expected)).toBe(true);
  });

  describe('with alpha mask blending', () => {
    const solid = (color: string) => {
      const canvas = new OffscreenCanvas(1280, 720);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1280, 720);
      return createImageBitmap(canvas);
    };
    const personColor = [200, 40, 40];
    const sceneColor = [20, 60, 220];
    let person: ImageBitmap;
    let scene: ImageBitmap;
    let quarterMask: ImageBitmap;

    beforeAll(async () => {
      [person, scene, quarterMask] = await Promise.all([
        solid(`rgb(${personColor})`),
        solid(`rgb(${sceneColor})`),
        solid('rgb(64, 64, 64)'),
      ]);
    });

    function centerPixel(canvas: HTMLCanvasElement) {
      const center = (360 * 1280 + 640) * 4;
      return [...pixels(canvas).slice(center, center + 3)];
    }

    function expectColor(actual: number[], expected: number[]) {
      for (let c = 0; c < 3; c++) {
        expect(Math.abs(actual[c] - expected[c]), `channel ${c}`).toBeLessThanOrEqual(2);
      }
    }

    it("shows the frame at the mask's opacity over the background", async () => {
      using renderer = createRenderer(1280, 720);
      await renderer.pipeline.setBackgroundImage(scene);
      renderer.process(person, quarterMask, 'alpha');

      const alpha = 64 / 255;
      expectColor(
        centerPixel(renderer.canvas),
        sceneColor.map((value, c) => value + (personColor[c] - value) * alpha),
      );
    });

    it("shows the frame at the rest of a background mask's opacity", async () => {
      using renderer = createRenderer(1280, 720);
      await renderer.pipeline.setBackgroundImage(scene);
      renderer.process(person, quarterMask, 'alpha', true);

      const alpha = 1 - 64 / 255;
      expectColor(
        centerPixel(renderer.canvas),
        sceneColor.map((value, c) => value + (personColor[c] - value) * alpha),
      );
    });

    it('remaps the alpha across the alpha range', async () => {
      using renderer = createRenderer(1280, 720);
      await renderer.pipeline.setBackgroundImage(scene);

      // The mask's alpha, 64 / 255, is below the range: fully background.
      renderer.pipeline.setAlphaRange([0.4, 0.8]);
      renderer.process(person, quarterMask, 'alpha');
      expectColor(centerPixel(renderer.canvas), sceneColor);

      // Above the range: fully the person.
      renderer.pipeline.setAlphaRange([0.05, 0.2]);
      renderer.process(person, quarterMask, 'alpha');
      expectColor(centerPixel(renderer.canvas), personColor);

      // Inside it: a smoothstep between the two.
      renderer.pipeline.setAlphaRange([0, 0.5]);
      renderer.process(person, quarterMask, 'alpha');
      const t = 64 / 255 / 0.5;
      const alpha = t * t * (3 - 2 * t);
      expectColor(
        centerPixel(renderer.canvas),
        sceneColor.map((value, c) => value + (personColor[c] - value) * alpha),
      );

      renderer.pipeline.setAlphaRange([0, 1]);
      renderer.process(person, quarterMask, 'alpha');
      expectColor(
        centerPixel(renderer.canvas),
        sceneColor.map((value, c) => value + (personColor[c] - value) * (64 / 255)),
      );
    });

    it('leaves binary blending as it is with an alpha range set', async () => {
      using renderer = createRenderer(1280, 720);
      await renderer.pipeline.setBackgroundImage(scene);
      renderer.pipeline.setAlphaRange([0.4, 0.8]);
      renderer.process(person, quarterMask, 'binary');

      expectColor(centerPixel(renderer.canvas), personColor);
    });

    // Binary blending reads the same mask as mostly person (below the 0.5 cut, 1 is background).
    it('cuts the same mask to fully the frame with binary blending', async () => {
      using renderer = createRenderer(1280, 720);
      await renderer.pipeline.setBackgroundImage(scene);
      renderer.process(person, quarterMask, 'binary');

      expectColor(centerPixel(renderer.canvas), personColor);
    });

    it('blends each mask as the call that handed it over asked', async () => {
      using renderer = createRenderer(1280, 720);
      await renderer.pipeline.setBackgroundImage(scene);
      renderer.process(person, quarterMask, 'alpha');
      renderer.process(person, quarterMask, 'binary');

      expectColor(centerPixel(renderer.canvas), personColor);
    });

    it("starts temporal smoothing over when the mask's meaning changes", async () => {
      const emptyMask = await solid('black');
      using renderer = createRenderer(1280, 720);
      await renderer.pipeline.setBackgroundImage(scene);
      renderer.pipeline.setTemporalSmoothing(true);
      renderer.process(person, emptyMask, 'alpha');
      renderer.process(person, quarterMask, 'alpha', true);

      const alpha = 1 - 64 / 255;
      expectColor(
        centerPixel(renderer.canvas),
        sceneColor.map((value, c) => value + (personColor[c] - value) * alpha),
      );
    });
  });

  it('keeps the previous mask with temporal smoothing where the picture is still', async () => {
    const nextMask = await backgroundOnly(mask.width, mask.height);

    using smoothed = createRenderer(1280, 720);
    smoothed.pipeline.setBlurRadius(10);
    smoothed.pipeline.setTemporalSmoothing(true);
    smoothed.process(frame, mask);
    const first = pixels(smoothed.canvas);
    smoothed.process(frame, nextMask);

    using unsmoothed = createRenderer(1280, 720);
    unsmoothed.pipeline.setBlurRadius(10);
    unsmoothed.process(frame, mask);
    unsmoothed.process(frame, nextMask);

    expect(changedShare(pixels(smoothed.canvas), first)).toBeLessThan(0.005);
    expect(changedShare(pixels(unsmoothed.canvas), first)).toBeGreaterThan(0.02);
  });

  it('follows the new mask with temporal smoothing where the picture moves', async () => {
    const nextMask = await backgroundOnly(mask.width, mask.height);

    using smoothed = createRenderer(1280, 720);
    smoothed.pipeline.setBlurRadius(10);
    smoothed.pipeline.setTemporalSmoothing(true);
    smoothed.process(frame, mask);
    smoothed.process(office, nextMask);

    using unsmoothed = createRenderer(1280, 720);
    unsmoothed.pipeline.setBlurRadius(10);
    unsmoothed.process(office, nextMask);

    expect(changedShare(pixels(smoothed.canvas), pixels(unsmoothed.canvas))).toBeLessThan(0.01);
  });

  it('starts temporal smoothing over when the frame size changes', async () => {
    const portraitFrame = await portrait(frame);
    const portraitMask = await portrait(mask, 'pixelated');

    using smoothed = createRenderer(1280, 720);
    smoothed.pipeline.setBlurRadius(10);
    smoothed.pipeline.setTemporalSmoothing(true);
    smoothed.process(frame, mask);
    smoothed.process(portraitFrame, portraitMask);

    using fresh = createRenderer(720, 1280);
    fresh.pipeline.setBlurRadius(10);
    fresh.process(portraitFrame, portraitMask);

    expect(samePixels(pixels(smoothed.canvas), pixels(fresh.canvas))).toBe(true);
  });

  it('moves a misplaced mask edge onto the outline in the picture with edge refinement', async () => {
    const shifted = new OffscreenCanvas(mask.width, mask.height);
    const ctx = shifted.getContext('2d')!;
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, mask.width, mask.height);
    ctx.drawImage(mask, 8, 0);
    const shiftedMask = await createImageBitmap(shifted);

    using exact = createRenderer(1280, 720);
    exact.pipeline.setBlurRadius(10);
    exact.process(frame, mask);

    using refined = createRenderer(1280, 720);
    refined.pipeline.setBlurRadius(10);
    refined.pipeline.setEdgeRefinement(4);
    refined.process(frame, shiftedMask);

    using unrefined = createRenderer(1280, 720);
    unrefined.pipeline.setBlurRadius(10);
    unrefined.process(frame, shiftedMask);

    const expected = pixels(exact.canvas);
    expect(changedShare(pixels(refined.canvas), expected)).toBeLessThan(
      changedShare(pixels(unrefined.canvas), expected) / 2,
    );
  });

  it('refines a resized frame as a pipeline created at that size would', async () => {
    const portraitFrame = await portrait(frame);
    const portraitMask = await portrait(mask, 'pixelated');

    using fresh = createRenderer(720, 1280);
    fresh.pipeline.setBlurRadius(10);
    fresh.pipeline.setEdgeRefinement(4);
    fresh.process(portraitFrame, portraitMask);

    using resized = createRenderer(1280, 720);
    resized.pipeline.setBlurRadius(10);
    resized.pipeline.setEdgeRefinement(4);
    resized.process(frame, mask);
    resized.process(portraitFrame, portraitMask);

    expect(samePixels(pixels(resized.canvas), pixels(fresh.canvas))).toBe(true);
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
