import { ZodiosPlugin } from '@zodios/core';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';

import { DataSourcesApiClient } from '../apis/datasourcesApi.js';
import { WorkbookApiClient } from '../apis/workbookApi.js';
import { dataSourceSchema } from '../types/dataSource.js';
import { workbookSchema } from '../types/workbook.js';

type RequestOptions = ReturnType<NonNullable<ZodiosPlugin['request']>>;

export const multipartRequestSchema = z.object({ pathToFile: z.string() }).and(
  z
    .object({
      contentDispositionName: z.literal('tableau_workbook'),
      asset: z.object({
        workbook: workbookSchema
          .partial()
          .extend({ project: workbookSchema.shape.project.partial() }),
      }),
    })
    .or(
      z.object({
        contentDispositionName: z.literal('tableau_datasource'),
        asset: z.object({
          datasource: dataSourceSchema
            .partial()
            .extend({ project: dataSourceSchema.shape.project.partial() }),
        }),
      }),
    ),
);

type MultipartRequest = z.infer<typeof multipartRequestSchema>;

const pluginName = 'post-multipart';
const postMultipartPlugin: ZodiosPlugin = {
  name: pluginName,
  request: (_, config): RequestOptions => {
    const request = config.data as MultipartRequest;

    const data = getMultipartRequestData(
      request.contentDispositionName,
      request.asset,
      request.pathToFile,
    );

    return Promise.resolve({
      ...config,
      data,
    });
  },
};

export const usePostMultipartPluginAsync = async (input: {
  apiClient: WorkbookApiClient | DataSourcesApiClient;
  actionFnAsync: () => Promise<void>;
  catchFn: (e: unknown) => void;
}): Promise<void> => {
  const { apiClient, actionFnAsync, catchFn } = input;

  try {
    apiClient.use(postMultipartPlugin);
    await actionFnAsync();
  } catch (e: unknown) {
    catchFn(e);
  } finally {
    apiClient.eject(pluginName);
  }
};

export const boundaryString = 'myBoundaryString';
function getMultipartRequestData(
  contentDispositionName: string,
  payload: object,
  filePath: string,
): Buffer<ArrayBuffer> {
  const filename = path.basename(filePath);

  const requestBodyStart = `--${boundaryString}
Content-Disposition: form-data; name="request_payload"
Content-Type: application/json

${JSON.stringify(payload)}
--${boundaryString}
Content-Disposition: form-data; name="${contentDispositionName}"; filename="${filename}"
Content-Type: application/octet-stream

`.replace(/\n/g, '\r\n');

  const requestBodyEnd = `
--${boundaryString}--
`.replace(/\n/g, '\r\n');

  const data = Buffer.concat([
    Buffer.from(requestBodyStart, 'utf8'),
    fs.readFileSync(filePath),
    Buffer.from(requestBodyEnd, 'utf8'),
  ]);

  return data;
}
