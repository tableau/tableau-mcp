import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { readFile } from 'fs/promises';
import { basename } from 'path';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import {
  ArgsValidationError,
  ProjectNotAllowedError,
  UnknownError,
} from '../../../errors/mcpToolError.js';
import { getFeatureGate } from '../../../features/init.js';
import { BoundedContext } from '../../../overridableConfig.js';
import { useRestApi } from '../../../restApiInstance.js';
import { PublishedDataSourceResponse } from '../../../sdks/tableau/types/dataSource.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { isSlackClient } from '../../../telemetry/clientDisplayName.js';
import { Provider } from '../../../utils/provider.js';
import { type BucketS3Config } from '../s3Client.js';
import { WebTool } from '../tool.js';
import {
  getDatasourceFileType,
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
      'Path to a local TDS or TDSX data source file on the MCP server filesystem. Only supported when staged S3 uploads are not configured.',
    ),
  name: z.string().min(1).describe('The name to give the published data source.'),
  projectId: z
    .string()
    .min(1)
    .describe(
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
      'Publishes a TDS or TDSX data source from a local file path or staged upload id to the specified Tableau project. Use list-projects to discover project IDs. The data source is uploaded and then validated by Tableau as part of publishing.',
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
        isSlackClient(server.clientId),
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

          const result = await useRestApi<PublishDatasourceResult>({
            ...extra,
            jwtScopes: tool.requiredApiScopes,
            callback: async (restApi) => {
              const resolvedDatasourceFile = await resolveDatasourceInput({
                config: extra.config.bucketS3,
                datasourceUploadId,
                datasourceFilePath,
              });
              const fileType = getDatasourceFileType(resolvedDatasourceFile.fileName);
              if (!fileType) {
                throw new UnknownError(
                  `Resolved data source file "${resolvedDatasourceFile.fileName}" is neither a .tds nor a .tdsx file.`,
                );
              }

              const uploadSessionId = await restApi.publishingMethods.uploadFileInChunks({
                siteId: restApi.siteId,
                filename: resolvedDatasourceFile.fileName,
                content: resolvedDatasourceFile.bytes,
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

async function resolveDatasourceInput({
  config,
  datasourceUploadId,
  datasourceFilePath,
}: {
  config: BucketS3Config & { enabled: boolean };
  datasourceUploadId?: string;
  datasourceFilePath?: string;
}): Promise<ResolvedDatasource> {
  if (datasourceUploadId && datasourceFilePath) {
    throw new ArgsValidationError(
      'Provide either datasourceFilePath or datasourceUploadId, not both.',
    );
  }

  if (datasourceFilePath) {
    if (config.enabled) {
      throw new ArgsValidationError(
        'datasourceFilePath is only supported when staged S3 uploads are not configured. Call request-datasource-upload first and pass datasourceUploadId.',
      );
    }
    return await resolveLocalDatasourceFile(datasourceFilePath);
  }

  if (!datasourceUploadId) {
    throw new ArgsValidationError(
      'Either datasourceFilePath or datasourceUploadId must be provided. For local MCP servers, pass datasourceFilePath. For hosted clients, call request-datasource-upload first and pass datasourceUploadId.',
    );
  }
  if (!config.enabled) {
    throw new UnknownError(
      'MCP_S3_BUCKET must be configured before publishing staged data source uploads.',
    );
  }
  return await resolveStagedDatasourceUpload({
    datasourceUploadId,
    config,
  });
}

async function resolveLocalDatasourceFile(datasourceFilePath: string): Promise<ResolvedDatasource> {
  const fileName = basename(datasourceFilePath);
  if (!getDatasourceFileType(fileName)) {
    throw new ArgsValidationError('datasourceFilePath must point to a .tds or .tdsx file.');
  }

  const bytes = await readFile(datasourceFilePath);
  if (bytes.byteLength === 0) {
    throw new ArgsValidationError(
      'datasourceFilePath must not point to an empty data source file.',
    );
  }

  return { fileName, bytes };
}

function assertProjectAllowedByBoundedContext(
  projectId: string,
  boundedContext: BoundedContext,
): void {
  const { projectIds } = boundedContext;
  if (projectIds && !projectIds.has(projectId)) {
    throw new ProjectNotAllowedError(
      `Publishing to project with LUID ${projectId} is not allowed by this MCP server's bounded project context.`,
    );
  }
}
