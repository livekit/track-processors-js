export type StreamTransformerInitOptions = {
  outputCanvas?: OffscreenCanvas | HTMLCanvasElement;
  inputVideo: HTMLVideoElement;
};
export interface StreamTransformer {
  init: ({ outputCanvas, inputVideo }: StreamTransformerInitOptions) => void;
  destroy: () => void;
  transform: (
    frame: VideoFrame,
    controller: TransformStreamDefaultController
  ) => void;
  transformer: TransformStream;
}
