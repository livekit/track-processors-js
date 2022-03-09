import BackgroundTransformer from './transformers/BackgroundTransformer';
import ProcessorPipeline from './ProcessorPipeline';
import DummyTransformer from './transformers/DummyTransformer';

export const BlurBackground = (blurRadius: number = 10) => {
  const pipeline = new ProcessorPipeline([new BackgroundTransformer({ blurRadius })]);
  return pipeline;
};

export const VirtualBackground = (imagePath: string) => {
  const pipeline = new ProcessorPipeline([
    new BackgroundTransformer({ imagePath }),
    new DummyTransformer(),
  ]);
  return pipeline;
};
