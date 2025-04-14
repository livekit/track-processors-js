import { MPMask } from '@mediapipe/tasks-vision';

// Define the blur fragment shader
const blurFragmentShader = `
  precision highp float;
  varying vec2 texCoords;
  uniform sampler2D u_texture;
  uniform vec2 u_texelSize;
  uniform vec2 u_direction;
  uniform float u_radius;

  void main() {
    float sigma = u_radius;
    float twoSigmaSq = 2.0 * sigma * sigma;
    float totalWeight = 0.0;
    vec3 result = vec3(0.0);
    const int MAX_SAMPLES = 16;
    int radius = int(min(float(MAX_SAMPLES), ceil(u_radius)));

    for (int i = -MAX_SAMPLES; i <= MAX_SAMPLES; ++i) {
      float offset = float(i);
      if (abs(offset) > float(radius)) continue;
      float weight = exp(-(offset * offset) / twoSigmaSq);
      vec2 sampleCoord = texCoords + u_direction * u_texelSize * offset;
      result += texture2D(u_texture, sampleCoord).rgb * weight;
      totalWeight += weight;
    }

    gl_FragColor = vec4(result / totalWeight, 1.0);
  }
`;

const createShaderProgram = (gl: WebGL2RenderingContext) => {
  const vs = `
      attribute vec2 position;
      varying vec2 texCoords;
    
      void main() {
        texCoords = (position + 1.0) / 2.0;
        texCoords.y = 1.0 - texCoords.y;
        gl_Position = vec4(position, 0, 1.0);
      }
    `;

  const cS = `
      precision highp float;
      varying vec2 texCoords;
      uniform sampler2D background;
      uniform sampler2D frame;
      uniform sampler2D mask;
      void main() {
          vec4 maskTex = texture2D(mask, texCoords); 
          vec4 frameTex = texture2D(frame, texCoords);
          vec4 bgTex = texture2D(background, texCoords);
       
      
        float a = maskTex.r;
  
        //gl_FragColor = mix(bgTex, vec4(frameTex.rgb, 1.0), a);
        gl_FragColor = mix(bgTex, vec4(frameTex.rgb, 1.0), 1.0 - a);
      
      }
    `;

  const vertexShader = gl.createShader(gl.VERTEX_SHADER);
  if (!vertexShader) {
    throw Error('can not create vertex shader');
  }
  gl.shaderSource(vertexShader, vs);
  gl.compileShader(vertexShader);

  // Create our fragment shader
  const compositeShader = gl.createShader(gl.FRAGMENT_SHADER);
  if (!compositeShader) {
    throw Error('can not create fragment shader');
  }
  gl.shaderSource(compositeShader, cS);
  gl.compileShader(compositeShader);

  // Create the composite program
  const compositeProgram = gl.createProgram();
  if (!compositeProgram) {
    throw Error('can not create composite program');
  }
  gl.attachShader(compositeProgram, vertexShader);
  gl.attachShader(compositeProgram, compositeShader);
  gl.linkProgram(compositeProgram);

  let blurProgram = null;
  let blurVertexShader = null;
  let blurFrag = null;
  let blurUniforms = null;

  // Create blur shader if enabled
  blurFrag = gl.createShader(gl.FRAGMENT_SHADER);
  if (!blurFrag) {
    throw Error('can not create blur shader');
  }
  gl.shaderSource(blurFrag, blurFragmentShader);
  gl.compileShader(blurFrag);

  // Get compile status and log errors if any
  if (!gl.getShaderParameter(blurFrag, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(blurFrag);
    throw Error(`Failed to compile blur shader: ${info}`);
  }

  // Create blur program
  blurVertexShader = gl.createShader(gl.VERTEX_SHADER);
  if (!blurVertexShader) {
    throw Error('can not create blur vertex shader');
  }
  gl.shaderSource(blurVertexShader, vs);
  gl.compileShader(blurVertexShader);

  blurProgram = gl.createProgram();
  if (!blurProgram) {
    throw Error('can not create blur program');
  }
  gl.attachShader(blurProgram, blurVertexShader);
  gl.attachShader(blurProgram, blurFrag);
  gl.linkProgram(blurProgram);

  // Check blur program link status
  if (!gl.getProgramParameter(blurProgram, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(blurProgram);
    throw Error(`Failed to link blur program: ${info}`);
  }

  blurUniforms = {
    position: gl.getAttribLocation(blurProgram, 'position'),
    texture: gl.getUniformLocation(blurProgram, 'u_texture'),
    texelSize: gl.getUniformLocation(blurProgram, 'u_texelSize'),
    direction: gl.getUniformLocation(blurProgram, 'u_direction'),
    radius: gl.getUniformLocation(blurProgram, 'u_radius'),
  };

  return {
    vertexShader,
    compositeShader,
    blurShader: blurFrag,
    compositeProgram,
    blurProgram,
    attribLocations: {
      position: gl.getAttribLocation(compositeProgram, 'position'),
    },
    uniformLocations: {
      mask: gl.getUniformLocation(compositeProgram, 'mask')!,
      frame: gl.getUniformLocation(compositeProgram, 'frame')!,
      background: gl.getUniformLocation(compositeProgram, 'background')!,
    },
    blurUniforms,
  };
};

export function initTexture(gl: WebGL2RenderingContext, texIndex: number) {
  const texRef = gl.TEXTURE0 + texIndex;
  gl.activeTexture(texRef);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.bindTexture(gl.TEXTURE_2D, texture);

  return texture;
}

export function createFramebuffer(
  gl: WebGL2RenderingContext,
  texture: WebGLTexture,
  width: number,
  height: number,
) {
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);

  // Set the texture as the color attachment
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

  // Ensure texture dimensions match the provided width and height
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

  // Check if framebuffer is complete
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error('Framebuffer not complete');
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return framebuffer;
}

const createVertexBuffer = (gl: WebGL2RenderingContext) => {
  if (!gl) {
    return null;
  }
  const vertexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, -1, 1, 1, 1, -1, -1, 1, 1, 1, -1]),
    gl.STATIC_DRAW,
  );
  return vertexBuffer;
};

