export type StreamTransformerInitOptions = {
  outputCanvas: OffscreenCanvas;
  inputVideo: HTMLVideoElement;
};

export interface StreamTransformer {
  init: (options: StreamTransformerInitOptions) => void;
  destroy: () => void;
  transform: (frame: VideoFrame, controller: TransformStreamDefaultController) => void;
  transformer?: TransformStream;
}
