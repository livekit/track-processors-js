import { createProgram, createShader, glsl } from '../utils';
import { vertexShaderSource } from './vertexShader';

/**
 * Dilation / erosion shader for adjusting the person mask boundary.
 *
 * In the confidence mask, person pixels have HIGH values and background
 * pixels have LOW values.
 *
 *   radius > 0  →  max-filter (dilation): expands person region
 *   radius < 0  →  min-filter (erosion):  shrinks person region
 *
 * Positive dilation compensates for:
 *   - mask erosion caused by the subsequent blur pass
 *   - the one-frame lag between segmentation and compositing
 *   - imprecise segmenter output at thin features (neck, fingers)
 *
 * Negative dilation (erosion) tightens the mask boundary, useful when
 * the segmenter over-estimates the person region and background bleeds
 * through at edges.
 *
 * Implemented as a separable two-pass filter (horizontal then vertical)
 * for O(n) cost per pixel instead of O(n²).
 */
export const dilationFragmentShader = glsl`#version 300 es
precision mediump float;

in vec2 texCoords;

uniform sampler2D u_texture;
uniform vec2 u_texelSize;    // 1.0 / texture dimensions
uniform vec2 u_direction;    // (1,0) for horizontal, (0,1) for vertical
uniform float u_radius;      // dilation radius in texels (always positive)
uniform float u_erode;       // 0.0 = dilate (max-filter), 1.0 = erode (min-filter)

out vec4 fragColor;

void main() {
    const int MAX_RADIUS = 16;
    int radius = int(min(float(MAX_RADIUS), u_radius));

    // Start with the worst-case seed for max or min filter
    float result = u_erode > 0.5 ? 1.0 : 0.0;

    for (int i = -16; i <= 16; ++i) {
        if (abs(i) > radius) continue;

        vec2 offset = u_direction * u_texelSize * float(i);
        float texVal = texture(u_texture, texCoords + offset).r;

        // max-filter expands person (HIGH), min-filter shrinks person
        result = u_erode > 0.5 ? min(result, texVal) : max(result, texVal);
    }

    fragColor = vec4(result, result, result, 1.0);
}
`;

/**
 * Create the dilation shader program
 */
export function createDilationProgram(gl: WebGL2RenderingContext) {
  // Use non-flipping vertex shader for intermediate mask passes.
  // The composite shader handles the final Y-flip.
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource(false));
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, dilationFragmentShader);

  const program = createProgram(gl, vertexShader, fragmentShader);

  const uniforms = {
    position: gl.getAttribLocation(program, 'position'),
    texture: gl.getUniformLocation(program, 'u_texture'),
    texelSize: gl.getUniformLocation(program, 'u_texelSize'),
    direction: gl.getUniformLocation(program, 'u_direction'),
    radius: gl.getUniformLocation(program, 'u_radius'),
    erode: gl.getUniformLocation(program, 'u_erode'),
  };

  return {
    program,
    vertexShader,
    fragmentShader,
    uniforms,
  };
}

/**
 * Apply a separable two-pass max/min-filter to expand or shrink the person mask.
 *
 * @param gl            WebGL2 context
 * @param sourceTexture Input mask texture
 * @param width         Texture width
 * @param height        Texture height
 * @param radius        Signed radius: positive = dilate, negative = erode
 * @param program       Dilation shader program
 * @param uniforms      Dilation shader uniform locations
 * @param vertexBuffer  Full-screen quad vertex buffer
 * @param framebuffers  Two framebuffers for ping-pong rendering
 * @param textures      Two textures matching the framebuffers
 * @returns             The processed mask texture (textures[1])
 */
export function applyDilation(
  gl: WebGL2RenderingContext,
  sourceTexture: WebGLTexture,
  width: number,
  height: number,
  radius: number,
  program: WebGLProgram,
  uniforms: any,
  vertexBuffer: WebGLBuffer,
  framebuffers: WebGLFramebuffer[],
  textures: WebGLTexture[],
): WebGLTexture {
  gl.useProgram(program);

  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.vertexAttribPointer(uniforms.position, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(uniforms.position);

  const texelWidth = 1.0 / width;
  const texelHeight = 1.0 / height;
  const erode = radius < 0 ? 1.0 : 0.0;
  const absRadius = Math.abs(radius);

  // Pass 1 — horizontal filter
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[0]);
  gl.viewport(0, 0, width, height);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
  gl.uniform1i(uniforms.texture, 0);
  gl.uniform2f(uniforms.texelSize, texelWidth, texelHeight);
  gl.uniform2f(uniforms.direction, 1.0, 0.0);
  gl.uniform1f(uniforms.radius, absRadius);
  gl.uniform1f(uniforms.erode, erode);

  gl.drawArrays(gl.TRIANGLES, 0, 6);

  // Pass 2 — vertical filter
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[1]);
  gl.viewport(0, 0, width, height);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, textures[0]);
  gl.uniform1i(uniforms.texture, 0);
  gl.uniform2f(uniforms.direction, 0.0, 1.0);

  gl.drawArrays(gl.TRIANGLES, 0, 6);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  return textures[1];
}
