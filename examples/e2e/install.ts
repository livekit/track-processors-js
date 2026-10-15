import { installCounters } from './counters';
import { FakeCamera } from './fakeCamera';
import type { Config } from './types';

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
