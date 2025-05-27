import { ZodiosClass } from '@zodios/core';

export type RequestInterceptor = (config: RequestInterceptorConfig) => void;
export type ResponseInterceptor = (response: ResponseInterceptorConfig) => void;
export type ErrorInterceptor = (error: unknown, baseUrl: string) => void;

export type AxiosInterceptor = ZodiosClass<any>['axios']['interceptors'];
export type AxiosRequestInterceptor = Parameters<AxiosInterceptor['request']['use']>[0];
export type AxiosRequestInterceptorConfig = Parameters<NonNullable<AxiosRequestInterceptor>>[0];
export type RequestInterceptorConfig = {
  baseUrl: string;
  headers: Record<string, any>;
  // AxiosHeaders is a complex class, overwrite it for simplicity.
} & Omit<AxiosRequestInterceptorConfig, 'headers'>;

export type AxiosResponseInterceptor = Parameters<AxiosInterceptor['response']['use']>[0];
export type AxiosResponseInterceptorConfig = Parameters<NonNullable<AxiosResponseInterceptor>>[0];
export type ResponseInterceptorConfig = {
  baseUrl: string;
  url: string;
  headers: Record<string, any>;
  // AxiosHeaders is a complex class, overwrite it for simplicity.
} & Omit<AxiosResponseInterceptorConfig, 'headers' | 'statusText' | 'config'>;

export function getRequestInterceptorConfig(
  config: AxiosRequestInterceptorConfig,
): Omit<RequestInterceptorConfig, 'baseUrl'> {
  return {
    method: config.method ?? 'UNKNOWN METHOD',
    url: config.url ?? 'UNKNOWN URL',
    headers: config.headers,
    data: config.data,
    params: config.params,
  };
}

export function getResponseInterceptorConfig(
  response: AxiosResponseInterceptorConfig,
): Omit<ResponseInterceptorConfig, 'baseUrl'> {
  return {
    url: response.config.url ?? 'UNKNOWN URL',
    status: response.status,
    headers: response.headers,
    data: response.data,
  };
}
