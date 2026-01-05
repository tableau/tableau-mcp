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

// Our dependency on Axios is indirect through Zodios.
// Zodios doesn't re-export the exports of axios, so we need to import it haphazardly through node_modules.
// This re-export is only to prevent import clutter in the codebase.
export { axios, AxiosRequestConfig, AxiosResponse, isAxiosError };
