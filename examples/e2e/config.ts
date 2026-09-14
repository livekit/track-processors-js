import type { BackdropKind, CameraClock, Config, MotionKind, ProcessorMode } from './types';

/**
 * Query parameters are used for anything that cannot be changed after construction —
 * `segmenterOptions`, `assetPaths` and `maxFps` are all read once inside `BackgroundProcessor()`
 * — plus anything that has to apply before boot, like removing the insertable-streams globals.
 * Everything else is a method on the harness.
 */

/** Flat magenta. Chosen because it appears nowhere in the subject or any backdrop. */
export const DEFAULT_BACKGROUND_IMAGE = '/bg-solid.png';

/** The local copies written by `pnpm assets:mediapipe`, used when `?assets=local`. */
const LOCAL_ASSETS = {
  tasksVisionFileSet: '/mediapipe/wasm',
  modelAssetPath: '/mediapipe/selfie_segmenter.tflite',
};

function oneOf<T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.includes(raw as T) ? (raw as T) : fallback;
}

function num(raw: string | null, fallback: number): number {
  const parsed = Number(raw);
  return raw !== null && Number.isFinite(parsed) ? parsed : fallback;
}

function bool(raw: string | null, fallback = false): boolean {
  if (raw === null) return fallback;
  return raw !== '0' && raw !== 'false';
}

/** `camres=1280x720` */
function resolution(raw: string | null): { width?: number; height?: number } {
  const match = /^(\d+)x(\d+)$/.exec(raw ?? '');
  if (!match) return {};
  return { width: Number(match[1]), height: Number(match[2]) };
}

export function parseConfig(search: string = window.location.search): Config {
  const p = new URLSearchParams(search);

  const assetMode = p.get('assets');
  const wasm = p.get('wasm') ?? (assetMode === 'local' ? LOCAL_ASSETS.tasksVisionFileSet : undefined);
  const model = p.get('model') ?? (assetMode === 'local' ? LOCAL_ASSETS.modelAssetPath : undefined);
  const assetPaths =
    wasm || model ? { tasksVisionFileSet: wasm, modelAssetPath: model } : undefined;

  const delegateRaw = p.get('delegate')?.toUpperCase() ?? null;
  const { width, height } = resolution(p.get('camres'));

  return {
    forceFallback: bool(p.get('fallback')),
    delegate: delegateRaw === 'CPU' || delegateRaw === 'GPU' ? delegateRaw : undefined,
    assetPaths,
    maxFps: p.has('maxfps') ? num(p.get('maxfps'), 30) : undefined,
    api: oneOf(p.get('api'), ['modern', 'legacy'] as const, 'modern'),
    attach: oneOf(p.get('attach'), ['set', 'capture'] as const, 'set'),
    mode: oneOf(
      p.get('mode'),
      ['background-blur', 'virtual-background', 'disabled'] as const satisfies readonly ProcessorMode[],
      'background-blur',
    ),
    blurRadius: num(p.get('blur'), 10),
    backgroundImage: p.get('bg') ?? DEFAULT_BACKGROUND_IMAGE,

    camera: p.get('cam') ?? 'front',
    cameraWidth: width,
    cameraHeight: height,
    backdrop: oneOf(p.get('backdrop'), ['flat', 'checker', 'gradient'] as const satisfies readonly BackdropKind[], 'checker'),
    backdropColor: p.get('backdropcolor') ?? '#1d6fa5',
    motion: oneOf(p.get('motion'), ['static', 'pan', 'wave'] as const satisfies readonly MotionKind[], 'static'),
    clock: oneOf(p.get('camclock'), ['raf', 'interval', 'worker', 'manual'] as const satisfies readonly CameraClock[], 'raf'),
    cameraFps: num(p.get('camfps'), 30),
    subjectUrl: p.get('subject') ?? undefined,
    camSrc: p.get('camsrc') ?? undefined,

    autostart: bool(p.get('autostart')),
    url: p.get('url') ?? undefined,
    token: p.get('token') ?? undefined,
  };
}
