import type { ProcessorOptions, VideoProcessor } from 'livekit-client';
import BackgroundProcessor from './BackgroundProcessor';

export default class ProcessorPipeline implements VideoProcessor<ProcessorOptions> {
  source?: MediaStreamVideoTrack;

  sourceSettings?: MediaTrackSettings;

  processor?: MediaStreamTrackProcessor<VideoFrame>;

  trackGenerator?: MediaStreamTrackGenerator<VideoFrame>;

  canvas?: OffscreenCanvas;

  sourceDummy?: HTMLVideoElement;

  processedTrack?: MediaStreamTrack;

  transformers: Array<BackgroundProcessor>;

  constructor(transformers: Array<BackgroundProcessor>) {
    this.transformers = transformers;
  }

  init(opts: ProcessorOptions) {
    this.source = opts.track as MediaStreamVideoTrack;
    this.sourceSettings = this.source.getSettings();
    this.sourceDummy = opts.element;
    // TODO explore if we can do all the processing work in a webworker
    this.processor = new MediaStreamTrackProcessor({ track: this.source });
    this.trackGenerator = new MediaStreamTrackGenerator({ kind: 'video' });

    this.canvas = new OffscreenCanvas(this.sourceSettings.width!, this.sourceSettings.height!);

    // this.processor.readable.pipeThrough(this.transformer).pipeTo(this.trackGenerator.writable);
    let readableStream = this.processor.readable;
    for (const transformer of this.transformers) {
      transformer.init(this.canvas, this.sourceDummy!);
      readableStream = readableStream.pipeThrough(transformer.transformer);
    }
    readableStream.pipeTo(this.trackGenerator.writable);
    this.processedTrack = this.trackGenerator as MediaStreamVideoTrack;
  }

  destroy() {
    // TODO
  }
}
