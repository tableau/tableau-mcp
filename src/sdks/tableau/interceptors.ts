import { config } from '../../config.js';
import { log, shouldLogWhenLevelIsAtLeast } from '../../log.js';
import { maskRequest } from '../../logging/secretMask.js';
import { maskResponse } from '../../logging/secretMask.js';

export type RequestInterceptorConfig = {
  method: string;
  baseUrl: string;
  url: string;
  headers: Record<string, string>;
  data: any;
};

export type ResponseInterceptorConfig = {
  baseUrl: string;
  url: string;
  status: number;
  headers: Record<string, any>;
  data: any;
};

export type RequestInterceptor = (config: RequestInterceptorConfig) => void;
export type ResponseInterceptor = (response: ResponseInterceptorConfig) => void;

export const getRequestInterceptor =
  (requestId: string): RequestInterceptor =>
  (request) => {
    const maskedRequest = config.disableLogMasking ? request : maskRequest(request);
    const { baseUrl, url } = maskedRequest;
    const urlParts = [...baseUrl.split('/'), ...url.split('/')].filter(Boolean);
    const messageObj = {
      type: 'request',
      requestId,
      method: maskedRequest.method,
      url: urlParts.join('/'),
      ...(shouldLogWhenLevelIsAtLeast('debug') && {
        headers: maskedRequest.headers,
        data: maskedRequest.data,
      }),
    } as const;

    log.info(messageObj, 'rest-api');
    return request;
  };

export const getResponseInterceptor =
  (requestId: string): ResponseInterceptor =>
  (response) => {
    const maskedResponse = config.disableLogMasking ? response : maskResponse(response);
    const { baseUrl, url } = maskedResponse;
    const urlParts = [...baseUrl.split('/'), ...url.split('/')].filter(Boolean);
    const messageObj = {
      type: 'response',
      requestId,
      url: urlParts.join('/'),
      status: maskedResponse.status,
      ...(shouldLogWhenLevelIsAtLeast('debug') && {
        headers: maskedResponse.headers,
        data: maskedResponse.data,
      }),
    } as const;

    log.info(messageObj, 'rest-api');
  };
