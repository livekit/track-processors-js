import { createProgram, createShader } from '../utils';
import { vertexShaderSource } from './vertexShader';

// Taps beyond this radius are dropped; the kernel stays normalized over the taps that remain.
const GAUSSIAN_MAX_RADIUS = 16;
const GAUSSIAN_MAX_TAPS = 1 + Math.ceil(GAUSSIAN_MAX_RADIUS / 2);

// Plain template, not glsl``: the glsl tag drops ${} substitutions.
export const blurFragmentShader = `#version 300 es
  precision mediump float;
  in vec2 texCoords;
  uniform sampler2D u_texture;
  uniform vec2 u_texelSize;
  uniform vec2 u_direction;
  // Normalized Gaussian taps, pre-merged in pairs so one bilinear fetch reads two
  // texels (offsets fall between texel centers). Index 0 is the center tap.
  uniform float u_weights[${GAUSSIAN_MAX_TAPS}];
  uniform float u_offsets[${GAUSSIAN_MAX_TAPS}];
  uniform int u_tapCount;
  out vec4 fragColor;

  void main() {
    vec3 result = texture(u_texture, texCoords).rgb * u_weights[0];

    for (int i = 1; i < ${GAUSSIAN_MAX_TAPS}; ++i) {
      if (i >= u_tapCount) break;
      vec2 offset = u_direction * u_texelSize * u_offsets[i];
      result += (texture(u_texture, texCoords + offset).rgb + texture(u_texture, texCoords - offset).rgb) * u_weights[i];
    }

    fragColor = vec4(result, 1.0);
  }
`;

/**
 * The one-sided Gaussian kernel for `blurRadius` (used as sigma), with each pair of neighboring
 * taps merged into one weight at their weighted-average offset. Sampling there with LINEAR
 * filtering returns the same weighted sum as fetching both texels, at half the fetches.
 */
export function computeGaussianKernel(blurRadius: number) {
  const sigma = blurRadius;
  const radius = Math.min(GAUSSIAN_MAX_RADIUS, Math.ceil(blurRadius));
  const weightAt = (offset: number) => Math.exp(-(offset * offset) / (2 * sigma * sigma));

  const weights = new Float32Array(GAUSSIAN_MAX_TAPS);
  const offsets = new Float32Array(GAUSSIAN_MAX_TAPS);
  weights[0] = weightAt(0);
  let total = weights[0];
  let tapCount = 1;

  for (let i = 1; i <= radius; i += 2) {
    const w1 = weightAt(i);
    const w2 = i + 1 <= radius ? weightAt(i + 1) : 0;
    const pairWeight = w1 + w2;
    weights[tapCount] = pairWeight;
    offsets[tapCount] = (i * w1 + (i + 1) * w2) / pairWeight;
    // Each merged tap is applied on both sides of the center.
    total += 2 * pairWeight;
    tapCount += 1;
  }

  for (let i = 0; i < tapCount; i++) {
    weights[i] /= total;
  }

  return { weights, offsets, tapCount };
}

export function createBlurProgram(gl: WebGL2RenderingContext) {
  const blurVertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource());
  const blurFrag = createShader(gl, gl.FRAGMENT_SHADER, blurFragmentShader);

  const blurProgram = createProgram(gl, blurVertexShader, blurFrag);

  // Get uniform locations
  const blurUniforms = {
    position: gl.getAttribLocation(blurProgram, 'position'),
    texture: gl.getUniformLocation(blurProgram, 'u_texture'),
    texelSize: gl.getUniformLocation(blurProgram, 'u_texelSize'),
    direction: gl.getUniformLocation(blurProgram, 'u_direction'),
    weights: gl.getUniformLocation(blurProgram, 'u_weights'),
    offsets: gl.getUniformLocation(blurProgram, 'u_offsets'),
    tapCount: gl.getUniformLocation(blurProgram, 'u_tapCount'),
    // The blur radius the kernel uniforms were last computed for; they persist on the program.
    kernelRadius: null as number | null,
  };

  return {
    program: blurProgram,
    shader: blurFrag,
    vertexShader: blurVertexShader,
    uniforms: blurUniforms,
  };
}

export function applyBlur(
  gl: WebGL2RenderingContext,
  sourceTexture: WebGLTexture,
  width: number,
  height: number,
  blurRadius: number,
  blurProgram: WebGLProgram,
  blurUniforms: any,
  vertexBuffer: WebGLBuffer,
  processFramebuffers: WebGLFramebuffer[],
  processTextures: WebGLTexture[],
) {
  gl.useProgram(blurProgram);

  // Set common attributes
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.vertexAttribPointer(blurUniforms.position, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(blurUniforms.position);

  const texelWidth = 1.0 / width;
  const texelHeight = 1.0 / height;

  // First pass - horizontal blur
  gl.bindFramebuffer(gl.FRAMEBUFFER, processFramebuffers[0]);
  gl.viewport(0, 0, width, height);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
  gl.uniform1i(blurUniforms.texture, 0);
  gl.uniform2f(blurUniforms.texelSize, texelWidth, texelHeight);
  gl.uniform2f(blurUniforms.direction, 1.0, 0.0); // Horizontal
  if (blurUniforms.weights) {
    // Gaussian program: upload the kernel only when the radius changes.
    if (blurUniforms.kernelRadius !== blurRadius) {
      const kernel = computeGaussianKernel(blurRadius);
      gl.uniform1fv(blurUniforms.weights, kernel.weights);
      gl.uniform1fv(blurUniforms.offsets, kernel.offsets);
      gl.uniform1i(blurUniforms.tapCount, kernel.tapCount);
      blurUniforms.kernelRadius = blurRadius;
    }
  } else {
    // Box blur program, which takes the radius directly.
    gl.uniform1f(blurUniforms.radius, blurRadius);
  }

  gl.drawArrays(gl.TRIANGLES, 0, 6);

  // Second pass - vertical blur
  gl.bindFramebuffer(gl.FRAMEBUFFER, processFramebuffers[1]);
  gl.viewport(0, 0, width, height);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, processTextures[0]);
  gl.uniform1i(blurUniforms.texture, 0);
  gl.uniform2f(blurUniforms.direction, 0.0, 1.0); // Vertical

  gl.drawArrays(gl.TRIANGLES, 0, 6);

  // Reset framebuffer
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  return processTextures[1];
}
