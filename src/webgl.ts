import { FilesetResolver, ImageSegmenter, ImageSegmenterResult } from '@mediapipe/tasks-vision';

let videoTexture: WebGLTexture, bgTexture: WebGLTexture;

let bgImage = 'https://videos.electroteque.org/textures/virtualbg.jpg';

function initBkgnd(
  gl: WebGL2RenderingContext,
  bgImage: string,
  bgTextureLocation: WebGLUniformLocation,
) {
  bgTexture = initTexture(gl, 0);
  gl.uniform1i(bgTextureLocation, 0);

  if (bgImage) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, bgTexture);
      //resizeForTexture(img, img.width, img.height);
      console.log('FILL BACKGROUND');
      fillBackgroundImage(gl, img);
    };
    img.src = bgImage;
  } else {
    // Fill with black background
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
}

function fillBackgroundImage(gl: WebGL2RenderingContext, img: HTMLImageElement) {
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  // gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
}

const createShaderProgram = (gl: WebGL2RenderingContext) => {
  const vs = `
    attribute vec2 position;
    varying vec2 texCoords;
  
    void main() {
      texCoords = (position + 1.0) / 2.0;
      texCoords.y = 1.0 - texCoords.y;
      gl_Position = vec4(position, 0, 1.0);
    }
  `;

  const fs = `
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

      gl_FragColor = mix(bgTex, vec4(frameTex.rgb, 1.0), a);
      //gl_FragColor = mix(bgTex, vec4(frameTex.rgb, 1.0), 1.0 - a);
    
    }
  `;

  const vertexShader = gl.createShader(gl.VERTEX_SHADER);
  if (!vertexShader) {
    throw Error('can not create vertex shader');
  }
  gl.shaderSource(vertexShader, vs);
  gl.compileShader(vertexShader);

  // Create our fragment shader
  const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
  if (!fragmentShader) {
    throw Error('can not create fragment shader');
  }
  gl.shaderSource(fragmentShader, fs);
  gl.compileShader(fragmentShader);

  // Create our program
  const program = gl.createProgram();
  if (!program) {
    throw Error('can not create program');
  }
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  //bgTexture = initTexture(gl, 0);
  initBkgnd(gl, bgImage, gl.getUniformLocation(program, 'background')!);
  videoTexture = initTexture(gl, 1);

  return {
    vertexShader,
    fragmentShader,
    shaderProgram: program,
    attribLocations: {
      position: gl.getAttribLocation(program, 'position'),
    },
    uniformLocations: {
      mask: gl.getUniformLocation(program, 'mask')!,
      frame: gl.getUniformLocation(program, 'frame')!,
      background: gl.getUniformLocation(program, 'background')!,
    },
  };
};

const createVertexBuffer = (gl: WebGL2RenderingContext) => {
  if (!gl) {
    return null;
  }
  const vertexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, -1, 1, 1, 1, -1, -1, 1, 1, 1, -1]),
    gl.STATIC_DRAW,
  );
  return vertexBuffer;
};

function initTexture(gl: WebGL2RenderingContext, texIndex: number) {
  const texRef = gl.TEXTURE0 + texIndex;
  gl.activeTexture(gl.TEXTURE0 + texIndex);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  //gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  gl.bindTexture(gl.TEXTURE_2D, texture);

  return texture;
}

function createCopyTextureToCanvas(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: false }) as WebGL2RenderingContext;

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  if (!gl) {
    return undefined;
  }
  const {
    shaderProgram,
    attribLocations: { position: positionLocation },
    uniformLocations: {
      mask: maskTextureLocation,
      frame: frameTextureLocation,
      background: bgTextureLocation,
    },
  } = createShaderProgram(gl);
  const vertexBuffer = createVertexBuffer(gl);

  gl.uniform1i(bgTextureLocation, 0);
  gl.uniform1i(frameTextureLocation, 1);
  gl.uniform1i(maskTextureLocation, 2);

  return (mask: { getAsWebGLTexture: () => WebGLTexture }) => {
    //gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clearColor(1.0, 1.0, 1.0, 1.0);
    gl.useProgram(shaderProgram);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.viewport(0, 0, video.videoWidth, video.videoHeight);
    //gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

    const texture = mask.getAsWebGLTexture();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(positionLocation);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, bgTexture);
    //gl.uniform1i(bgTextureLocation, 0)

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(maskTextureLocation, 2);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, videoTexture);
    gl.uniform1i(frameTextureLocation, 1);

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    return createImageBitmap(canvas);
  };
}

const tasksCanvas = new OffscreenCanvas(1, 1);
const createImageSegmenter = async () => {
  const audio = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm',
  );

  imageSegmenter = await ImageSegmenter.createFromOptions(audio, {
    baseOptions: {
      modelAssetPath:
        //"https://storage.googleapis.com/mediapipe-models/image_segmenter/deeplab_v3/float32/latest/deeplab_v3.tflite",
        'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/latest/selfie_segmenter_landscape.tflite',
      delegate: 'GPU',
    },
    canvas: tasksCanvas,
    runningMode: 'VIDEO',
    outputConfidenceMasks: true,
  });
};
createImageSegmenter();
