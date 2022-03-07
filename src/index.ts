import BackgroundTransformer, { BackgroundOptions } from './transformers/BackgroundTransformer';
import ProcessorPipeline from './ProcessorPipeline';
import DummyTransformer from './transformers/DummyTransformer';

export const BackgroundBlur = (opts: BackgroundOptions) => {
  const pipeline = new ProcessorPipeline([new BackgroundTransformer(opts)]);
  return pipeline;
};

export const VirtualAndBlur = (opts: BackgroundOptions) => {
  const pipeline = new ProcessorPipeline([
    new BackgroundTransformer({ backgroundImage: opts.backgroundImage }),
    new DummyTransformer(),
  ]);
  return pipeline;
};
