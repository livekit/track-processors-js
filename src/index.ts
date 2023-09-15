import ProcessorPipeline from './ProcessorPipeline';
import BackgroundTransformer, { SegmenterBaseOptions } from './transformers/BackgroundTransformer';
import DummyTransformer from './transformers/DummyTransformer';

export * from './transformers/types';
export { default as VideoTransformer } from './transformers/VideoTransformer';
export { ProcessorPipeline };

export const BackgroundBlur = (
  blurRadius: number = 10,
  segmenterOptions?: SegmenterBaseOptions,
) => {
  const isPipelineSupported = ProcessorPipeline.isSupported && BackgroundTransformer.isSupported;
  if (!isPipelineSupported) {
    throw new Error('pipeline is not supported in this browser');
  }
  const pipeline = new ProcessorPipeline(
    [new BackgroundTransformer({ blurRadius, segmenterOptions })],
    'background-blur',
  );
  return pipeline;
};

export const VirtualBackground = (imagePath: string, segmenterOptions?: SegmenterBaseOptions) => {
  const isPipelineSupported = ProcessorPipeline.isSupported && BackgroundTransformer.isSupported;
  if (!isPipelineSupported) {
    throw new Error('pipeline is not supported in this browser');
  }
  const pipeline = new ProcessorPipeline(
    [new BackgroundTransformer({ imagePath, segmenterOptions })],
    'virtual-background',
  );
  return pipeline;
};

export const Dummy = () => {
  const isPipelineSupported = ProcessorPipeline.isSupported && BackgroundTransformer.isSupported;
  if (!isPipelineSupported) {
    throw new Error('pipeline is not supported in this browser');
  }
  const pipeline = new ProcessorPipeline([new DummyTransformer()], 'dummy');
  return pipeline;
};
