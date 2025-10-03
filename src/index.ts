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
export * from './logger';

const DEFAULT_BLUR_RADIUS = 10;

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

type BackgroundProcessorCommonOptions = ProcessorWrapperOptions & {
  segmenterOptions?: SegmenterOptions;
  assetPaths?: { tasksVisionFileSet?: string; modelAssetPath?: string };
  onFrameProcessed?: (stats: FrameProcessingStats) => void;
};

type BackgroundProcessorBackgroundBlurOptions = BackgroundProcessorCommonOptions & {
  mode: 'background-blur';
  blurRadius: number;
};

type BackgroundProcessorVirtualBackgroundOptions = BackgroundProcessorCommonOptions & {
  mode: 'virtual-background';
  imagePath: string;
};

type BackgroundProcessorDisabledOptions = BackgroundProcessorCommonOptions & {
  mode: 'disabled';
};

type BackgroundProcessorLegacyOptions = BackgroundProcessorCommonOptions & {
  mode?: never;
  blurRadius?: number;
  imagePath?: string;
};

export type BackgroundProcessorOptions =
| BackgroundProcessorDisabledOptions
| BackgroundProcessorBackgroundBlurOptions
| BackgroundProcessorVirtualBackgroundOptions
| BackgroundProcessorLegacyOptions;

class BackgroundProcessorWrapper extends ProcessorWrapper<BackgroundOptions> {
  async switchToBackgroundBlur(blurRadius: number = DEFAULT_BLUR_RADIUS) {
    await this.updateTransformerOptions({ imagePath: undefined, blurRadius, backgroundDisabled: false });
  }

  async switchToVirtualBackground(imagePath: string) {
    await this.updateTransformerOptions({ imagePath, blurRadius: undefined, backgroundDisabled: false });
  }

  async switchToDisabled() {
    await this.updateTransformerOptions({ imagePath: undefined, backgroundDisabled: true });
  }
}

/**
 * Instantiates a background processor that supports blurring the background of a user's local
 * video or replacing the user's background with a virtual background image, and supports switching
 * the active mode later on the fly to avoid visual artifacts.
 *
 * @example
 * const camTrack = currentRoom.localParticipant.getTrackPublication(Track.Source.Camera)!.track as LocalVideoTrack;
 * const processor = BackgroundProcessor({ mode: 'background-blur', blurRadius: 10 });
 * camTrack.setProcessor(processor);
 *
 * // Change to background image:
 * processor.switchToVirtualBackground('path/to/image.png');
 * // Change back to background blur:
 * processor.switchToBackgroundBlur(10);
 */
export const BackgroundProcessor = (
  options: BackgroundProcessorOptions,
  name = 'background-processor',
) => {
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
  let transformer, processorOpts;
  switch (options.mode) {
    case 'background-blur': {
      const {
        // eslint-disable-next-line no-unused-vars
        mode,
        blurRadius,
        segmenterOptions,
        assetPaths,
        onFrameProcessed,
        ...rest
      } = options;

      processorOpts = rest;
      transformer = new BackgroundTransformer({
        blurRadius,
        segmenterOptions,
        assetPaths,
        onFrameProcessed,
      });
      break;
    }

    case 'virtual-background': {
      const {
        // eslint-disable-next-line no-unused-vars
        mode,
        imagePath,
        segmenterOptions,
        assetPaths,
        onFrameProcessed,
        ...rest
      } = options;

      processorOpts = rest;
      transformer = new BackgroundTransformer({
        imagePath,
        segmenterOptions,
        assetPaths,
        onFrameProcessed,
      });
      break;
    }

    case 'disabled': {
      const {
        segmenterOptions,
        assetPaths,
        onFrameProcessed,
        ...rest
      } = options;

      processorOpts = rest;
      transformer = new BackgroundTransformer({
        segmenterOptions,
        assetPaths,
        onFrameProcessed,
      });
      break;
    }

    default: {
      const {
        blurRadius,
        imagePath,
        segmenterOptions,
        assetPaths,
        onFrameProcessed,
        ...rest
      } = options;

      processorOpts = rest;
      transformer = new BackgroundTransformer({
        blurRadius,
        imagePath,
        segmenterOptions,
        assetPaths,
        onFrameProcessed,
      });
      break;
    }
  }

  const processor = new BackgroundProcessorWrapper(transformer, name, processorOpts);

  return processor;
};

/**
 * Instantiates a background processor that is configured in blur mode.
 * @deprecated Use `BackgroundProcessor({ mode: 'background-blur', blurRadius: 10,  ... })` instead.
 */
export const BackgroundBlur = (
  blurRadius: number = DEFAULT_BLUR_RADIUS,
  segmenterOptions?: SegmenterOptions,
  onFrameProcessed?: (stats: FrameProcessingStats) => void,
  processorOptions?: ProcessorWrapperOptions,
) => {
  return BackgroundProcessor(
    {
      blurRadius,
      segmenterOptions,
      onFrameProcessed,
      ...processorOptions,
    },
    'background-blur',
  );
};

/**
 * Instantiates a background processor that is configured in virtual background mode.
 * @deprecated Use `BackgroundProcessor({ mode: 'virtual-background', imagePath: '...', ... })` instead.
 */
export const VirtualBackground = (
  imagePath: string,
  segmenterOptions?: SegmenterOptions,
  onFrameProcessed?: (stats: FrameProcessingStats) => void,
  processorOptions?: ProcessorWrapperOptions,
) => {
  return BackgroundProcessor(
    {
      imagePath,
      segmenterOptions,
      onFrameProcessed,
      ...processorOptions,
    },
    'virtual-background',
  );
};

