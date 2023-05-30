import ProcessorPipeline from './ProcessorPipeline';
import BackgroundTransformer from './transformers/BackgroundTransformer';
import DummyTransformer from './transformers/DummyTransformer';

export const BackgroundBlur = (blurRadius: number = 10) => {
  const isPipelineSupported = ProcessorPipeline.isSupported && BackgroundTransformer.isSupported;
  if (!isPipelineSupported) {
    throw new Error('pipeline is not supported in this browser');
  }
  const pipeline = new ProcessorPipeline(
    [new BackgroundTransformer({ blurRadius })],
    'background-blur',
  );
  return pipeline;
};

export const VirtualBackground = (imagePath: string) => {
  const isPipelineSupported = ProcessorPipeline.isSupported && BackgroundTransformer.isSupported;
  if (!isPipelineSupported) {
    throw new Error('pipeline is not supported in this browser');
  }
  const pipeline = new ProcessorPipeline(
    [new BackgroundTransformer({ imagePath })],
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
