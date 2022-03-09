import VideoTransformer from './VideoTransformer';

export default class DummyTransformer extends VideoTransformer {
  async transform(frame: VideoFrame, controller: TransformStreamDefaultController<VideoFrame>) {
    controller.enqueue(frame);
  }

  async destroy() {
    // nothing to do
  }
}
