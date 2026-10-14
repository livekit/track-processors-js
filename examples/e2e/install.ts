import { installCounters } from './counters';
import { FakeCamera } from './fakeCamera';
import type { BrokenPrimitive, Config } from './types';

/**
 * Everything that has to be in place before the app touches `navigator.mediaDevices` or
 * creates a WebGL context. `main.ts` calls this as its first statement rather than relying on
 * import side effects, so prettier's import sorting can't reorder it.
 */
export async function installMocks(config: Config): Promise<FakeCamera> {
  installCounters();

  if (config.forceFallback) {
    removeGlobal('MediaStreamTrackGenerator');
    removeGlobal('MediaStreamTrackProcessor');
  }

  if (config.breakPrimitive) breakPrimitive(config.breakPrimitive);

  const camera = new FakeCamera(config);
  await camera.install();
  return camera;
}

/**
 * `ProcessorWrapper.hasModernApiSupport` tests `typeof MediaStreamTrackGenerator !== 'undefined'`,
 * so the binding has to disappear, not merely be set to undefined on some other object.
 */
function removeGlobal(name: string) {
  try {
    delete (window as any)[name];
  } catch {
    // Non-configurable in this engine; fall through.
  }
  if (typeof (window as any)[name] !== 'undefined') {
    try {
      Object.defineProperty(window, name, { value: undefined, configurable: true });
    } catch {
      console.warn(`[e2e] could not remove global ${name}; ?fallback=1 will not take effect`);
    }
  }
}

/**
 * Takes away one of the four primitives `BackgroundTransformer.isSupported` reads, so the
 * unsupported path can be driven under Chrome — the same trick `?fallback=1` plays on the
 * insertable-streams pair, for the same reason.
 *
 * Three of them are globals and go the same way. `webgl2` is not a global but a context that
 * may fail to be created, which is the realistic failure here (#39, #79 and #104 are all GPU
 * availability, not a missing API), so it is simulated by making `getContext('webgl2')` return
 * null. Both canvas prototypes are patched: the library asks a DOM canvas, the harness's own
 * counters wrap the same methods, and leaving one answering would make `env().webgl2` and
 * `BackgroundTransformer.isSupported` disagree.
 */
function breakPrimitive(which: BrokenPrimitive) {
  switch (which) {
    case 'offscreencanvas':
      removeGlobal('OffscreenCanvas');
      return;
    case 'videoframe':
      removeGlobal('VideoFrame');
      return;
    case 'createimagebitmap':
      removeGlobal('createImageBitmap');
      return;
    case 'webgl2':
      refuseWebgl2(HTMLCanvasElement.prototype);
      refuseWebgl2(typeof OffscreenCanvas !== 'undefined' ? OffscreenCanvas.prototype : null);
      return;
  }
}

function refuseWebgl2(proto: { getContext?: unknown } | null) {
  if (typeof proto?.getContext !== 'function') return;
  const original = proto.getContext as (...args: unknown[]) => unknown;
  (proto as any).getContext = function patched(this: unknown, kind: string, ...rest: unknown[]) {
    if (kind === 'webgl2') return null;
    return original.call(this, kind, ...rest);
  };
}
