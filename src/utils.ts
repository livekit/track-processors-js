import { MPMask } from '@mediapipe/tasks-vision';

/* eslint-disable @typescript-eslint/naming-convention */
export const supportsProcessor = typeof MediaStreamTrackGenerator !== 'undefined';
export const supportsOffscreenCanvas = typeof OffscreenCanvas !== 'undefined';

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

export type WebGLRenderer = {
  gl: WebGLRenderingContext;
  render: (videoFrame: VideoFrame, radius: number, mask: TexImageSource) => void;
  cleanup: () => void;
};

export function initWebGL(canvas: OffscreenCanvas): WebGLRenderer {
  const gl = canvas.getContext('webgl');
  if (!gl) throw new Error('WebGL not supported');

  const vsSource = `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    varying vec2 v_texCoord;
    void main() {
      gl_Position = vec4(a_position, 0, 1);
      v_texCoord = a_texCoord;
    }
  `;

  const fsSource = `
    precision mediump float;
    varying vec2 v_texCoord;
    uniform sampler2D u_texture;
    void main() {
      gl_FragColor = texture2D(u_texture, v_texCoord);
    }
  `;

  const createShader = (type: number, source: string): WebGLShader => {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Failed to create shader');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) || 'Unknown shader error');
    }
    return shader;
  };

  const vertexShader = createShader(gl.VERTEX_SHADER, vsSource);
  const fragmentShader = createShader(gl.FRAGMENT_SHADER, fsSource);

  const program = gl.createProgram();
  if (!program) throw new Error('Failed to create program');
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || 'Program linking failed');
  }
  gl.useProgram(program);

  // Position buffer
  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  const positions = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

  const posLoc = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  // Texture coord buffer
  const texCoordBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
  const texCoords = new Float32Array([0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0]);
  gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);

  const texLoc = gl.getAttribLocation(program, 'a_texCoord');
  gl.enableVertexAttribArray(texLoc);
  gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 0, 0);

  // Texture setup
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  const render = (videoFrame: VideoFrame): void => {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, videoFrame);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };

  const cleanup = (): void => {
    gl.deleteTexture(texture);
    gl.deleteBuffer(positionBuffer);
    gl.deleteBuffer(texCoordBuffer);
    gl.deleteProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
  };

  return { gl, render, cleanup };
}

type BlurPipeline = {
  render: (frame: VideoFrame, radius: number, mask: MPMask) => void;
  cleanup: () => void;
};

