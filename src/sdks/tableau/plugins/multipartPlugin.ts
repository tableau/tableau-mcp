import { ZodiosEndpointDefinitions, ZodiosInstance, ZodiosPlugin } from '@zodios/core';
import { z } from 'zod';

type RequestOptions = ReturnType<NonNullable<ZodiosPlugin['request']>>;

export const multipartRequestSchema = z.object({
  contentDispositionName: z.literal('request_payload'),
  contentType: z.literal('application/xml'),
  filename: z.string(),
  contents: z.string(),
});

type MultipartRequest = z.infer<typeof multipartRequestSchema>;

const pluginName = 'multipart';
const multipartPlugin: ZodiosPlugin = {
  name: pluginName,
  request: (_, config): RequestOptions => {
    const request = multipartRequestSchema.parse(config.data);
    const data = getMultipartRequestData(request);

    return Promise.resolve({
      ...config,
      data,
    });
  },
};

export const useMultipartPluginAsync = async <T extends ZodiosEndpointDefinitions>({
  apiClient,
  actionFnAsync,
  catchFn,
}: {
  apiClient: ZodiosInstance<T>;
  actionFnAsync: () => Promise<void>;
  catchFn: (e: unknown) => void;
}): Promise<void> => {
  try {
    apiClient.use(multipartPlugin);
    await actionFnAsync();
  } catch (e: unknown) {
    catchFn(e);
  } finally {
    apiClient.eject(pluginName);
  }
};

export const boundaryString = crypto.randomUUID();
function getMultipartRequestData({
  contentDispositionName,
  contentType,
  filename,
  contents,
}: MultipartRequest): Buffer<ArrayBuffer> {
  const requestBodyStart = `--${boundaryString}
Content-Disposition: name="${contentDispositionName}"
Content-Type: ${contentType}

--${boundaryString}
Content-Disposition: name="${contentDispositionName}"; filename="${filename}"
Content-Type: application/octet-stream

`.replace(/\n/g, '\r\n');

  const requestBodyEnd = `
--${boundaryString}--
`.replace(/\n/g, '\r\n');

  const data = Buffer.concat([
    Buffer.from(requestBodyStart, 'utf8'),
    Buffer.from(contents, 'utf8'),
    Buffer.from(requestBodyEnd, 'utf8'),
  ]);

  return data;
}
