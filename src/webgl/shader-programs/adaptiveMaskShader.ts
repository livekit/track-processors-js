import { createProgram, createShader, glsl } from '../utils';
import { vertexShaderSource } from './vertexShader';

// Dynamic Temporal Smoothing
export const adaptiveMaskFragmentShader = glsl`#version 300 es
  precision highp float;

  in vec2 texCoords;

  uniform sampler2D u_previousMask;
  uniform sampler2D u_currentMask;
  uniform sampler2D u_previousFrame;
  uniform sampler2D u_currentFrame;

  out vec4 fragColor;

  float frameDifference(vec2 uv) {
    vec3 previous = texture(u_previousFrame, uv).rgb;
    vec3 current = texture(u_currentFrame, uv).rgb;
    vec3 difference = abs(current - previous);

    return max(
      difference.r,
      max(difference.g, difference.b)
    );
  }

  void main() {
    float previousConfidence =
      texture(u_previousMask, texCoords).r;

    float currentConfidence =
      texture(u_currentMask, texCoords).r;

    vec2 stepUV =
      2.0 / vec2(textureSize(u_currentFrame, 0));

    float movement = max(
      frameDifference(texCoords),
      max(
        frameDifference(
          clamp(
            texCoords + vec2(stepUV.x, 0.0),
            0.0,
            1.0
          )
        ),
        frameDifference(
          clamp(
            texCoords + vec2(0.0, stepUV.y),
            0.0,
            1.0
          )
        )
      )
    );

    float motionFactor = smoothstep(
      0.035,
      0.14,
      movement
    );

    // Ruhig: 15 % neue Maske
    // Bewegung: bis zu 90 % neue Maske
    float newMaskWeight = mix(
      0.15,
      0.90,
      motionFactor
    );

    float confidence = mix(
      previousConfidence,
      currentConfidence,
      newMaskWeight
    );

    fragColor = vec4(vec3(confidence), 1.0);
  }
`;

export function createAdaptiveMaskProgram(gl: WebGL2RenderingContext) {

  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource(false));

  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, adaptiveMaskFragmentShader);

  const program = createProgram(gl, vertexShader, fragmentShader);

  return {
    program,
    vertexShader,
    fragmentShader,
    uniforms: {
      position: gl.getAttribLocation(program, 'position'),

      previousMask: gl.getUniformLocation(program, 'u_previousMask')!,

      currentMask: gl.getUniformLocation(program, 'u_currentMask')!,

      previousFrame: gl.getUniformLocation(program, 'u_previousFrame')!,

      currentFrame: gl.getUniformLocation(program, 'u_currentFrame')!,
    },
  };
}