export function createBlurPipeline(canvas: OffscreenCanvas): BlurPipeline {
  const gl = canvas.getContext('webgl')!;
  if (!gl) throw new Error('WebGL not supported');

  const baseVertexShader = `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    varying vec2 v_texCoord;
    uniform float u_flipY;

    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
      v_texCoord = vec2(a_texCoord.x, u_flipY == 1.0 ? 1.0 - a_texCoord.y : a_texCoord.y);
    }
  `;

  const blurFragmentShader = `
    precision mediump float;
    varying vec2 v_texCoord;
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
        vec2 sampleCoord = v_texCoord + u_direction * u_texelSize * offset;
        result += texture2D(u_texture, sampleCoord).rgb * weight;
        totalWeight += weight;
      }

      gl_FragColor = vec4(result / totalWeight, 1.0);
    }
  `;

  const compositeFragmentShader = `
  precision mediump float;
  varying vec2 v_texCoord;
  uniform sampler2D u_original;
  uniform sampler2D u_blurred;
  uniform sampler2D u_mask;

  void main() {
    vec4 orig = texture2D(u_original, v_texCoord);
    vec4 blur = texture2D(u_blurred, v_texCoord);
    vec4 mask = texture2D(u_mask, v_texCoord);
    gl_FragColor = vec4(mask.r * 10.0, mask.g * 10.0, mask.b * 10.0, orig.a);
  }
`;

  const compositeProgram = createProgram(baseVertexShader, compositeFragmentShader);

  // --- Compile
  function compileShader(type: number, source: string): WebGLShader {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader)!);
    }
    return shader;
  }

  function createProgram(vsSrc: string, fsSrc: string): WebGLProgram {
    const vs = compileShader(gl.VERTEX_SHADER, vsSrc);
    const fs = compileShader(gl.FRAGMENT_SHADER, fsSrc);
    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program)!);
    }
    return program;
  }

  const program = createProgram(baseVertexShader, blurFragmentShader);

  const quad = new Float32Array([
    -1, -1, 0, 1, 1, -1, 1, 1, -1, 1, 0, 0, -1, 1, 0, 0, 1, -1, 1, 1, 1, 1, 1, 0,
  ]);

  const quadBuffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

  const positionLoc = gl.getAttribLocation(program, 'a_position');
  const texCoordLoc = gl.getAttribLocation(program, 'a_texCoord');

  const u_texture = gl.getUniformLocation(program, 'u_texture');
  const u_texelSize = gl.getUniformLocation(program, 'u_texelSize');
  const u_direction = gl.getUniformLocation(program, 'u_direction');
  const u_radius = gl.getUniformLocation(program, 'u_radius');
  const u_flipY = gl.getUniformLocation(program, 'u_flipY');

  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  const framebuffer = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // Second texture and framebuffer for vertical blur pass
  const blurTexture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, blurTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    canvas.width,
    canvas.height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null,
  );

  // const maskTexture = gl.createTexture()!;
  // gl.bindTexture(gl.TEXTURE_2D, maskTexture);
  // gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  // gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  // gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  // gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  const blurFBO = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, blurFBO);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, blurTexture, 0);

  // === Render Function ===
  function render(frame: VideoFrame, radius: number, mask: MPMask) {
    if (!mask.canvas) {
      console.warn('MPMask does not have a canvas, skipping render');
      return;
    }

    const maskContext = mask.canvas.getContext('webgl') as WebGLRenderingContext | null;
    if (!maskContext) {
      console.warn('MPMask canvas does not have WebGL context, skipping render');
      return;
    }

    // Bind the framebuffer for horizontal blur
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, canvas.width, canvas.height);

    // Use the blur program for horizontal pass
    gl.useProgram(program);

    // Set up vertex attributes
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(texCoordLoc);
    gl.vertexAttribPointer(texCoordLoc, 2, gl.FLOAT, false, 16, 8);

    // Set uniforms for horizontal blur
    gl.uniform1i(u_texture, 0);
    gl.uniform2f(u_texelSize, 1.0 / canvas.width, 1.0 / canvas.height);
    gl.uniform2f(u_direction, 1.0, 0.0);
    gl.uniform1f(u_radius, radius);
    gl.uniform1f(u_flipY, 1.0);

    // Bind and upload the frame to texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);

    // Draw horizontal blur
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Bind the framebuffer for vertical blur
    gl.bindFramebuffer(gl.FRAMEBUFFER, blurFBO);

    // Set uniforms for vertical blur
    gl.uniform2f(u_direction, 0.0, 1.0);

    // Bind the horizontally blurred texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);

    // Draw vertical blur
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Now use the composite program to blend with mask
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(compositeProgram);

    // Set up vertex attributes for composite
    gl.enableVertexAttribArray(gl.getAttribLocation(compositeProgram, 'a_position'));
    gl.vertexAttribPointer(
      gl.getAttribLocation(compositeProgram, 'a_position'),
      2,
      gl.FLOAT,
      false,
      16,
      0,
    );
    gl.enableVertexAttribArray(gl.getAttribLocation(compositeProgram, 'a_texCoord'));
    gl.vertexAttribPointer(
      gl.getAttribLocation(compositeProgram, 'a_texCoord'),
      2,
      gl.FLOAT,
      false,
      16,
      8,
    );

    // Set uniforms for composite
    gl.uniform1i(gl.getUniformLocation(compositeProgram, 'u_original'), 0);
    gl.uniform1i(gl.getUniformLocation(compositeProgram, 'u_blurred'), 1);
    gl.uniform1i(gl.getUniformLocation(compositeProgram, 'u_mask'), 2);

    // Bind textures
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, blurTexture);
    gl.activeTexture(gl.TEXTURE2);
    // The mask texture is already bound to mask.canvas, so we can use it directly
    const maskTexture = maskContext.getParameter(maskContext.TEXTURE_BINDING_2D);
    gl.bindTexture(gl.TEXTURE_2D, maskTexture);

    // Draw final composite
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function cleanup() {
    gl.deleteBuffer(quadBuffer);
    gl.deleteTexture(texture);
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(blurTexture);
    gl.deleteFramebuffer(blurFBO);
  }

  return { render, cleanup };
}
