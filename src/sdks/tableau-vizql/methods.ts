import { AxiosRequestConfig } from '../../utils/axios.js';
import { getClient } from './client.js';

export async function startSession({
  basePath,
  siteName,
  workbookName,
  viewName,
  cookie,
  axiosConfig,
}: {
  basePath: string;
  siteName: string;
  workbookName: string;
  viewName: string;
  cookie: string;
  axiosConfig: AxiosRequestConfig;
}): Promise<{ sessionId: string }> {
  return await getClient(basePath, axiosConfig).startSession(undefined, {
    params: { siteName, workbookName, viewName },
    headers: {
      Cookie: cookie,
    },
  });
}
