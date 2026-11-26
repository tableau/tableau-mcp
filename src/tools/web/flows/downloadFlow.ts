import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { getConfig } from '../../../config.js';
import { FlowNotAllowedError, UnknownError } from '../../../errors/mcpToolError.js';
import { isFlowReadToolsEnabled } from '../../../features/flowTools.js';
import { useRestApi } from '../../../restApiInstance.js';
import { luidSchema } from '../../../sdks/routeSafety/ids.js';
import { DownloadFlowResult } from '../../../sdks/tableau/types/downloadFlowResult.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { joinS3Prefix, uploadBufferToS3 } from '../s3Client.js';
import { WebTool } from '../tool.js';

const paramsSchema = {
  flowId: luidSchema.describe('The LUID of the published Prep flow to download.'),
};
export type FlowFileResult = { filename: string; mimeType: string } & (
  | { kind: 'path'; path: string }
  | { kind: 'url'; url: string }
);

/** Downloads the original flow without changing its content or executing it. */
export const getDownloadFlowTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'download-flow',
    minRequiredRole: SiteRole.EXPLORER,
    description:
      'Downloads a published Tableau Prep flow as its original .tfl or .tflx file. Requires Download permission for the flow. Returns a local file path, or a short-lived download URL when file storage is configured. Files larger than 256 MiB are refused. This does not run or modify the flow.',
    paramsSchema,
    disabled: new Provider(async () => !(await isFlowReadToolsEnabled(getConfig()))),
    annotations: {
      title: 'Download Flow',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ flowId }, extra): Promise<CallToolResult> =>
      await tool.logAndExecute<FlowFileResult>({
        extra,
        args: { flowId },
        callback: async () => {
          const allowed = await resourceAccessChecker.isFlowAllowed({ flowId, extra });
          if (!allowed.allowed) return new FlowNotAllowedError(allowed.message).toErr();
          const file = await useRestApi({
            ...extra,
            jwtScopes: tool.requiredApiScopes,
            callback: async (restApi) =>
              await restApi.flowsMethods.downloadFlow({ siteId: restApi.siteId, flowId }),
          });
          if (file.content.length === 0)
            return new UnknownError(
              'Tableau returned an empty flow file. No file was emitted.',
            ).toErr();
          let metadata = getFlowFileMetadata(file, flowId);
          if (!metadata) {
            const detail = await useRestApi({
              ...extra,
              jwtScopes: tool.requiredApiScopes,
              callback: async (restApi) =>
                await restApi.flowsMethods.queryFlow({ siteId: restApi.siteId, flowId }),
            });
            if (detail.flow.id.toLowerCase() === flowId.toLowerCase())
              metadata = getFlowFileMetadata(file, flowId, detail.flow.fileType);
          }
          if (!metadata)
            return new UnknownError(
              'Tableau did not identify the downloaded flow file as .tfl or .tflx. No file was emitted.',
            ).toErr();
          if (extra.config.bucketS3.enabled) {
            const config = extra.config.bucketS3;
            const url = await uploadBufferToS3(file.content, {
              key: `${joinS3Prefix(config.keyPrefix, 'flow-files/')}${flowId}/${randomUUID()}.${metadata.extension}`,
              contentType: metadata.mimeType,
              bucket: config.bucket,
              region: config.region,
              presignTtlSeconds: config.presignTtlSeconds,
            });
            return new Ok({
              kind: 'url',
              url,
              filename: metadata.filename,
              mimeType: metadata.mimeType,
            });
          }
          const directory = await mkdtemp(join(tmpdir(), 'tableau-mcp-flow-'));
          const path = join(directory, metadata.filename);
          await writeFile(path, file.content, { flag: 'wx', mode: 0o600 });
          return new Ok({
            kind: 'path',
            path,
            filename: metadata.filename,
            mimeType: metadata.mimeType,
          });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
        getSuccessResult: (result) =>
          result.kind === 'path'
            ? { isError: false, content: [{ type: 'text', text: JSON.stringify(result) }] }
            : {
                isError: false,
                content: [
                  {
                    type: 'resource_link',
                    uri: result.url,
                    name: result.filename,
                    mimeType: result.mimeType,
                    description: 'Downloaded Tableau Prep flow. This URL expires.',
                  },
                ],
              },
      }),
  });
  return tool;
};

/** Treat server filenames as display metadata; never let them choose a local directory. */
export function getFlowFileMetadata(
  file: DownloadFlowResult,
  flowId: string,
  fallbackType?: string,
): { filename: string; mimeType: string; extension: 'tfl' | 'tflx' } | undefined {
  // Both TFL and TFLX can be ZIP containers; their bytes do not identify the extension.
  const extension = /\.tflx$/i.test(file.filename ?? '')
    ? 'tflx'
    : /\.tfl$/i.test(file.filename ?? '')
      ? 'tfl'
      : fallbackType === 'tfl' || fallbackType === 'tflx'
        ? fallbackType
        : undefined;
  if (!extension) return undefined;
  const stem =
    (file.filename ?? `flow-${flowId}`)
      .replace(/\.tflx?$/i, '')
      .replace(/[^A-Za-z0-9_-]/g, '_')
      .slice(0, 120) || 'flow';
  return {
    filename: `flow-${stem}.${extension}`,
    mimeType: 'application/octet-stream',
    extension,
  };
}
