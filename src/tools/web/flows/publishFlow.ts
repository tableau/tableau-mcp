import { open } from 'node:fs/promises';
import { basename } from 'node:path';

import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import { ArgsValidationError, UnknownError } from '../../../errors/mcpToolError.js';
import { isAuthoringAllowedForClient } from '../../../features/authoringAccess.js';
import { isFlowWriteToolsEnabled } from '../../../features/flowTools.js';
import { useRestApi } from '../../../restApiInstance.js';
import { luidSchema } from '../../../sdks/routeSafety/ids.js';
import { Flow } from '../../../sdks/tableau/types/flow.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { WebTool } from '../tool.js';
import { assertProjectAllowedByBoundedContext } from '../utils/boundedContextUtils.js';
import { getFlowFileType, MAX_FLOW_BYTES, resolveStagedFlowUpload } from './stagedFlowUpload.js';

const paramsSchema = {
  flowUploadId: z
    .string()
    .min(1)
    .optional()
    .describe('Staged upload id from request-flow-upload. Required on hosted HTTP servers.'),
  flowFilePath: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Path to a TFL or TFLX on the local stdio MCP server, available only when staged uploads are not configured.',
    ),
  name: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .refine((value) => !/\p{C}/u.test(value), 'The flow name must not contain control characters.')
    .describe('The published flow name.'),
  projectId: luidSchema.describe('The destination project LUID from list-projects.'),
  overwrite: z
    .boolean()
    .default(false)
    .describe(
      'Replace a same-name flow in this project. Defaults to false. Unavailable when flows are restricted by tag.',
    ),
};
export type PublishFlowResult = { status: 'published'; flow: Flow };

/** Publishes existing flow bytes; it never executes the flow or changes connection credentials. */
export const getPublishFlowTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'publish-flow',
    minRequiredRole: SiteRole.EXPLORER_CAN_PUBLISH,
    description:
      'Publishes a Tableau Prep .tfl or .tflx to an explicit project. Pass a local flowFilePath on stdio, or stage a file with request-flow-upload and pass flowUploadId. Files must be non-empty and at most 256 MiB. Overwrite defaults to false. This does not run the flow or supply connection credentials.',
    paramsSchema,
    disabled: new Provider(
      async () =>
        !(await isFlowWriteToolsEnabled(getConfig())) ||
        !(await isAuthoringAllowedForClient(server.clientId)),
    ),
    annotations: {
      title: 'Publish Flow',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    callback: async (
      { flowUploadId, flowFilePath, name, projectId, overwrite = false },
      extra,
    ): Promise<CallToolResult> =>
      await tool.logAndExecute<PublishFlowResult>({
        extra,
        args: {
          flowUploadId: flowUploadId ? '<redacted>' : undefined,
          flowFilePath: flowFilePath ? '<redacted>' : undefined,
          name,
          projectId,
          overwrite,
        },
        callback: async () => {
          const config = await extra.getConfigWithOverrides();
          assertProjectAllowedByBoundedContext(projectId, config.boundedContext);
          if (overwrite && config.boundedContext.tags !== null)
            return new ArgsValidationError(
              'Overwriting flows is unavailable when the server restricts flows by tag. Publish under a new name or ask the administrator to use a project-only context.',
            ).toErr();
          if (Boolean(flowFilePath) === Boolean(flowUploadId))
            return new ArgsValidationError(
              'Provide exactly one of flowFilePath or flowUploadId.',
            ).toErr();
          if (flowFilePath && (extra.config.transport !== 'stdio' || extra.config.bucketS3.enabled))
            return new ArgsValidationError(
              'Local flowFilePath is available only on stdio without staged storage. Use request-flow-upload and flowUploadId on hosted servers.',
            ).toErr();
          if (flowUploadId && !extra.config.bucketS3.enabled)
            return new ArgsValidationError(
              'Staged storage must be configured before publishing flowUploadId.',
            ).toErr();
          if (flowUploadId && extra.tableauAuthInfo?.type === 'Passthrough')
            return new ArgsValidationError(
              'Staged flow uploads require OAuth or server-side authentication.',
            ).toErr();
          let file: { fileName: string; bytes: Buffer };
          try {
            file = flowFilePath
              ? await readLocalFlow(flowFilePath)
              : await resolveStagedFlowUpload({
                  flowUploadId: flowUploadId!,
                  config: extra.config.bucketS3,
                  maxBytes: MAX_FLOW_BYTES,
                });
          } catch {
            return new ArgsValidationError(
              'Could not read the flow file. Provide a non-empty .tfl or .tflx file of at most 256 MiB, or a valid unexpired staged upload.',
            ).toErr();
          }
          const flowType = getFlowFileType(file.fileName);
          if (!flowType)
            return new ArgsValidationError('The flow file must end in .tfl or .tflx.').toErr();
          const flow = await useRestApi({
            ...extra,
            jwtScopes: tool.requiredApiScopes,
            callback: async (restApi) => {
              // A fixed multipart filename prevents file-originated header injection.
              const uploadSessionId = await restApi.publishingMethods.uploadFileInChunks({
                siteId: restApi.siteId,
                filename: `flow.${flowType}`,
                content: file.bytes,
              });
              return await restApi.flowsMethods.publishFlow({
                siteId: restApi.siteId,
                uploadSessionId,
                flowType,
                name,
                projectId,
                overwrite,
              });
            },
          });
          if (flow.project?.id !== projectId || !flow.id)
            return new UnknownError(
              'Tableau returned an unverified flow location after publishing. The write may have succeeded; inspect the project before retrying.',
            ).toErr();
          return new Ok({ status: 'published', flow });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      }),
  });
  return tool;
};

/** Reads a fixed-size regular file through one handle, refusing changes or growth before upload. */
async function readLocalFlow(path: string): Promise<{ fileName: string; bytes: Buffer }> {
  const fileName = basename(path);
  if (!getFlowFileType(fileName)) throw new Error('Unsupported flow extension.');
  const file = await open(path, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_FLOW_BYTES)
      throw new Error('Flow size out of bounds.');
    const buffer = Buffer.alloc(stat.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, null);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const after = await file.stat();
    if (offset !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs)
      throw new Error('Flow changed during read.');
    return { fileName, bytes: buffer.subarray(0, offset) };
  } finally {
    await file.close();
  }
}
