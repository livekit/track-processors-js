import { describe, expect, it, vi } from 'vitest';
import BackgroundTransformer from '../src/transformers/BackgroundTransformer';

describe('BackgroundTransformer lifecycle', () => {
  it('drops the first frame when destroyed while waiting for it to render', async () => {
    const processor = new BackgroundTransformer({ blurRadius: 10 });
    const canvas = new OffscreenCanvas(2, 2);
    canvas.getContext('2d')!.fillRect(0, 0, 2, 2);
    const frame = new VideoFrame(canvas, { timestamp: 0 });
    const video = document.createElement('video');
    let renderFrame!: VideoFrameRequestCallback;
    vi.spyOn(video, 'requestVideoFrameCallback').mockImplementation((callback) => {
      renderFrame = callback;
      return 1;
    });
    const segmentForVideo = vi.fn(() => {
      throw new Error('segmenter is closed');
    });
    const close = vi.fn();
    processor.imageSegmenter = { close, segmentForVideo } as unknown as NonNullable<
      typeof processor.imageSegmenter
    >;
    processor.canvas = canvas;
    processor.inputVideo = video;
    const enqueued: VideoFrame[] = [];
    const controller = {
      enqueue: (output: VideoFrame) => enqueued.push(output),
    } as TransformStreamDefaultController<VideoFrame>;

    try {
      const transforming = processor.transform(frame, controller);
      expect(enqueued).toHaveLength(1);
      await processor.destroy();
      renderFrame(0, { expectedDisplayTime: 0, presentationTime: 0 } as VideoFrameCallbackMetadata);
      await transforming;

      expect(close).toHaveBeenCalledTimes(1);
      expect(segmentForVideo).not.toHaveBeenCalled();
      expect(processor.imageSegmenter).toBeUndefined();
      expect(frame.codedWidth).toBe(0);
      expect(enqueued).toHaveLength(1);
    } finally {
      frame.close();
      enqueued.forEach((output) => output.close());
    }
  });
});
