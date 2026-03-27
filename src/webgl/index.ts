/**
 * WebGL setup for the mask processor
 * potential improvements:
 * - downsample the video texture in background blur scenario before applying the (gaussian) blur for better performance
 *
 */
import { getLogger, LoggerNames} from '../logger';
import { applyBlur, createBlurProgram } from './shader-programs/blurShader';
import { createBlendProgram } from './shader-programs/blendShader';
import { createBoxBlurProgram } from './shader-programs/boxBlurShader';
import { createCompositeProgram } from './shader-programs/compositeShader';
import { applyDilation, createDilationProgram } from './shader-programs/dilationShader';
import { applyDownsampling, createDownSampler } from './shader-programs/downSampler';
import {
  createFramebuffer,
  createVertexBuffer,
  getEmptyImageData,
  initTexture,
  resizeImageToCover,
} from './utils';

const log = getLogger(LoggerNames.WebGl);

export const setupWebGL = (canvas: OffscreenCanvas | HTMLCanvasElement) => {
  const gl = canvas.getContext('webgl2', {
    antialias: true,
    premultipliedAlpha: true,
  }) as WebGL2RenderingContext;

  let blurRadius: number | null = null;
  let maskBlurRadius: number | null = 0;
  let maskDilationRadius: number = 0;
  let compositeThreshold: number = 0;
  let compositeEdgeSoftness: number = 0;
  let temporalSmoothing: number = 0.2; // 0 = no smoothing, higher = more temporal blending
  const downsampleFactor = 4;

  if (!gl) {
    log.error('Failed to create WebGL context');
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
    disableBackground: disableBackgroundLocation,
    threshold: thresholdLocation,
    edgeSoftness: edgeSoftnessLocation,
  } = composite.uniformLocations;

  // Create the blur program using the same vertex shader source
  const blur = createBlurProgram(gl);
  const blurProgram = blur.program;
  const blurUniforms = blur.uniforms;

  // Create the box blur program
  const boxBlur = createBoxBlurProgram(gl);
  const boxBlurProgram = boxBlur.program;
  const boxBlurUniforms = boxBlur.uniforms;

  // Create the dilation (min-filter) program for expanding the person mask
  const dilation = createDilationProgram(gl);
  const dilationProgram = dilation.program;
  const dilationUniforms = dilation.uniforms;

  // Create the temporal blend program for smoothing mask across frames
  const blend = createBlendProgram(gl);
  const blendProgram = blend.program;
  const blendUniforms = blend.uniforms;

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

  const bgBlurTextureWidth = Math.floor(canvas.width / downsampleFactor);
  const bgBlurTextureHeight = Math.floor(canvas.height / downsampleFactor);

  const downSampler = createDownSampler(gl, bgBlurTextureWidth, bgBlurTextureHeight);

  // Create framebuffers for background processing
  bgBlurFrameBuffers.push(
    createFramebuffer(gl, bgBlurTextures[0], bgBlurTextureWidth, bgBlurTextureHeight),
  );
  bgBlurFrameBuffers.push(
    createFramebuffer(gl, bgBlurTextures[1], bgBlurTextureWidth, bgBlurTextureHeight),
  );

  // Initialize textures for mask dilation (two-pass separable min-filter)
  const dilationTextures = [initTexture(gl, 8), initTexture(gl, 9)];
  const dilationFrameBuffers = [
    createFramebuffer(gl, dilationTextures[0], canvas.width, canvas.height),
    createFramebuffer(gl, dilationTextures[1], canvas.width, canvas.height),
  ];

  // Initialize texture for the first mask blur pass
  const tempMaskTexture = initTexture(gl, 5);
  const tempMaskFrameBuffer = createFramebuffer(gl, tempMaskTexture, canvas.width, canvas.height);

  // Initialize two textures for double-buffering the final mask
  finalMaskTextures.push(initTexture(gl, 6)); // For reading in renderFrame
  finalMaskTextures.push(initTexture(gl, 7)); // For writing in updateMask

  // Create framebuffers for the final mask textures
  const finalMaskFrameBuffers = [
    createFramebuffer(gl, finalMaskTextures[0], canvas.width, canvas.height),
    createFramebuffer(gl, finalMaskTextures[1], canvas.width, canvas.height),
  ];

  let backgroundImageDisabled = false;

  // Set up uniforms for the composite shader
  gl.useProgram(compositeProgram);
  gl.uniform1i(disableBackgroundLocation, backgroundImageDisabled ? 1 : 0);
  gl.uniform1i(bgTextureLocation, 0);
  gl.uniform1i(frameTextureLocation, 1);
  gl.uniform1i(maskTextureLocation, 2);
  gl.uniform1f(thresholdLocation, compositeThreshold);
  gl.uniform1f(edgeSoftnessLocation, compositeEdgeSoftness);

  // Store custom background image
  let customBackgroundImage: ImageBitmap | ImageData | null = null;

  function renderFrame(frame: VideoFrame) {
    if (frame.codedWidth === 0 || finalMaskTextures.length === 0) {
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
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, bgTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, customBackgroundImage);
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
    gl.uniform1f(thresholdLocation, compositeThreshold);
    gl.uniform1f(edgeSoftnessLocation, compositeEdgeSoftness);

    // Set frame texture
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, frameTexture);
    gl.uniform1i(frameTextureLocation, 1);

    // Set mask texture - always read from the current read index
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, finalMaskTextures[readMaskIndex]);
    gl.uniform1i(maskTextureLocation, 2);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /**
   * Set or update the background image
   * @param image The background image to use, or null to clear
   */
  async function setBackgroundImage(image: ImageBitmap | null) {
    // Clear existing background
    customBackgroundImage = null;

    if (image) {
      customBackgroundImage = getEmptyImageData();
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
    let currentMask = mask;

    // Step 1 (optional): Dilate to expand person region
    if (maskDilationRadius > 0) {
      currentMask = applyDilation(
        gl,
        currentMask,
        canvas.width,
        canvas.height,
        maskDilationRadius,
        dilationProgram,
        dilationUniforms,
        vertexBuffer!,
        dilationFrameBuffers,
        dilationTextures,
      );
    }

    // Step 2 (optional): Blur the mask for smooth edges
    if (maskBlurRadius && maskBlurRadius > 0) {
      const tempFramebuffers = [tempMaskFrameBuffer, finalMaskFrameBuffers[writeMaskIndex]];
      const tempTextures = [tempMaskTexture, finalMaskTextures[writeMaskIndex]];

      applyBlur(
        gl,
        currentMask,
        canvas.width,
        canvas.height,
        maskBlurRadius,
        boxBlurProgram,
        boxBlurUniforms,
        vertexBuffer!,
        tempFramebuffers,
        tempTextures,
      );
      // After blur, the result is in finalMaskTextures[writeMaskIndex]
    } else {
      // No blur — copy the current mask directly into finalMaskTextures[writeMaskIndex]
      // by rendering it through the blend shader with blendFactor=1.0 (pass-through)
      gl.useProgram(blendProgram);
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.vertexAttribPointer(blendUniforms.position, 2, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(blendUniforms.position);

      gl.bindFramebuffer(gl.FRAMEBUFFER, finalMaskFrameBuffers[writeMaskIndex]);
      gl.viewport(0, 0, canvas.width, canvas.height);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, currentMask);
      gl.uniform1i(blendUniforms.current, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, currentMask); // dummy for previous
      gl.uniform1i(blendUniforms.previous, 1);
      gl.uniform1f(blendUniforms.blendFactor, 1.0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    // Step 3 (optional): Temporal smoothing — blend with previous frame's mask
    if (temporalSmoothing > 0.01) {
      // The new processed mask is in finalMaskTextures[writeMaskIndex]
      // The previous mask is in finalMaskTextures[readMaskIndex]
      // Blend them and write back to tempMask, then copy to write slot
      gl.useProgram(blendProgram);
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.vertexAttribPointer(blendUniforms.position, 2, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(blendUniforms.position);

      // Render blended result into tempMaskFrameBuffer
      gl.bindFramebuffer(gl.FRAMEBUFFER, tempMaskFrameBuffer);
      gl.viewport(0, 0, canvas.width, canvas.height);

      // Current (new) mask
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, finalMaskTextures[writeMaskIndex]);
      gl.uniform1i(blendUniforms.current, 0);

      // Previous mask
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, finalMaskTextures[readMaskIndex]);
      gl.uniform1i(blendUniforms.previous, 1);

      // blendFactor: how much of the NEW mask to use (1 - temporalSmoothing)
      gl.uniform1f(blendUniforms.blendFactor, 1.0 - temporalSmoothing);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      // Copy the blended result back to finalMaskTextures[writeMaskIndex]
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, tempMaskFrameBuffer);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, finalMaskFrameBuffers[writeMaskIndex]);
      gl.blitFramebuffer(
        0, 0, canvas.width, canvas.height,
        0, 0, canvas.width, canvas.height,
        gl.COLOR_BUFFER_BIT, gl.NEAREST,
      );
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    }

    // Swap indices for the next frame
    readMaskIndex = writeMaskIndex;
    writeMaskIndex = 1 - writeMaskIndex;
  }

  function cleanup() {
    gl.deleteProgram(compositeProgram);
    gl.deleteProgram(blurProgram);
    gl.deleteProgram(boxBlurProgram);
    gl.deleteProgram(dilationProgram);
    gl.deleteProgram(blendProgram);
    gl.deleteTexture(bgTexture);
    gl.deleteTexture(frameTexture);
    gl.deleteTexture(tempMaskTexture);
    gl.deleteFramebuffer(tempMaskFrameBuffer);

    for (const texture of dilationTextures) {
      gl.deleteTexture(texture);
    }
    for (const framebuffer of dilationFrameBuffers) {
      gl.deleteFramebuffer(framebuffer);
    }

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
    bgBlurTextures = [];
    bgBlurFrameBuffers = [];
    finalMaskTextures = [];
  }

  function setMaskDilationRadius(radius: number) {
    maskDilationRadius = radius;
  }

  function setMaskBlurRadius(radius: number | null) {
    maskBlurRadius = radius;
  }

  function setCompositeThreshold(threshold: number) {
    compositeThreshold = threshold;
  }

  function setCompositeEdgeSoftness(softness: number) {
    compositeEdgeSoftness = softness;
  }

  function setTemporalSmoothing(value: number) {
    temporalSmoothing = Math.max(0, Math.min(1, value));
  }

  function getMaskParams() {
    return {
      maskDilationRadius,
      maskBlurRadius,
      compositeThreshold,
      compositeEdgeSoftness,
      temporalSmoothing,
    };
  }

  return {
    renderFrame,
    updateMask,
    setBackgroundImage,
    setBlurRadius,
    setBackgroundDisabled,
    setMaskDilationRadius,
    setMaskBlurRadius,
    setCompositeThreshold,
    setCompositeEdgeSoftness,
    setTemporalSmoothing,
    getMaskParams,
    cleanup,
  };
};
