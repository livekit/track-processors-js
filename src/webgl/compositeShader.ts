import { vertexShaderSource } from './vertexShader';

// Fragment shader source for compositing
export const compositeFragmentShader = `
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

    gl_FragColor = mix(bgTex, vec4(frameTex.rgb, 1.0), 1.0 - a);
  
  }
`;

/**
 * Create the composite shader program
 */
export function createCompositeProgram(gl: WebGL2RenderingContext) {
  // Create vertex shader
  const vertexShader = gl.createShader(gl.VERTEX_SHADER);
  if (!vertexShader) {
    throw Error('cannot create vertex shader');
  }
  gl.shaderSource(vertexShader, vertexShaderSource);
  gl.compileShader(vertexShader);

  // Check vertex shader compilation
  if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(vertexShader);
    throw Error(`Failed to compile vertex shader: ${info}`);
  }

  // Create fragment shader
  const compositeShader = gl.createShader(gl.FRAGMENT_SHADER);
  if (!compositeShader) {
    throw Error('cannot create fragment shader');
  }
  gl.shaderSource(compositeShader, compositeFragmentShader);
  gl.compileShader(compositeShader);

  // Check fragment shader compilation
  if (!gl.getShaderParameter(compositeShader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(compositeShader);
    throw Error(`Failed to compile composite shader: ${info}`);
  }

  // Create the program
  const compositeProgram = gl.createProgram();
  if (!compositeProgram) {
    throw Error('cannot create composite program');
  }
  gl.attachShader(compositeProgram, vertexShader);
  gl.attachShader(compositeProgram, compositeShader);
  gl.linkProgram(compositeProgram);

  // Check program link status
  if (!gl.getProgramParameter(compositeProgram, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(compositeProgram);
    throw Error(`Failed to link composite program: ${info}`);
  }

  // Get attribute and uniform locations
  const attribLocations = {
    position: gl.getAttribLocation(compositeProgram, 'position'),
  };

  const uniformLocations = {
    mask: gl.getUniformLocation(compositeProgram, 'mask')!,
    frame: gl.getUniformLocation(compositeProgram, 'frame')!,
    background: gl.getUniformLocation(compositeProgram, 'background')!,
  };

  return {
    program: compositeProgram,
    vertexShader,
    fragmentShader: compositeShader,
    attribLocations,
    uniformLocations,
  };
}
