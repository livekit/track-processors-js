/**
 * WebGL setup for the mask processor
 * potential improvements:
 * - downsample the video texture in background blur scenario before applying the (gaussian) blur for better performance
 *
 */
import { getLogger, LoggerNames} from '../logger';
import { applyBlur, createBlurProgram } from './shader-programs/blurShader';
import { createBoxBlurProgram } from './shader-programs/boxBlurShader';
import { createCompositeProgram } from './shader-programs/compositeShader';
import { applyDownsampling, createDownSampler } from './shader-programs/downSampler';
import {
  createFramebuffer,
  createVertexBuffer,
  getEmptyImageData,
  initTexture,
  resizeImageToCover,
  resizeTexture,
} from './utils';

const log = getLogger(LoggerNames.WebGl);

export const setupWebGL = (canvas: OffscreenCanvas | HTMLCanvasElement) => {
  const gl = canvas.getContext('webgl2', {
    // Every pass is a full-screen quad, so multisampling only adds a resolve per frame.
    antialias: false,
    premultipliedAlpha: true,
  }) as WebGL2RenderingContext;

  let blurRadius: number | null = null;
  let maskBlurRadius: number | null = 8;
  const downsampleFactor = 4;
  // The segmentation mask is at most a few hundred pixels across, so feathering it at
  // full frame size only multiplies the box-blur cost. The mask buffers are kept near
  // this longest edge and the composite upsamples them with LINEAR filtering.
  const maskBufferTargetEdge = 640;
  const getMaskDownsampleFactor = (width: number, height: number) =>
    Math.max(1, Math.round(Math.max(width, height) / maskBufferTargetEdge));

  if (!gl) {
    log.error('Failed to create WebGL context');
    return undefined;
  }

  // Blending is only enabled around the composite draw: the intermediate passes all
  // write opaque output, so blending them just costs a framebuffer read.
  gl.disable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  // Create the composite program
  const composite = createCompositeProgram(gl);
  const compositeProgram = composite.program;
  const positionLocation = composite.attribLocations.position;
  const {
    mask: maskTextureLocation,
    frame: frameTextureLocation,
    background: bgTextureLocation,
    disableBackground: disableBackgroundLocation,
  } = composite.uniformLocations;

  // Create the blur program using the same vertex shader source
  const blur = createBlurProgram(gl);
  const blurProgram = blur.program;
  const blurUniforms = blur.uniforms;

  // Create the box blur program
  const boxBlur = createBoxBlurProgram(gl);
  const boxBlurProgram = boxBlur.program;
  const boxBlurUniforms = boxBlur.uniforms;

  const bgTexture = initTexture(gl, 0);
  const frameTexture = initTexture(gl, 1);
  const vertexBuffer = createVertexBuffer(gl);

  if (!vertexBuffer) {
    throw new Error('Failed to create vertex buffer');
  }

  // Create additional textures and framebuffers for processing
  let bgBlurTextures: WebGLTexture[] = [];
  let bgBlurFrameBuffers: WebGLFramebuffer[] = [];
  let blurredMaskTexture: WebGLTexture | null = null;

  // For double buffering the final mask
  let finalMaskTextures: WebGLTexture[] = [];
  let readMaskIndex = 0; // Index for renderFrame to read from
  let writeMaskIndex = 1; // Index for updateMask to write to

  // Create textures for background processing (blur)
  bgBlurTextures.push(initTexture(gl, 3)); // For blur pass 1
  bgBlurTextures.push(initTexture(gl, 4)); // For blur pass 2

  let bgBlurTextureWidth = Math.floor(canvas.width / downsampleFactor);
  let bgBlurTextureHeight = Math.floor(canvas.height / downsampleFactor);

  const downSampler = createDownSampler(gl, bgBlurTextureWidth, bgBlurTextureHeight);

  // Create framebuffers for background processing
  bgBlurFrameBuffers.push(
    createFramebuffer(gl, bgBlurTextures[0], bgBlurTextureWidth, bgBlurTextureHeight),
  );
  bgBlurFrameBuffers.push(
    createFramebuffer(gl, bgBlurTextures[1], bgBlurTextureWidth, bgBlurTextureHeight),
  );

  let maskDownsampleFactor = getMaskDownsampleFactor(canvas.width, canvas.height);
  let maskBufferWidth = Math.max(1, Math.round(canvas.width / maskDownsampleFactor));
  let maskBufferHeight = Math.max(1, Math.round(canvas.height / maskDownsampleFactor));

  // Initialize texture for the first mask blur pass
  const tempMaskTexture = initTexture(gl, 5);
  const tempMaskFrameBuffer = createFramebuffer(
    gl,
    tempMaskTexture,
    maskBufferWidth,
    maskBufferHeight,
  );

  // Initialize two textures for double-buffering the final mask
  finalMaskTextures.push(initTexture(gl, 6)); // For reading in renderFrame
  finalMaskTextures.push(initTexture(gl, 7)); // For writing in updateMask

  // Create framebuffers for the final mask textures
  const finalMaskFrameBuffers = [
    createFramebuffer(gl, finalMaskTextures[0], maskBufferWidth, maskBufferHeight),
    createFramebuffer(gl, finalMaskTextures[1], maskBufferWidth, maskBufferHeight),
  ];

  // Store custom background image, cropped to cover the canvas, and the source it was cropped from
  let customBackgroundImage: ImageBitmap | ImageData | null = null;
  let backgroundSourceImage: ImageBitmap | null = null;

  // The transformer sets the canvas to each frame's display size, which drifts from the size the buffers
  // were allocated at (device rotation, iOS reporting the unrotated sensor size). Called from updateMask
  // and renderFrame: whichever first sees a new size reallocates, the other only compares.
  let bufferWidth = canvas.width;
  let bufferHeight = canvas.height;

  function ensureBuffersMatchCanvas() {
    if (canvas.width === bufferWidth && canvas.height === bufferHeight) {
      return;
    }
    bufferWidth = canvas.width;
    bufferHeight = canvas.height;
    bgBlurTextureWidth = Math.floor(bufferWidth / downsampleFactor);
    bgBlurTextureHeight = Math.floor(bufferHeight / downsampleFactor);
    for (const texture of [downSampler.texture, ...bgBlurTextures]) {
      resizeTexture(gl, texture, bgBlurTextureWidth, bgBlurTextureHeight);
    }
    maskDownsampleFactor = getMaskDownsampleFactor(bufferWidth, bufferHeight);
    maskBufferWidth = Math.max(1, Math.round(bufferWidth / maskDownsampleFactor));
    maskBufferHeight = Math.max(1, Math.round(bufferHeight / maskDownsampleFactor));
    for (const texture of [tempMaskTexture, ...finalMaskTextures]) {
      resizeTexture(gl, texture, maskBufferWidth, maskBufferHeight);
    }
    if (backgroundSourceImage) {
      // Not awaited: the placeholder background shows until the re-crop resolves, as on the initial set.
      setBackgroundImage(backgroundSourceImage);
    }
  }

  let backgroundImageDisabled = false;

  // Set up uniforms for the composite shader
  gl.useProgram(compositeProgram);
  gl.uniform1i(disableBackgroundLocation, backgroundImageDisabled ? 1 : 0);
  gl.uniform1i(bgTextureLocation, 0);
  gl.uniform1i(frameTextureLocation, 1);
  gl.uniform1i(maskTextureLocation, 2);

  function renderFrame(frame: VideoFrame) {
    if (frame.codedWidth === 0 || finalMaskTextures.length === 0) {
      return;
    }

    const width = frame.displayWidth;
    const height = frame.displayHeight;

    ensureBuffersMatchCanvas();

    // Prepare frame texture
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, frameTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);

    // Apply blur if enabled (and no custom background is set)
    let backgroundTexture = bgTexture;

    if (blurRadius) {
      const downSampledFrameTexture = applyDownsampling(
        gl,
        frameTexture,
        downSampler,
        vertexBuffer!,
        bgBlurTextureWidth,
        bgBlurTextureHeight,
      );
      backgroundTexture = applyBlur(
        gl,
        downSampledFrameTexture,
        bgBlurTextureWidth,
        bgBlurTextureHeight,
        blurRadius,
        blurProgram,
        blurUniforms,
        vertexBuffer!,
        bgBlurFrameBuffers,
        bgBlurTextures,
      );
    } else if (customBackgroundImage) {
      // setBackgroundImage() uploads the image into bgTexture whenever it changes, and
      // nothing else writes to it, so the static background is not re-uploaded per frame.
      backgroundTexture = bgTexture;
    }

    // Render the final composite
    gl.viewport(0, 0, width, height);
    gl.clearColor(1.0, 1.0, 1.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(compositeProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(positionLocation);

    // Set background texture (either original, blurred or custom)
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, backgroundTexture);
    gl.uniform1i(bgTextureLocation, 0);
    gl.uniform1i(disableBackgroundLocation, backgroundImageDisabled ? 1 : 0);

    // Set frame texture
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, frameTexture);
    gl.uniform1i(frameTextureLocation, 1);

    // Set mask texture - always read from the current read index
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, finalMaskTextures[readMaskIndex]);
    gl.uniform1i(maskTextureLocation, 2);
    gl.enable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disable(gl.BLEND);
  }

  /**
   * Set or update the background image
   * @param image The background image to use, or null to clear
   */
  async function setBackgroundImage(image: ImageBitmap | null) {
    // Clear existing background
    backgroundSourceImage = image;
    customBackgroundImage = null;

    if (image) {
      customBackgroundImage = getEmptyImageData();
      // Show the placeholder until the cropped image is ready: renderFrame no longer uploads it.
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, bgTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, customBackgroundImage);
      try {
        // Resize and crop the image to cover the canvas
        const croppedImage = await resizeImageToCover(image, canvas.width, canvas.height);

        // Store the cropped and resized image
        customBackgroundImage = croppedImage;
      } catch (error) {
        log.error(
          'Error processing background image, falling back to black background:',
          error,
        );
      }

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, bgTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, customBackgroundImage);
    }
  }

  function setBlurRadius(radius: number | null) {
    blurRadius = radius ? Math.max(1, Math.floor(radius / downsampleFactor)) : null; // we are downsampling the blur texture, so decrease the radius here for better performance with a similar visual result
    setBackgroundImage(null);
  }

  function setBackgroundDisabled(disabled: boolean) {
    backgroundImageDisabled = disabled;
  }

  function updateMask(mask: WebGLTexture) {
    // Same guard as renderFrame: cleanup() empties the arrays, a late segmentation callback must not touch them.
    if (finalMaskTextures.length === 0) {
      return;
    }
    ensureBuffersMatchCanvas();

    // Use the existing applyBlur function to apply the first blur pass
    // The second blur pass will be written to finalMaskTextures[writeMaskIndex]

    // Create temporary arrays for the single blur operation
    const tempFramebuffers = [tempMaskFrameBuffer, finalMaskFrameBuffers[writeMaskIndex]];

    const tempTextures = [tempMaskTexture, finalMaskTextures[writeMaskIndex]];

    // Apply the blur using the existing function
    applyBlur(
      gl,
      mask,
      maskBufferWidth,
      maskBufferHeight,
      // The radius is in mask-buffer texels, so scale it down with the buffer.
      Math.max(1, Math.round((maskBlurRadius || 1.0) / maskDownsampleFactor)),
      boxBlurProgram,
      boxBlurUniforms,
      vertexBuffer!,
      tempFramebuffers,
      tempTextures,
    );

    // Swap indices for the next frame
    readMaskIndex = writeMaskIndex;
    writeMaskIndex = 1 - writeMaskIndex;
  }

  function cleanup() {
    gl.deleteProgram(compositeProgram);
    gl.deleteProgram(blurProgram);
    gl.deleteProgram(boxBlurProgram);
    gl.deleteTexture(bgTexture);
    gl.deleteTexture(frameTexture);
    gl.deleteTexture(tempMaskTexture);
    gl.deleteFramebuffer(tempMaskFrameBuffer);

    for (const texture of bgBlurTextures) {
      gl.deleteTexture(texture);
    }
    for (const framebuffer of bgBlurFrameBuffers) {
      gl.deleteFramebuffer(framebuffer);
    }
    for (const texture of finalMaskTextures) {
      gl.deleteTexture(texture);
    }
    for (const framebuffer of finalMaskFrameBuffers) {
      gl.deleteFramebuffer(framebuffer);
    }
    gl.deleteBuffer(vertexBuffer);

    if (blurredMaskTexture) {
      gl.deleteTexture(blurredMaskTexture);
    }

    if (downSampler) {
      gl.deleteTexture(downSampler.texture);
      gl.deleteFramebuffer(downSampler.framebuffer);
      gl.deleteProgram(downSampler.program);
    }

    // Release any ImageBitmap resources
    if (customBackgroundImage) {
      if (customBackgroundImage instanceof ImageBitmap) {
        customBackgroundImage.close();
      }
      customBackgroundImage = null;
    }
    backgroundSourceImage = null;
    bgBlurTextures = [];
    bgBlurFrameBuffers = [];
    finalMaskTextures = [];
  }

  return { renderFrame, updateMask, setBackgroundImage, setBlurRadius, setBackgroundDisabled, cleanup };
};
