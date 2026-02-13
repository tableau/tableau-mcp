import invariant from './invariant';
import { retry } from './retry';

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
});
