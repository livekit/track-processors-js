import {
  BackgroundBlur,
  BackgroundProcessor,
  type BackgroundProcessorWrapper,
  GainAudioProcessor,
  ProcessorWrapper,
  VirtualBackground,
  supportsBackgroundProcessors,
} from '../../src';
import type {
  Config,
  FrameProcessingStats,
  ProcessorConstruction,
  ProcessorSupport,
} from './types';

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

/**
 * Whether a processor can be constructed here, and what is missing when it cannot.
 *
 * `BackgroundProcessor()` throws when a primitive is absent (src/index.ts), and issues #10 and
 * #38 are both what an app gets for constructing it anyway: the throw escapes module scope or
 * a click handler, and the user is left with a white screen or an uncaught error instead of a
 * control that tells them why it cannot run. The library's answer is
 * `supportsBackgroundProcessors()`, so the harness asks before it builds — which is also the
 * only honest way for the harness to model a real integration.
 */
export function processorSupport(): ProcessorSupport {
  const missing: string[] = [];
  if (typeof OffscreenCanvas === 'undefined') missing.push('OffscreenCanvas');
  if (typeof VideoFrame === 'undefined') missing.push('VideoFrame');
  if (typeof createImageBitmap === 'undefined') missing.push('createImageBitmap');
  if (!hasWebgl2()) missing.push('webgl2');
  if (!ProcessorWrapper.isSupported) {
    missing.push('MediaStreamTrackProcessor or canvas.captureStream');
  }

  const supported = supportsBackgroundProcessors();
  return {
    supported,
    missing,
    reason: supported
      ? null
      : `Background processing is unavailable in this browser: missing ${missing.join(', ')}.`,
  };
}

/**
 * Build a processor on purpose and catch the throw.
 *
 * Only a spec calls this. The app itself goes through `processorSupport()` first, so the
 * documented error would otherwise never be observable from the outside.
 */
export function tryCreateBackgroundProcessor(
  config: Config,
  onFrameProcessed: (stats: FrameProcessingStats) => void,
): ProcessorConstruction {
  try {
    createBackgroundProcessor(config, onFrameProcessed);
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Cached: every call would otherwise create a context the library never releases (#136), and
 * the panel re-renders twice a second.
 */
let webgl2Available: boolean | undefined;

function hasWebgl2(): boolean {
  if (webgl2Available === undefined) {
    try {
      webgl2Available = !!document.createElement('canvas').getContext('webgl2');
    } catch {
      webgl2Available = false;
    }
  }
  return webgl2Available;
}
