import { glsl } from '../utils';
import { vertexShaderSource } from './vertexShader';

export const boxBlurFragmentShader = glsl`#version 300 es
precision mediump float;

in vec2 texCoords;

uniform sampler2D u_texture;
uniform vec2 u_texelSize;    // 1.0 / texture size
uniform vec2 u_direction;    // (1.0, 0.0) for horizontal, (0.0, 1.0) for vertical
uniform float u_radius;      // blur radius in texels

out vec4 fragColor;

void main() {
    vec3 sum = vec3(0.0);
    float count = 0.0;

    // Limit radius to avoid excessive loop cost
    const int MAX_RADIUS = 16;
    int radius = int(min(float(MAX_RADIUS), u_radius));

    for (int i = -MAX_RADIUS; i <= MAX_RADIUS; ++i) {
        if (abs(i) > radius) continue;

        vec2 offset = u_direction * u_texelSize * float(i);
        sum += texture(u_texture, texCoords + offset).rgb;
        count += 1.0;
  }

  fragColor = vec4(sum / count, 1.0);
}
`;

/**
 * Create the box blur shader program
 */
export function createBoxBlurProgram(gl: WebGL2RenderingContext) {
  // Create vertex shader
  const vertexShader = gl.createShader(gl.VERTEX_SHADER);
  if (!vertexShader) {
    throw Error('cannot create vertex shader');
  }
  gl.shaderSource(vertexShader, vertexShaderSource());
  gl.compileShader(vertexShader);

  // Check vertex shader compilation
  if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(vertexShader);
    throw Error(`Failed to compile vertex shader: ${info}`);
  }

  // Create fragment shader
  const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
  if (!fragmentShader) {
    throw Error('cannot create fragment shader');
  }
  gl.shaderSource(fragmentShader, boxBlurFragmentShader);
  gl.compileShader(fragmentShader);

  // Check fragment shader compilation
  if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(fragmentShader);
    throw Error(`Failed to compile box blur shader: ${info}`);
  }

  // Create the program
  const program = gl.createProgram();
  if (!program) {
    throw Error('cannot create box blur program');
  }
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  // Check program link status
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program);
    throw Error(`Failed to link box blur program: ${info}`);
  }

  // Get attribute and uniform locations
  const uniforms = {
    position: gl.getAttribLocation(program, 'position'),
    texture: gl.getUniformLocation(program, 'u_texture'),
    texelSize: gl.getUniformLocation(program, 'u_texelSize'),
    direction: gl.getUniformLocation(program, 'u_direction'),
    radius: gl.getUniformLocation(program, 'u_radius'),
  };

  return {
    program,
    vertexShader,
    fragmentShader,
    uniforms,
  };
}
