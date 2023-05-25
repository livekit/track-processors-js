import { Results as HolisticResults } from '@mediapipe/holistic';
import ProcessorPipeline from './ProcessorPipeline';
import BackgroundTransformer from './transformers/BackgroundTransformer';
import DummyTransformer from './transformers/DummyTransformer';
import MediaPipeHolisticTrackerTransformer, {
  MediaPipeHolisticTrackerTransformerOptions,
} from './transformers/MediaPipeHolisticTrackerTransformer';

export {
  ProcessorPipeline,
  MediaPipeHolisticTrackerTransformer,
  MediaPipeHolisticTrackerTransformerOptions,
  HolisticResults,
};

export const BlurBackground = (blurRadius = 10): ProcessorPipeline => {
  const isPipelineSupported = ProcessorPipeline.isSupported && BackgroundTransformer.isSupported;
  if (!isPipelineSupported) {
    throw new Error('pipeline is not supported in this browser');
  }
  const pipeline = new ProcessorPipeline(
    [new BackgroundTransformer({ blurRadius })],
    'blur-background',
  );
  return pipeline;
};

export const VirtualBackground = (imagePath: string): ProcessorPipeline => {
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

export const MediaPipeHolisticTracker = (
  options: MediaPipeHolisticTrackerTransformerOptions,
): ProcessorPipeline => {
  // fill this in
  const isPipelineSupported =
    ProcessorPipeline.isSupported && MediaPipeHolisticTrackerTransformer.isSupported;
  if (!isPipelineSupported) {
    throw new Error('pipeline is not supported in this browser');
  }
  const pipeline = new ProcessorPipeline(
    [new MediaPipeHolisticTrackerTransformer(options), new DummyTransformer()],
    'holistic-tracker',
  );
  return pipeline;
};
