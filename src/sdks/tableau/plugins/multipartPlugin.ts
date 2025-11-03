import { ZodiosEndpointDefinitions, ZodiosInstance, ZodiosPlugin } from '@zodios/core';
import { Err, Ok, Result } from 'ts-results-es';
import { z } from 'zod';

type RequestOptions = ReturnType<NonNullable<ZodiosPlugin['request']>>;

export const multipartRequestSchema = z.object({
  boundaryString: z.string(),
  contentDispositionName: z.literal('tableau_file'),
  contentType: z.literal('application/xml'),
  filename: z.string(),
  contents: z.instanceof(Buffer),
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

export const useMultipartPluginAsync = async <T extends ZodiosEndpointDefinitions, S>({
  apiClient,
  actionFnAsync,
}: {
  apiClient: ZodiosInstance<T>;
  actionFnAsync: () => Promise<S>;
}): Promise<Result<S, unknown>> => {
  try {
    apiClient.use(multipartPlugin);
    return new Ok(await actionFnAsync());
  } catch (e: unknown) {
    return new Err(e);
  } finally {
    apiClient.eject(pluginName);
  }
};

function getMultipartRequestData({
  boundaryString,
  contentDispositionName,
  contentType,
  filename,
  contents,
}: MultipartRequest): Buffer<ArrayBuffer> {
  const requestBodyStart = `--${boundaryString}
Content-Disposition: name="request_payload"
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
    contents,
    Buffer.from(requestBodyEnd, 'utf8'),
  ]);

  return data;
}
