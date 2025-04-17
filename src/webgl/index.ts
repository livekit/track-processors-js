import { MPMask } from '@mediapipe/tasks-vision';
import { applyBlur, createBlurProgram } from './shader-programs/blurShader';
import { createCompositeProgram } from './shader-programs/compositeShader';
import {
  createFramebuffer,
  createVertexBuffer,
  emptyImageData,
  initTexture,
  resizeImageToCover,
} from './utils';

export const setupWebGL = (canvas: OffscreenCanvas) => {
  const gl = canvas.getContext('webgl2', {
    antialias: true,
    premultipliedAlpha: true,
  }) as WebGL2RenderingContext;

  let blurRadius: number | null = null;
  let stepWidth = 1.0;

  if (!gl) {
    console.error('Failed to create WebGL context');
    return undefined;
  }

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  // Create the composite program
  const composite = createCompositeProgram(gl);
  const compositeProgram = composite.program;
  const positionLocation = composite.attribLocations.position;
  const {
    mask: maskTextureLocation,
    frame: frameTextureLocation,
    background: bgTextureLocation,
    stepWidth: smoothStepWidthLocation,
  } = composite.uniformLocations;

  // Create the blur program using the same vertex shader source
  const blur = createBlurProgram(gl);
  const blurProgram = blur.program;
  const blurUniforms = blur.uniforms;

  const bgTexture = initTexture(gl, 0);
  const frameTexture = initTexture(gl, 1);
  const vertexBuffer = createVertexBuffer(gl);

  if (!vertexBuffer) {
    throw new Error('Failed to create vertex buffer');
  }

  // Create additional textures and framebuffers for processing
  let processTextures: WebGLTexture[] = [];
  let processFramebuffers: WebGLFramebuffer[] = [];

  // Create textures for processing (blur and bilateral filter)
  processTextures.push(initTexture(gl, 3)); // For blur pass 1
  processTextures.push(initTexture(gl, 4)); // For blur pass 2
  processTextures.push(initTexture(gl, 5)); // For bilateral filter output

  // Create framebuffers for processing
  processFramebuffers.push(createFramebuffer(gl, processTextures[0], canvas.width, canvas.height));
  processFramebuffers.push(createFramebuffer(gl, processTextures[1], canvas.width, canvas.height));
  processFramebuffers.push(createFramebuffer(gl, processTextures[2], canvas.width, canvas.height));

  // Set up uniforms for the composite shader
  gl.useProgram(compositeProgram);
  gl.uniform1i(bgTextureLocation, 0);
  gl.uniform1i(frameTextureLocation, 1);
  gl.uniform1i(maskTextureLocation, 2);

  // Store custom background image
  let customBackgroundImage: ImageBitmap | ImageData = emptyImageData;

  function render(frame: VideoFrame, mask: MPMask) {
    if (frame.codedWidth === 0 || mask.width === 0) {
      return;
    }

    const width = frame.displayWidth;
    const height = frame.displayHeight;

    // Prepare frame texture
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, frameTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);

    // Apply blur if enabled (and no custom background is set)
    let backgroundTexture = bgTexture;

    if (blurRadius) {
      backgroundTexture = applyBlur(
        gl,
        frameTexture,
        width,
        height,
        blurRadius,
        blurProgram,
        blurUniforms,
        vertexBuffer!,
        processFramebuffers,
        processTextures,
      );
    } else {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, bgTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, customBackgroundImage);
      backgroundTexture = bgTexture;
    }

    // Get the mask texture
    const maskTexture = mask.getAsWebGLTexture();

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

    // Set frame texture
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, frameTexture);
    gl.uniform1i(frameTextureLocation, 1);

    // Set mask texture (either original or filtered)
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, maskTexture);
    gl.uniform1i(maskTextureLocation, 2);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    mask.close();
  }

  /**
   * Set or update the background image
   * @param image The background image to use, or null to clear
   */
  async function setBackgroundImage(image: ImageBitmap | null) {
    // Clear existing background
    customBackgroundImage = emptyImageData;

    if (image) {
      try {
        // Resize and crop the image to cover the canvas
        const croppedImage = await resizeImageToCover(image, canvas.width, canvas.height);

        // Store the cropped and resized image
        customBackgroundImage = croppedImage;
      } catch (error) {
        console.error(
          'Error processing background image, falling back to black background:',
          error,
        );
      }
    }

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, bgTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, customBackgroundImage);
  }

  function setBlurRadius(radius: number | null) {
    blurRadius = radius;
    setBackgroundImage(null);
  }

  function setStepWidth(_stepWidth: number) {
    stepWidth = _stepWidth;
  }

  function cleanup() {
    gl.deleteProgram(compositeProgram);
    gl.deleteProgram(blurProgram);
    gl.deleteTexture(bgTexture);
    gl.deleteTexture(frameTexture);
    for (const texture of processTextures) {
      gl.deleteTexture(texture);
    }
    for (const framebuffer of processFramebuffers) {
      gl.deleteFramebuffer(framebuffer);
    }
    gl.deleteBuffer(vertexBuffer);

    // Release any ImageBitmap resources
    if (customBackgroundImage) {
      if (customBackgroundImage instanceof ImageBitmap) {
        customBackgroundImage.close();
      }
      customBackgroundImage = emptyImageData;
    }
    processTextures = [];
    processFramebuffers = [];
  }

  return { render, setBackgroundImage, setBlurRadius, cleanup, setStepWidth };
};
