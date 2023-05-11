import BackgroundTransformer from "./transformers/BackgroundTransformer";
import ProcessorPipeline from "./ProcessorPipeline";
import DummyTransformer from "./transformers/DummyTransformer";
import MediaPipeHolisticTrackerTransformer, {
  MediaPipeHolisticTrackerTransformerOptions,
} from "./transformers/MediaPipeHolisticTrackerTransformer";

export const BlurBackground = (blurRadius: number = 10) => {
  const isPipelineSupported =
    ProcessorPipeline.isSupported && BackgroundTransformer.isSupported;
  if (!isPipelineSupported) {
    throw new Error("pipeline is not supported in this browser");
  }
  const pipeline = new ProcessorPipeline([
    new BackgroundTransformer({ blurRadius }),
  ]);
  return pipeline;
};

export const VirtualBackground = (imagePath: string) => {
  const isPipelineSupported =
    ProcessorPipeline.isSupported && BackgroundTransformer.isSupported;
  if (!isPipelineSupported) {
    throw new Error("pipeline is not supported in this browser");
  }
  const pipeline = new ProcessorPipeline([
    new BackgroundTransformer({ imagePath }),
    new DummyTransformer(),
  ]);
  return pipeline;
};

export const MediaPipeHolisticTracker = (
  options: MediaPipeHolisticTrackerTransformerOptions
): ProcessorPipeline => {
  // fill this in
  const isPipelineSupported =
    ProcessorPipeline.isSupported &&
    MediaPipeHolisticTrackerTransformer.isSupported;
  if (!isPipelineSupported) {
    throw new Error("pipeline is not supported in this browser");
  }
  const pipeline = new ProcessorPipeline([
    new MediaPipeHolisticTrackerTransformer(options),
    new DummyTransformer(),
  ]);
  return pipeline;
};
