import { shouldLogWhenLevelIsAtLeast } from '../log.js';
import {
  RequestInterceptorConfig,
  ResponseInterceptorConfig,
} from '../sdks/tableau/interceptors.js';

type MaskedKeys = 'data' | 'headers';
type Optional<T, K extends keyof T> = Pick<Partial<T>, K> & Omit<T, K>;
type MaskedRequest = Optional<RequestInterceptorConfig, MaskedKeys>;
type MaskedResponse = Optional<ResponseInterceptorConfig, MaskedKeys>;

export const maskRequest = (config: RequestInterceptorConfig): MaskedRequest => {
  const maskedData: MaskedRequest = clone(config);
  if (shouldLogWhenLevelIsAtLeast('debug')) {
    if (maskedData.data?.credentials) {
      maskedData.data.credentials = '<redacted>';
    }

    if (maskedData.headers?.['X-Tableau-Auth']) {
      maskedData.headers['X-Tableau-Auth'] = '<redacted>';
    }
  } else {
    delete maskedData.data;
    delete maskedData.headers;
  }

  return maskedData;
};

export const maskResponse = (response: ResponseInterceptorConfig): MaskedResponse => {
  const maskedData: MaskedResponse = clone(response);
  if (shouldLogWhenLevelIsAtLeast('debug')) {
    if (maskedData.data?.credentials) {
      maskedData.data.credentials = '<redacted>';
    }
  } else {
    delete maskedData.data;
    delete maskedData.headers;
  }

  return maskedData;
};

function clone<T>(obj: T): T {
  try {
    return structuredClone(obj);
  } catch (error) {
    const message = error instanceof Error ? error.message : `${error}`;
    process.stderr.write(
      `Could not clone object, notification may not be sanitized! Error: ${message}`,
    );
    return obj;
  }
}
