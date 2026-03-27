import { createProgram, createShader, glsl } from '../utils';
import { vertexShaderSource } from './vertexShader';

// Fragment shader source for compositing
export const compositeFragmentShader = glsl`#version 300 es
  precision mediump float;
  in vec2 texCoords;
  uniform sampler2D background;
  uniform bool disableBackground;
  uniform sampler2D frame;
  uniform sampler2D mask;
  uniform float u_threshold;
  uniform float u_edgeSoftness;
  out vec4 fragColor;

  void main() {
    vec4 frameTex = texture(frame, texCoords);

    if (disableBackground) {
      fragColor = frameTex;
    } else {
      vec4 bgTex = texture(background, texCoords);

      // Confidence mask: HIGH = person, LOW = background
      float maskVal = texture(mask, texCoords).r;

      float alpha;
      if (u_edgeSoftness <= 0.01) {
        // Direct confidence mode: remap [threshold..1] to [0..1] linearly
        // This preserves the natural softness from the confidence mask itself
        float range = max(1.0 - u_threshold, 0.001);
        alpha = clamp((maskVal - u_threshold) / range, 0.0, 1.0);
        // Apply a slight power curve to sharpen edges without hard cutoff
        alpha = alpha * alpha * (3.0 - 2.0 * alpha); // smootherstep-style S-curve
      } else {
        // Legacy gradient-based mode (used when edgeSoftness > 0)
        float grad = length(vec2(dFdx(maskVal), dFdy(maskVal)));
        alpha = smoothstep(u_threshold - grad * u_edgeSoftness, u_threshold + grad * u_edgeSoftness, maskVal);
      }

      // Blend: alpha=1 -> show person (frame), alpha=0 -> show background
      vec4 blended = mix(bgTex, vec4(frameTex.rgb, 1.0), alpha);
      fragColor = blended;
    }

  }
`;

/**
 * Create the composite shader program
 */
export function createCompositeProgram(gl: WebGL2RenderingContext) {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource());
  const compositeShader = createShader(gl, gl.FRAGMENT_SHADER, compositeFragmentShader);

  const compositeProgram = createProgram(gl, vertexShader, compositeShader);

  // Get attribute and uniform locations
  const attribLocations = {
    position: gl.getAttribLocation(compositeProgram, 'position'),
  };

  const uniformLocations = {
    mask: gl.getUniformLocation(compositeProgram, 'mask')!,
    frame: gl.getUniformLocation(compositeProgram, 'frame')!,
    background: gl.getUniformLocation(compositeProgram, 'background')!,
    disableBackground: gl.getUniformLocation(compositeProgram, 'disableBackground')!,
    threshold: gl.getUniformLocation(compositeProgram, 'u_threshold')!,
    edgeSoftness: gl.getUniformLocation(compositeProgram, 'u_edgeSoftness')!,
  };

  return {
    program: compositeProgram,
    vertexShader,
    fragmentShader: compositeShader,
    attribLocations,
    uniformLocations,
  };
}
