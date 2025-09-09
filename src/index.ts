import ProcessorWrapper, { ProcessorWrapperOptions } from './ProcessorWrapper';
import BackgroundTransformer, {
  BackgroundOptions,
  FrameProcessingStats,
  SegmenterOptions,
} from './transformers/BackgroundTransformer';

export * from './transformers/types';
export { default as VideoTransformer } from './transformers/VideoTransformer';
export {
  ProcessorWrapper,
  type BackgroundOptions,
  type SegmenterOptions,
  BackgroundTransformer,
  type ProcessorWrapperOptions,
};

/**
 * Determines if the current browser supports background processors
 */
export const supportsBackgroundProcessors = () =>
  BackgroundTransformer.isSupported && ProcessorWrapper.isSupported;

/**
 * Determines if the current browser supports modern background processors, which yield better performance
 */
export const supportsModernBackgroundProcessors = () =>
  BackgroundTransformer.isSupported && ProcessorWrapper.hasModernApiSupport;

export interface BackgroundProcessorOptions extends ProcessorWrapperOptions {
  blurRadius?: number;
  imagePath?: string;
  segmenterOptions?: SegmenterOptions;
  assetPaths?: { tasksVisionFileSet?: string; modelAssetPath?: string };
  onFrameProcessed?: (stats: FrameProcessingStats) => void;
}

/**
 * Instantiates a background processor that is configured in blur mode.
 * @deprecated Use `BackgroundProcessorManager.withBackgroundBlur` instead.
 */
export const BackgroundBlur = (
  blurRadius: number = 10,
  segmenterOptions?: SegmenterOptions,
  onFrameProcessed?: (stats: FrameProcessingStats) => void,
  processorOptions?: ProcessorWrapperOptions,
) => {
  const processor = BackgroundProcessorManager.withBackgroundBlur(
    blurRadius,
    segmenterOptions,
    onFrameProcessed,
    processorOptions,
  );
  processor.name = 'background-blur';
  return processor;
};

/**
 * Instantiates a background processor that is configured in virtual background mode.
 * @deprecated Use `BackgroundProcessorManager.withVirtualBackground` instead.
 */
export const VirtualBackground = (
  imagePath: string,
  segmenterOptions?: SegmenterOptions,
  onFrameProcessed?: (stats: FrameProcessingStats) => void,
  processorOptions?: ProcessorWrapperOptions,
) => {
  const processor = BackgroundProcessorManager.withVirtualBackground(
    imagePath,
    segmenterOptions,
    onFrameProcessed,
    processorOptions,
  );
  processor.name = 'virtual-background';
  return processor;
};

/**
 * Instantiates a background processor that is configured with raw underlying options.
 * @deprecated Use `BackgroundProcessorManager.withOptions` instead.
 */
export const BackgroundProcessor = (
  options: BackgroundProcessorOptions,
  name = 'background-processor',
) => {
  return BackgroundProcessorManager.withOptions(options, name);
};

/**
 * A preconfigured background processor that supports blurring the background of a user's local
 * video, or replacing the user's background with a virtual background image, and switching the
 * active mode later on the fly to avoid visual artifacts.
 *
 * @example
 * const camTrack = currentRoom.localParticipant.getTrackPublication(Track.Source.Camera)!.track as LocalVideoTrack;
 * camTrack.setProcessor(BackgroundProcessorManager.withBackgroundBlur());
 */
export class BackgroundProcessorManager extends ProcessorWrapper<BackgroundOptions> {
  static withOptions(options: BackgroundProcessorOptions, name = 'background-processor') {
    const isTransformerSupported = BackgroundTransformer.isSupported;
    const isProcessorSupported = ProcessorWrapper.isSupported;

    if (!isTransformerSupported) {
      throw new Error('Background transformer is not supported in this browser');
    }

    if (!isProcessorSupported) {
      throw new Error(
        'Neither MediaStreamTrackProcessor nor canvas.captureStream() fallback is supported in this browser',
      );
    }

    // Extract transformer-specific options and processor options
    const {
      blurRadius,
      imagePath,
      segmenterOptions,
      assetPaths,
      onFrameProcessed,
      ...processorOpts
    } = options;

    const transformer = new BackgroundTransformer({
      blurRadius,
      imagePath,
      segmenterOptions,
      assetPaths,
      onFrameProcessed,
    });

    const instance = new this(transformer, name, processorOpts);
    return instance;
  }

  /**
   * Creates a preconfigured background processor which blurs a user's background. To switch
   * modes, see `switchToVirtualBackground`.
   */
  static withBackgroundBlur(
    blurRadius: number = 10,
    segmenterOptions?: SegmenterOptions,
    onFrameProcessed?: (stats: FrameProcessingStats) => void,
    processorOptions?: ProcessorWrapperOptions,
  ) {
    return this.withOptions({
      blurRadius,
      segmenterOptions,
      onFrameProcessed,
      ...processorOptions,
    });
  }

  /**
   * Creates a preconfigured background processor which replaces a user's background with a virtual
   * image. To switch modes, see `switchToVirtualBackground`.
   */
  static withVirtualBackground(
    imagePath: string,
    segmenterOptions?: SegmenterOptions,
    onFrameProcessed?: (stats: FrameProcessingStats) => void,
    processorOptions?: ProcessorWrapperOptions,
  ) {
    return this.withOptions({
      imagePath,
      segmenterOptions,
      onFrameProcessed,
      ...processorOptions,
    });
  }

  async switchToBackgroundBlur(blurRadius: number = 10) {
    await this.updateTransformerOptions({
      imagePath: undefined,
      blurRadius,
    });
  }

  async switchToVirtualBackground(imagePath: string) {
    await this.updateTransformerOptions({
      imagePath,
      blurRadius: undefined,
    });
  }
}
