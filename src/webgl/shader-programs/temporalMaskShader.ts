import { createProgram, createShader, glsl } from '../utils';
import { vertexShaderSource } from './vertexShader';

export const temporalMaskFragmentShader = glsl`#version 300 es
  precision mediump float;
  in vec2 texCoords;
  uniform sampler2D u_previousMask;
  uniform sampler2D u_currentMask;
  uniform sampler2D u_previousFrame;
  uniform sampler2D u_currentFrame;
  out vec4 fragColor;

  float frameChange(vec2 uv) {
    vec3 difference = abs(texture(u_currentFrame, uv).rgb - texture(u_previousFrame, uv).rgb);
    return max(difference.r, max(difference.g, difference.b));
  }

  void main() {
    vec2 offset = 2.0 / vec2(textureSize(u_currentFrame, 0));
    float change = max(
      frameChange(texCoords),
      max(frameChange(texCoords + vec2(offset.x, 0.0)), frameChange(texCoords + vec2(0.0, offset.y)))
    );
    float currentWeight = mix(0.15, 0.9, smoothstep(0.035, 0.14, change));
    float mask = mix(texture(u_previousMask, texCoords).r, texture(u_currentMask, texCoords).r, currentWeight);
    fragColor = vec4(vec3(mask), 1.0);
  }
`;

export function createTemporalMaskProgram(gl: WebGL2RenderingContext) {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource(false));
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, temporalMaskFragmentShader);
  const program = createProgram(gl, vertexShader, fragmentShader);

  return {
    program,
    uniforms: {
      position: gl.getAttribLocation(program, 'position'),
      previousMask: gl.getUniformLocation(program, 'u_previousMask'),
      currentMask: gl.getUniformLocation(program, 'u_currentMask'),
      previousFrame: gl.getUniformLocation(program, 'u_previousFrame'),
      currentFrame: gl.getUniformLocation(program, 'u_currentFrame'),
    },
  };
}
