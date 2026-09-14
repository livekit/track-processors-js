import {
  BackgroundBlur,
  BackgroundProcessor,
  type BackgroundProcessorWrapper,
  GainAudioProcessor,
  VirtualBackground,
} from '../../src';
import type { Config, FrameProcessingStats } from './types';

/**
 * The only place a processor is constructed.
 *
 * `segmenterOptions`, `assetPaths` and `maxFps` are all read once inside `BackgroundProcessor()`
 * and cannot be changed afterwards, which is why the suite varies them by reloading with
 * different query parameters rather than through a mutator. A `recreate()` helper would have
 * semantics no real integration has.
 */

export function createBackgroundProcessor(
  config: Config,
  onFrameProcessed: (stats: FrameProcessingStats) => void,
): BackgroundProcessorWrapper {
  const segmenterOptions = config.delegate ? { delegate: config.delegate } : undefined;
  const common = {
    segmenterOptions,
    assetPaths: config.assetPaths,
    onFrameProcessed,
    ...(config.maxFps !== undefined ? { maxFps: config.maxFps } : {}),
  };

  if (config.api === 'legacy') {
    // The deprecated factories have no 'disabled' mode; start in blur and let the caller
    // switch. They still return a BackgroundProcessorWrapper, so switchTo() works.
    if (config.mode === 'virtual-background') {
      return VirtualBackground(
        config.backgroundImage,
        segmenterOptions,
        onFrameProcessed,
        config.maxFps !== undefined ? { maxFps: config.maxFps } : undefined,
      );
    }
    return BackgroundBlur(
      config.blurRadius,
      segmenterOptions,
      onFrameProcessed,
      config.maxFps !== undefined ? { maxFps: config.maxFps } : undefined,
    );
  }

  switch (config.mode) {
    case 'virtual-background':
      return BackgroundProcessor({ mode: 'virtual-background', imagePath: config.backgroundImage, ...common });
    case 'disabled':
      return BackgroundProcessor({ mode: 'disabled', ...common });
    case 'background-blur':
    default:
      return BackgroundProcessor({ mode: 'background-blur', blurRadius: config.blurRadius, ...common });
  }
}

export function createGainProcessor(gainValue = 1.0) {
  return new GainAudioProcessor({ gainValue });
}
