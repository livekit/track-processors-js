import { afterEach, expect, it, vi } from 'vitest';
import { createFrameTicker } from '../src/FrameTicker';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('releases the worker URL and keeps ticking if worker construction is blocked', () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'Worker',
    class {
      constructor() {
        throw new DOMException('Worker blocked', 'SecurityError');
      }
    },
  );
  const createObjectURL = vi.spyOn(URL, 'createObjectURL');
  const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL');
  const onTick = vi.fn();

  const ticker = createFrameTicker(10, onTick);
  try {
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const workerUrl = createObjectURL.mock.results[0].value;
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(workerUrl);
    vi.advanceTimersByTime(10);
    expect(onTick).toHaveBeenCalledTimes(1);
  } finally {
    ticker.stop();
    for (const result of createObjectURL.mock.results) {
      if (result.type === 'return') URL.revokeObjectURL(result.value);
    }
  }
  vi.advanceTimersByTime(10);
  expect(onTick).toHaveBeenCalledTimes(1);
});
