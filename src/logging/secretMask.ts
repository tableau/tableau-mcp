import { Err, Ok, Result } from 'ts-results-es';

import {
  RequestInterceptorConfig,
  ResponseInterceptorConfig,
} from '../sdks/tableau/interceptors.js';
import { getExceptionMessage } from '../utils/getExceptionMessage.js';
import { shouldLogWhenLevelIsAtLeast, writeToStderr } from './log.js';

type MaskedKeys = 'data' | 'headers';
type Optional<T, K extends keyof T> = Pick<Partial<T>, K> & Omit<T, K>;
type MaskedRequest = Optional<RequestInterceptorConfig, MaskedKeys>;
type MaskedResponse = Optional<ResponseInterceptorConfig, MaskedKeys>;

export const maskRequest = (config: RequestInterceptorConfig): MaskedRequest => {
  const result = clone<MaskedRequest>(config);
  if (result.isErr()) {
    return config;
  }

  const maskedData = result.value;
  if (shouldLogWhenLevelIsAtLeast('debug')) {
    if (maskedData.data?.credentials) {
      maskedData.data.credentials = '<redacted>';
    }

    if (Array.isArray(maskedData?.data?.datasource?.connections)) {
      const connections = maskedData.data.datasource.connections as Array<{
        connectionLuid: string;
        connectionUsername: string;
        connectionPassword: string;
      }>;

      connections.forEach((connection) => {
        connection.connectionUsername = '<redacted>';
        connection.connectionPassword = '<redacted>';
      });
    }

    if (maskedData.headers?.['X-Tableau-Auth']) {
      maskedData.headers['X-Tableau-Auth'] = '<redacted>';
    }

    if (maskedData.params?.['user_id']) {
      maskedData.params['user_id'] = '<redacted>';
    }
  } else {
    delete maskedData.data;
    delete maskedData.headers;
    delete maskedData.params;
  }

  return maskedData;
};

export const maskResponse = (response: ResponseInterceptorConfig): MaskedResponse => {
  const result = clone<MaskedResponse>(response);
  if (result.isErr()) {
    return response;
  }

  const maskedData = result.value;
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

function clone<T>(obj: T): Result<T, Error> {
  try {
    return Ok(structuredClone(obj));
  } catch (error) {
    if (error instanceof Error) {
      return Err(error);
    }

    const message = getExceptionMessage(error);
    writeToStderr(`Could not clone object, notification may not be sanitized! Error: ${message}`);
    return Err(new Error(message));
  }
}
