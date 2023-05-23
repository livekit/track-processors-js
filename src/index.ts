import ProcessorPipeline from './ProcessorPipeline';
import BackgroundTransformer from './transformers/BackgroundTransformer';

export const BlurBackground = (blurRadius: number = 10) => {
  const isPipelineSupported = ProcessorPipeline.isSupported && BackgroundTransformer.isSupported;
  if (!isPipelineSupported) {
    throw new Error('pipeline is not supported in this browser');
  }
  const pipeline = new ProcessorPipeline([new BackgroundTransformer({ blurRadius })]);
  return pipeline;
};

export const VirtualBackground = (imagePath: string) => {
  const isPipelineSupported = ProcessorPipeline.isSupported && BackgroundTransformer.isSupported;
  if (!isPipelineSupported) {
    throw new Error('pipeline is not supported in this browser');
  }
  const pipeline = new ProcessorPipeline([new BackgroundTransformer({ imagePath })]);
  return pipeline;
};
