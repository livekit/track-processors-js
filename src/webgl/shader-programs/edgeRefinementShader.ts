import { createProgram, createShader, glsl } from '../utils';
import { vertexShaderSource } from './vertexShader';

// A joint bilateral filter: each pixel takes the mask of the nearby pixels that look like it in the
// frame, so the mask's edge follows the edge in the picture rather than the model's coarse guess.
export const edgeRefinementFragmentShader = (radius: number) => glsl`#version 300 es
  precision mediump float;
  in vec2 texCoords;
  uniform sampler2D u_mask;
  uniform sampler2D u_frame;
  out vec4 fragColor;

  const int RADIUS = ${radius};
  const float STEP = 2.0;
  const float SPATIAL_SIGMA = 3.0;
  const float RANGE_SIGMA = 0.1;

  void main() {
    vec2 texelStep = STEP / vec2(textureSize(u_mask, 0));
    vec3 center = texture(u_frame, texCoords).rgb;
    float sum = 0.0;
    float weights = 0.0;
    for (int y = -RADIUS; y <= RADIUS; y++) {
      for (int x = -RADIUS; x <= RADIUS; x++) {
        vec2 uv = texCoords + vec2(x, y) * texelStep;
        vec3 difference = texture(u_frame, uv).rgb - center;
        float weight = exp(
          -float(x * x + y * y) / (2.0 * SPATIAL_SIGMA * SPATIAL_SIGMA) -
            dot(difference, difference) / (2.0 * RANGE_SIGMA * RANGE_SIGMA)
        );
        sum += texture(u_mask, uv).r * weight;
        weights += weight;
      }
    }
    fragColor = vec4(vec3(sum / weights), 1.0);
  }
`;

export function createEdgeRefinementProgram(gl: WebGL2RenderingContext, radius: number) {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource(false));
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, edgeRefinementFragmentShader(radius));
  const program = createProgram(gl, vertexShader, fragmentShader);

  return {
    program,
    uniforms: {
      position: gl.getAttribLocation(program, 'position'),
      mask: gl.getUniformLocation(program, 'u_mask'),
      frame: gl.getUniformLocation(program, 'u_frame'),
    },
  };
}
