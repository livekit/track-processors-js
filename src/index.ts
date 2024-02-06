import ProcessorPipeline from './ProcessorPipeline';
import ProcessorWrapper from './ProcessorWrapper';
import BackgroundTransformer, { SegmenterBaseOptions } from './transformers/BackgroundTransformer';

export * from './transformers/types';
export { default as VideoTransformer } from './transformers/VideoTransformer';
export { ProcessorPipeline };
export { ProcessorWrapper };

export const BackgroundBlur = (
  blurRadius: number = 10,
  segmenterOptions?: SegmenterBaseOptions,
) => {
  const isProcessorSupported = ProcessorWrapper.isSupported && BackgroundTransformer.isSupported;
  if (!isProcessorSupported) {
    throw new Error('processor is not supported in this browser');
  }
  const pipeline = new ProcessorWrapper(
    new BackgroundTransformer({ blurRadius, segmenterOptions }),
    'background-blur',
  );
  return pipeline;
};

export const VirtualBackground = (imagePath: string, segmenterOptions?: SegmenterBaseOptions) => {
  const isProcessorSupported = ProcessorWrapper.isSupported && BackgroundTransformer.isSupported;
  if (!isProcessorSupported) {
    throw new Error('processor is not supported in this browser');
  }
  const pipeline = new ProcessorWrapper(
    new BackgroundTransformer({ imagePath, segmenterOptions }),
    'virtual-background',
  );
  return pipeline;
};
