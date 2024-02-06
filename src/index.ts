import ProcessorPipeline from './ProcessorPipeline';
import ProcessorWrapper from './ProcessorWrapper';
import BackgroundTransformer, {
  BackgroundOptions,
  SegmenterOptions,
} from './transformers/BackgroundTransformer';

export * from './transformers/types';
export { default as VideoTransformer } from './transformers/VideoTransformer';
export { ProcessorPipeline };
export { ProcessorWrapper };

export const BackgroundBlur = (blurRadius: number = 10, segmenterOptions?: SegmenterOptions) => {
  return BackgroundProcessor({ blurRadius, segmenterOptions }, 'background-blur');
};

export const VirtualBackground = (imagePath: string, segmenterOptions?: SegmenterOptions) => {
  return BackgroundProcessor({ imagePath, segmenterOptions }, 'virtual-background');
};

export const BackgroundProcessor = (options: BackgroundOptions, name = 'background-processor') => {
  const isProcessorSupported = ProcessorWrapper.isSupported && BackgroundTransformer.isSupported;
  if (!isProcessorSupported) {
    throw new Error('processor is not supported in this browser');
  }
  const processor = new ProcessorWrapper(new BackgroundTransformer(options), name);
  return processor;
};
