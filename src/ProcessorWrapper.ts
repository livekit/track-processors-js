import type { ProcessorOptions, Track, TrackProcessor } from 'livekit-client';
import { TrackTransformer } from './transformers';

export default class ProcessorWrapper<TransformerOptions extends Record<string, unknown>>
  implements TrackProcessor<Track.Kind>
{
  static get isSupported() {
    return (
      typeof MediaStreamTrackGenerator !== 'undefined' &&
      typeof MediaStreamTrackProcessor !== 'undefined'
    );
  }

  name: string;

  source?: MediaStreamVideoTrack;

  sourceSettings?: MediaTrackSettings;

  processor?: MediaStreamTrackProcessor<VideoFrame>;

  trackGenerator?: MediaStreamTrackGenerator<VideoFrame>;

  canvas?: OffscreenCanvas;

  sourceDummy?: HTMLMediaElement;

  processedTrack?: MediaStreamTrack;

  transformer: TrackTransformer<TransformerOptions>;

  constructor(transformer: TrackTransformer<TransformerOptions>, name: string) {
    this.name = name;
    this.transformer = transformer;
    this.transformer.restart;
  }

  private async setup(opts: ProcessorOptions<Track.Kind>) {
    this.source = opts.track as MediaStreamVideoTrack;
    const origConstraints = this.source.getConstraints();
    await this.source.applyConstraints({
      ...origConstraints,
      // @ts-expect-error when a mediastream track is resized and/or cropped, the `VideoFrame` will have a coded height/width of the original video size
      // this leads to a shift of the underlying video as the frame itself is being rendered with the coded size
      // but image segmentation is based on the display dimensions (-> the cropped version)
      // in order to prevent this, we force the resize mode to "none"
      resizeMode: 'none',
    });
    this.sourceSettings = this.source.getSettings();
    this.sourceDummy = opts.element;
    if (this.sourceDummy instanceof HTMLVideoElement) {
      this.sourceDummy.height = this.sourceSettings.height ?? 300;
      this.sourceDummy.width = this.sourceSettings.width ?? 300;
    }
    if (!(this.sourceDummy instanceof HTMLVideoElement)) {
      throw TypeError('Currently only video transformers are supported');
    }
    // TODO explore if we can do all the processing work in a webworker
    this.processor = new MediaStreamTrackProcessor({ track: this.source });

    this.trackGenerator = new MediaStreamTrackGenerator({
      kind: 'video',
      signalTarget: this.source,
    });

    this.canvas = new OffscreenCanvas(
      this.sourceSettings.width ?? 300,
      this.sourceSettings.height ?? 300,
    );
  }

  async init(opts: ProcessorOptions<Track.Kind>) {
    await this.setup(opts);
    if (!this.canvas || !this.processor || !this.trackGenerator) {
      throw new TypeError('Expected both canvas and processor to be defined after setup');
    }

    let readableStream = this.processor.readable;

    await this.transformer.init({
      outputCanvas: this.canvas,
      inputElement: this.sourceDummy as HTMLVideoElement,
    });
    readableStream = readableStream.pipeThrough(this.transformer!.transformer!);

    readableStream
      .pipeTo(this.trackGenerator.writable)
      .catch((e) => console.error('error when trying to pipe', e))
      .finally(() => this.destroy());
    this.processedTrack = this.trackGenerator as MediaStreamVideoTrack;
  }

  async restart(opts: ProcessorOptions<Track.Kind>) {
    await this.destroy();
    return this.init(opts);
  }

  async restartTransformer(...options: Parameters<(typeof this.transformer)['restart']>) {
    // @ts-ignore unclear why the restart method only accepts VideoTransformerInitOptions instead of either those or AudioTransformerInitOptions
    this.transformer.restart(options[0]);
  }

  async updateTransformerOptions(...options: Parameters<(typeof this.transformer)['update']>) {
    this.transformer.update(options[0]);
  }

  async destroy() {
    await this.transformer.destroy();
    this.trackGenerator?.stop();
  }
}
