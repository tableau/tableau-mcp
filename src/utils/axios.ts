import axios, { AxiosRequestConfig, AxiosResponse, isAxiosError } from 'axios';

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

// We re-export Axios types to avoid import clutter in the codebase.
export { axios, AxiosRequestConfig, AxiosResponse, isAxiosError };
