import { describe, expect, it } from 'vitest';
import { BackgroundProcessor } from '../src';

const imagePath = new URL('./fixtures/lounge.jpg', import.meta.url).href;

describe('BackgroundProcessor mode', () => {
  it.each([
    [{ mode: 'background-blur', blurRadius: 10 }, 'background-blur'],
    [{ mode: 'virtual-background', imagePath }, 'virtual-background'],
    [{ mode: 'disabled' }, 'disabled'],
  ] as const)('reports the mode it was created with: %o', (options, expected) => {
    expect(BackgroundProcessor(options).mode).toBe(expected);
  });

  it('reports the mode it was switched to', async () => {
    const processor = BackgroundProcessor({ mode: 'disabled' });
    await processor.switchTo({ mode: 'background-blur', blurRadius: 10 });
    expect(processor.mode).toBe('background-blur');
    await processor.switchTo({ mode: 'disabled' });
    expect(processor.mode).toBe('disabled');
  });
});
