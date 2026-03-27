import { createProgram, createShader, glsl } from '../utils';
import { vertexShaderSource } from './vertexShader';

/**
 * Temporal blend shader — lerps between two textures.
 * Used to smooth the segmentation mask over time, reducing frame-to-frame
 * jitter at edges.
 *
 *   output = mix(previousMask, currentMask, u_blendFactor)
 *
 * u_blendFactor = 1.0 → use only the new mask (no smoothing)
 * u_blendFactor = 0.4 → 40% new + 60% previous (heavy smoothing)
 */
export const blendFragmentShader = glsl`#version 300 es
precision mediump float;

in vec2 texCoords;

uniform sampler2D u_current;
uniform sampler2D u_previous;
uniform float u_blendFactor;  // 0..1, how much of the NEW mask to use

out vec4 fragColor;

void main() {
    float current = texture(u_current, texCoords).r;
    float previous = texture(u_previous, texCoords).r;
    float blended = mix(previous, current, u_blendFactor);
    fragColor = vec4(blended, blended, blended, 1.0);
}
`;

export function createBlendProgram(gl: WebGL2RenderingContext) {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource());
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, blendFragmentShader);

  const program = createProgram(gl, vertexShader, fragmentShader);

  const uniforms = {
    position: gl.getAttribLocation(program, 'position'),
    current: gl.getUniformLocation(program, 'u_current'),
    previous: gl.getUniformLocation(program, 'u_previous'),
    blendFactor: gl.getUniformLocation(program, 'u_blendFactor'),
  };

  return { program, vertexShader, fragmentShader, uniforms };
}
