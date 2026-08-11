import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { rm } from 'fs/promises';
import { dirname } from 'path';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { WorkbookNotAllowedError } from '../../../errors/mcpToolError.js';
import { useRestApi } from '../../../restApiInstance.js';
import { WebMcpServer } from '../../../server.web.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { joinS3Prefix } from '../s3Client.js';
import { WebTool } from '../tool.js';
import { DownloadedWorkbookFile, persistDownloadedWorkbook } from './downloadedWorkbookFile.js';
import { UploadedWorkbookArtifact, uploadWorkbookToS3 } from './uploadWorkbookToS3.js';

const paramsSchema = {
  workbookId: z.string().min(1).describe('The LUID of the published workbook to download.'),
};

export type DownloadWorkbookResult =
  | ({ delivery: 'local' } & DownloadedWorkbookFile)
  | ({ delivery: 'url' } & UploadedWorkbookArtifact);

export const getDownloadWorkbookTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'download-workbook',
    description:
      'Downloads a published Tableau workbook definition as an editable TWB without placing workbook bytes in model context. Tableau extracts and packaged local files are excluded, so this tool supports workbooks whose data remains available through published data sources, accessible live connections, or other server-resolvable connections. If Tableau returns a TWBX, the server extracts its single embedded TWB and omits other package contents. When S3 artifact storage is configured, returns a short-lived resource link; otherwise returns a private local path accessible to the MCP server. The caller must have ExportXml permission for the workbook.',
    paramsSchema,
    annotations: {
      title: 'Download Workbook',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ workbookId }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute<DownloadWorkbookResult>({
        extra,
        args: { workbookId },
        callback: async () => {
          const isWorkbookAllowedResult = await resourceAccessChecker.isWorkbookAllowed({
            workbookId,
            extra,
          });

          if (!isWorkbookAllowedResult.allowed) {
            return new WorkbookNotAllowedError(isWorkbookAllowedResult.message).toErr();
          }

          const artifact = await useRestApi({
            ...extra,
            jwtScopes: tool.requiredApiScopes,
            callback: async (restApi): Promise<DownloadWorkbookResult> => {
              const downloadedWorkbook = await restApi.workbooksMethods.downloadWorkbook({
                siteId: restApi.siteId,
                workbookId,
                includeExtract: false,
              });

              // Consume and normalize the stream before useRestApi releases its auth context.
              const downloadedFile = await persistDownloadedWorkbook(downloadedWorkbook);
              if (!extra.config.bucketS3.enabled) {
                return { delivery: 'local', ...downloadedFile };
              }

              try {
                const uploadedWorkbook = await uploadWorkbookToS3(downloadedFile, {
                  workbookId,
                  config: {
                    ...extra.config.bucketS3,
                    keyPrefix: joinS3Prefix(extra.config.bucketS3.keyPrefix, 'workbook-downloads/'),
                  },
                });
                return { delivery: 'url', ...uploadedWorkbook };
              } finally {
                await rm(dirname(downloadedFile.workbookFilePath), {
                  recursive: true,
                  force: true,
                }).catch(() => undefined);
              }
            },
          });

          return new Ok(artifact);
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
        getSuccessResult: (result) => {
          if (result.delivery === 'url') {
            return {
              isError: false,
              structuredContent: result,
              content: [
                {
                  type: 'resource_link',
                  uri: result.url,
                  name: result.fileName,
                  mimeType: 'application/xml',
                  description:
                    'Editable Tableau TWB stored in S3. This is a short-lived presigned URL.',
                },
              ],
            };
          }

          return {
            isError: false,
            structuredContent: result,
            content: [{ type: 'text', text: JSON.stringify(result) }],
          };
        },
      });
    },
  });

  return tool;
};
