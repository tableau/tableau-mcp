import axios, {
  AxiosRequestConfig,
  AxiosResponse,
  isAxiosError,
} from '../../node_modules/axios/index.js';

export function getStringResponseHeader(
  headers: AxiosResponse['headers'],
  headerName: string,
): string {
  const headerValue = headers[headerName] || '';
  if (typeof headerValue === 'string') {
    return headerValue;
  }
  return '';
}

const DEFAULT_RETRY_OPTIONS = {
  maxRetries: 3,
  delayFactorMs: 100,
  jitterFactor: 0.2,
} as const;

type AxiosRetryOptions = Partial<typeof DEFAULT_RETRY_OPTIONS>;

export async function axiosRetry<T>(
  fn: () => Promise<T>,
  options: AxiosRetryOptions = {},
): Promise<T> {
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
        const delayMs = 2 ** attempt * delayFactorMs;
        const jitter = delayMs * jitterFactor * Math.random();
        await new Promise((resolve) => setTimeout(resolve, delayMs + jitter));
      } else {
        throw lastError;
      }
    }
  }

  throw lastError;
}

// Our dependency on Axios is indirect through Zodios.
// Zodios doesn't re-export the exports of axios, so we need to import it haphazardly through node_modules.
// This re-export is only to prevent import clutter in the codebase.
export { axios, AxiosRequestConfig, AxiosResponse, isAxiosError };
