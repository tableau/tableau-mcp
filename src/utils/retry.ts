const DEFAULT_RETRY_OPTIONS = {
  maxRetries: 3,
  delayFactorMs: 100,
  jitterFactor: 0.2,
};

type RetryOptions = Partial<typeof DEFAULT_RETRY_OPTIONS>;

export async function retry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { maxRetries, delayFactorMs, jitterFactor } = {
    ...DEFAULT_RETRY_OPTIONS,
    ...options,
  };

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt < maxRetries) {
        const delayMs = Math.pow(2, attempt) * Math.abs(delayFactorMs);
        const jitter = delayMs * Math.abs(jitterFactor) * Math.random();
        await new Promise((resolve) => setTimeout(resolve, delayMs + jitter));
      } else {
        throw lastError;
      }
    }
  }

  throw lastError;
}
