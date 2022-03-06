import BackgroundProcessor, { BlurOptions } from './BackgroundProcessor';
import ProcessorPipeline from './ProcessorPipeline';

export * from './BaseVideoProcessor';

export const BackgroundBlur = (opts: BlurOptions) => {
  const pipeline = new ProcessorPipeline([new BackgroundProcessor(opts)]);
  return pipeline;
};
