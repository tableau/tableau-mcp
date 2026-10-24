import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { basename } from 'path';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { isBlobStorageEnabled } from '../../../blobStorage/init.js';
import { ArgsValidationError, UnknownError } from '../../../errors/mcpToolError.js';
import { isAuthoringAllowedForClient } from '../../../features/authoringAccess.js';
import { getFeatureGate } from '../../../features/init.js';
import { useRestApi } from '../../../restApiInstance.js';
import { luidSchema } from '../../../sdks/routeSafety/ids.js';
import { PublishedDataSourceResponse } from '../../../sdks/tableau/types/dataSource.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { type TransportName } from '../../../transports.js';
import { Provider } from '../../../utils/provider.js';
import { WebTool } from '../tool.js';
import { assertProjectAllowedByBoundedContext } from '../utils/boundedContextUtils.js';
import {
  getDatasourceFileType,
  MAX_STAGED_DATASOURCE_BYTES,
  type ResolvedDatasource,
  resolveStagedDatasourceUpload,
} from './stagedDatasourceUpload.js';

const paramsSchema = {
  datasourceUploadId: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Staged data source upload id returned by request-datasource-upload. Use this for hosted clients that cannot pass a local path.',
    ),
  datasourceFilePath: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Path to a local TDS or TDSX data source file on the MCP server filesystem. Only supported when the MCP server runs over stdio and blob storage is not configured. On HTTP servers, use datasourceUploadId.',
    ),
  name: z.string().min(1).describe('The name to give the published data source.'),
  projectId: luidSchema.describe(
    'The Tableau project LUID to publish the data source into. Use list-projects to discover available project IDs.',
  ),
  overwrite: z
    .boolean()
    .default(false)
    .describe(
      'Whether to overwrite an existing data source with the same name in the target project. Defaults to false.',
    ),
};

export type PublishDatasourceResult = {
  status: 'published';
  data: PublishedDataSourceResponse;
  url: string;
};

export const getPublishDatasourceTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'publish-datasource',
    minRequiredRole: SiteRole.EXPLORER_CAN_PUBLISH,
    description:
      'Publishes a TDS or TDSX data source from a staged upload id, or from a local file path when the MCP server runs over stdio, to the specified Tableau project. Use list-projects to discover project IDs. The data source is uploaded and then validated by Tableau as part of publishing.',
    paramsSchema,
    annotations: {
      title: 'Publish Data Source',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    disabled: new Provider(
      async () =>
        !(await getFeatureGate().isFeatureEnabled('authoring-tools')) ||
        !(await isAuthoringAllowedForClient(server.clientId)),
    ),
    callback: async (
      { datasourceUploadId, datasourceFilePath, name, projectId, overwrite = false },
      extra,
    ): Promise<CallToolResult> => {
      return await tool.logAndExecute<PublishDatasourceResult>({
        extra,
        args: {
          datasourceUploadId: datasourceUploadId ? '<redacted>' : undefined,
          datasourceFilePath: datasourceFilePath ? '<redacted>' : undefined,
          name,
          projectId,
          overwrite,
        },
        callback: async () => {
          const configWithOverrides = await extra.getConfigWithOverrides();
          assertProjectAllowedByBoundedContext(projectId, configWithOverrides.boundedContext);

          const input = validateDatasourceInput({
            transport: extra.config.transport,
            datasourceUploadId,
            datasourceFilePath,
          });

          const result = await useRestApi<PublishDatasourceResult>({
            ...extra,
            jwtScopes: tool.requiredApiScopes,
            callback: async (restApi) => {
              const resolvedDatasourceFile = await loadDatasourceFile(input);
              const fileType = getDatasourceFileType(resolvedDatasourceFile.fileName);
              if (!fileType) {
                throw new UnknownError(
                  `Resolved data source file "${resolvedDatasourceFile.fileName}" is neither a .tds nor a .tdsx file.`,
                );
              }

              const uploadSessionId = await restApi.publishingMethods.uploadFileInChunks({
                siteId: restApi.siteId,
                filename: resolvedDatasourceFile.fileName,
                fileStream: resolvedDatasourceFile.fileStream,
                maxBytes: MAX_STAGED_DATASOURCE_BYTES,
              });

              const publishedDatasource = await restApi.datasourcesMethods.publishDatasource({
                siteId: restApi.siteId,
                uploadSessionId,
                name,
                datasourceType: fileType,
                projectId,
                overwrite,
              });

              return {
                status: 'published' as const,
                data: publishedDatasource,
                url: publishedDatasource.webpageUrl ?? '',
              };
            },
          });

          return new Ok(result);
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
        getSuccessResult: (result) => ({
          isError: false,
          structuredContent: result,
          content: [{ type: 'text', text: JSON.stringify(result) }],
        }),
      });
    },
  });

  return tool;
};

type DatasourceInput =
  | { source: 'local'; datasourceFilePath: string }
  | { source: 'staged'; datasourceUploadId: string };

function validateDatasourceInput({
  transport,
  datasourceUploadId,
  datasourceFilePath,
}: {
  transport: TransportName;
  datasourceUploadId?: string;
  datasourceFilePath?: string;
}): DatasourceInput {
  if (datasourceUploadId && datasourceFilePath) {
    throw new ArgsValidationError(
      'Provide either datasourceFilePath or datasourceUploadId, not both.',
    );
  }

  if (datasourceFilePath) {
    if (transport !== 'stdio') {
      throw new ArgsValidationError(
        'datasourceFilePath is only supported when the MCP server runs over stdio. On an HTTP server, stage the file with request-datasource-upload and pass datasourceUploadId; that requires the server to configure a blob storage provider.',
      );
    }
    if (isBlobStorageEnabled()) {
      throw new ArgsValidationError(
        'datasourceFilePath is only supported when staged uploads are not configured. Call request-datasource-upload first and pass datasourceUploadId.',
      );
    }
    return { source: 'local', datasourceFilePath };
  }

  if (!datasourceUploadId) {
    throw new ArgsValidationError(
      'Either datasourceFilePath or datasourceUploadId must be provided. For local stdio MCP servers, pass datasourceFilePath. For hosted clients, call request-datasource-upload first and pass datasourceUploadId.',
    );
  }
  if (!isBlobStorageEnabled()) {
    throw new UnknownError(
      'Blob storage provider must be configured before publishing staged data source uploads.',
    );
  }
  return { source: 'staged', datasourceUploadId };
}

async function loadDatasourceFile(input: DatasourceInput): Promise<ResolvedDatasource> {
  return input.source === 'local'
    ? await resolveLocalDatasourceFile(input.datasourceFilePath)
    : await resolveStagedDatasourceUpload({ datasourceUploadId: input.datasourceUploadId });
}

async function resolveLocalDatasourceFile(datasourceFilePath: string): Promise<ResolvedDatasource> {
  const fileName = basename(datasourceFilePath);
  if (!getDatasourceFileType(fileName)) {
    throw new ArgsValidationError('datasourceFilePath must point to a .tds or .tdsx file.');
  }

  if ((await stat(datasourceFilePath)).size === 0) {
    throw new ArgsValidationError(
      'datasourceFilePath must not point to an empty data source file.',
    );
  }

  return { fileName, fileStream: createReadStream(datasourceFilePath) };
}
