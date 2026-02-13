import invariant from './invariant.js';
import { retry } from './retry.js';

describe('retry', () => {
  it('should retry a function', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('test'));

    const maxRetries = 3;
    try {
      await retry(fn, { maxRetries, delayFactorMs: 1 });
    } catch (error) {
      invariant(error instanceof Error);
      expect(error.message).toBe('test');
    }

    expect(fn).toHaveBeenCalledTimes(maxRetries + 1);
  });

  it('should not retry a function if the retryIf function returns false', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('test'));
    const maxRetries = 3;
    try {
      await retry(fn, { maxRetries, delayFactorMs: 1, retryIf: () => false });
    } catch (error) {
      invariant(error instanceof Error);
      expect(error.message).toBe('test');
    }

    expect(fn).toHaveBeenCalledTimes(1);
  });
});
