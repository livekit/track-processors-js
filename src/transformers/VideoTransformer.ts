import { createCanvas } from '../utils';
import { setupWebGL } from '../webgl/index';
import { VideoTrackTransformer, VideoTransformerInitOptions } from './types';

export default abstract class VideoTransformer<Options extends Record<string, unknown>>
  implements VideoTrackTransformer<Options>
{
  transformer?: TransformStream;

  canvas?: OffscreenCanvas | HTMLCanvasElement;

  // ctx?: OffscreenCanvasRenderingContext2D;

  inputVideo?: HTMLVideoElement;

  gl?: ReturnType<typeof setupWebGL>;

  protected isDisabled?: Boolean = false;

  async init({
    outputCanvas,
    inputElement: inputVideo,
  }: VideoTransformerInitOptions): Promise<void> {
    if (!(inputVideo instanceof HTMLVideoElement)) {
      throw TypeError('Video transformer needs a HTMLVideoElement as input');
    }

    this.transformer = new TransformStream({
      transform: (frame, controller) => this.transform(frame, controller),
    });
    this.canvas = outputCanvas || null;
    if (outputCanvas) {
      // this.ctx = this.canvas?.getContext('2d') || undefined;
      this.gl = setupWebGL(
        this.canvas || createCanvas(inputVideo.videoWidth, inputVideo.videoHeight),
      );
    }
    this.inputVideo = inputVideo;
    this.isDisabled = false;
  }

  async restart({ outputCanvas, inputElement: inputVideo }: VideoTransformerInitOptions) {
    this.canvas = outputCanvas || null;
    this.gl?.cleanup();
    this.gl = setupWebGL(
      this.canvas || createCanvas(inputVideo.videoWidth, inputVideo.videoHeight),
    );

    this.inputVideo = inputVideo;
    this.isDisabled = false;
  }

  async destroy() {
    this.isDisabled = true;
    this.canvas = undefined;
    this.gl?.cleanup();
    this.gl = undefined;
  }

  abstract transform(
    frame: VideoFrame,
    controller: TransformStreamDefaultController<VideoFrame>,
  ): void;

  abstract update(options: Options): void;
}
