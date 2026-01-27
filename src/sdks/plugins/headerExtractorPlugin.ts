import { ZodiosEndpointDefinitions, ZodiosInstance, ZodiosPlugin } from '@zodios/core';

import { Deferred } from '../../../tests/oauth/deferred';
import { AxiosResponse, getStringResponseHeader } from '../../utils/axios';

type HeaderExtractorOptions = {
  headerName: string;
  onHeader: (value: string, response: AxiosResponse) => void;
};

const HEADER_EXTRACTOR_PLUGIN_NAME = 'header-extractor';

const headerExtractorPlugin = ({ headerName, onHeader }: HeaderExtractorOptions): ZodiosPlugin => {
  return {
    name: HEADER_EXTRACTOR_PLUGIN_NAME,
    response: async (_api, _config, response) => {
      const headerValue = getStringResponseHeader(response.headers, headerName);
      onHeader(headerValue, response);
      return response;
    },
  };
};

export async function useHeaderExtractorPlugin<TClient extends ZodiosEndpointDefinitions, TReturn>({
  client,
  headerName,
  clientCallback,
  timeoutMs,
  signal,
}: {
  client: ZodiosInstance<TClient>;
  headerName: string;
  clientCallback: (client: ZodiosInstance<TClient>) => Promise<TReturn>;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<{ result: TReturn; headerValue: string }> {
  const deferredHeader = new Deferred<string>();

  let timeoutId: NodeJS.Timeout | undefined;
  let abortListener: (() => void) | undefined;

  if (timeoutMs !== undefined) {
    timeoutId = setTimeout(() => deferredHeader.resolve(''), timeoutMs);
  }

  if (signal) {
    abortListener = () => deferredHeader.resolve('');
    signal.addEventListener('abort', abortListener);
  }

  try {
    client.use(
      headerExtractorPlugin({ headerName, onHeader: (value) => deferredHeader.resolve(value) }),
    );

    const result = await clientCallback(client);
    const headerValue = await deferredHeader.promise;

    return { result, headerValue };
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }

    if (signal && abortListener) {
      signal.removeEventListener('abort', abortListener);
    }

    client.eject(HEADER_EXTRACTOR_PLUGIN_NAME);
  }
}