export const setupWebGL = (canvas: OffscreenCanvas) => {
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: false }) as WebGL2RenderingContext;

  let blurRadius: number | null = null;

  if (!gl) {
    return undefined;
  }

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  const {
    compositeProgram,
    blurProgram,
    attribLocations: { position: positionLocation },
    uniformLocations: {
      mask: maskTextureLocation,
      frame: frameTextureLocation,
      background: bgTextureLocation,
    },
    blurUniforms,
  } = createShaderProgram(gl);

  const bgTexture = initTexture(gl, 0);
  const frameTexture = initTexture(gl, 1);
  const vertexBuffer = createVertexBuffer(gl);

  // Create additional textures and framebuffers for blur pass if enabled
  let blurTextures: WebGLTexture[] = [];
  let blurFramebuffers: WebGLFramebuffer[] = [];

  // Create two textures for blur passes (horizontal and vertical)
  blurTextures.push(initTexture(gl, 3));
  blurTextures.push(initTexture(gl, 4));

  // Create framebuffers for blur passes
  blurFramebuffers.push(createFramebuffer(gl, blurTextures[0], canvas.width, canvas.height));
  blurFramebuffers.push(createFramebuffer(gl, blurTextures[1], canvas.width, canvas.height));

  // Set up uniforms for the composite shader
  gl.useProgram(compositeProgram);
  gl.uniform1i(bgTextureLocation, 0);
  gl.uniform1i(frameTextureLocation, 1);
  gl.uniform1i(maskTextureLocation, 2);

  // Store custom background image
  let customBackgroundImage: ImageBitmap | null = null;

  function applyBlur(sourceTexture: WebGLTexture, width: number, height: number) {
    if (!blurRadius || !blurProgram || !blurUniforms) return sourceTexture;

    gl.useProgram(blurProgram);

    // Set common attributes
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.vertexAttribPointer(blurUniforms.position, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(blurUniforms.position);

    const texelWidth = 1.0 / width;
    const texelHeight = 1.0 / height;

    // First pass - horizontal blur
    gl.bindFramebuffer(gl.FRAMEBUFFER, blurFramebuffers[0]);
    gl.viewport(0, 0, width, height);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
    gl.uniform1i(blurUniforms.texture, 0);
    gl.uniform2f(blurUniforms.texelSize, texelWidth, texelHeight);
    gl.uniform2f(blurUniforms.direction, 1.0, 0.0); // Horizontal
    gl.uniform1f(blurUniforms.radius, blurRadius);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Second pass - vertical blur
    gl.bindFramebuffer(gl.FRAMEBUFFER, blurFramebuffers[1]);
    gl.viewport(0, 0, width, height);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, blurTextures[0]);
    gl.uniform1i(blurUniforms.texture, 0);
    gl.uniform2f(blurUniforms.direction, 0.0, 1.0); // Vertical

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Reset framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    return blurTextures[1];
  }

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

    // If we have a custom background image, use that
    if (customBackgroundImage) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, bgTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, customBackgroundImage);
      backgroundTexture = bgTexture;
    } else if (blurRadius) {
      // Otherwise, if blur is enabled, apply blur effect to the frame
      backgroundTexture = applyBlur(frameTexture, width, height);
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

    // Set frame texture
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, frameTexture);
    gl.uniform1i(frameTextureLocation, 1);

    // Set mask texture
    const maskTexture = mask.getAsWebGLTexture();
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, maskTexture);
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
      try {
        // Determine appropriate size to avoid performance issues
        // Get current canvas dimensions
        const canvasWidth = canvas.width;
        const canvasHeight = canvas.height;

        // Only resize if the image is significantly larger than the canvas
        // A reasonable threshold is 1.5x the canvas size
        const shouldResize = image.width > canvasWidth * 1.5 || image.height > canvasHeight * 1.5;

        if (shouldResize) {
          // Calculate new dimensions while maintaining aspect ratio
          const aspectRatio = image.width / image.height;
          let newWidth = canvasWidth;
          let newHeight = canvasHeight;

          if (aspectRatio > 1) {
            // Landscape orientation
            newHeight = canvasWidth / aspectRatio;
          } else {
            // Portrait or square orientation
            newWidth = canvasHeight * aspectRatio;
          }

          // Resize the image using createImageBitmap with resize option
          const resizedImage = await createImageBitmap(image, {
            resizeWidth: Math.round(newWidth),
            resizeHeight: Math.round(newHeight),
            resizeQuality: 'medium',
          });

          // Store the resized image
          customBackgroundImage = resizedImage;

          // Load the resized image into the texture
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, bgTexture);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, resizedImage);
        } else {
          // Use original image if it's already an appropriate size
          customBackgroundImage = image;

          // Load the image into the texture
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, bgTexture);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        }
      } catch (error) {
        console.error('Error resizing background image:', error);
        // Fallback to original image on error
        customBackgroundImage = image;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, bgTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      }
    }
  }

  function setBlurRadius(radius: number | null) {
    blurRadius = radius;
    setBackgroundImage(null);
  }

  return { render, setBackgroundImage, setBlurRadius };
};
