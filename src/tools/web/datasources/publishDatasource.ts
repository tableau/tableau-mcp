import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { basename } from 'path';
import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { ArgsValidationError, McpToolError, UnknownError } from '../../../errors/mcpToolError.js';
import { isAuthoringAllowedForClient } from '../../../features/authoringAccess.js';
import { getFeatureGate } from '../../../features/init.js';
import { log } from '../../../logging/logger.js';
import { useRestApi } from '../../../restApiInstance.js';
import { type ByteStream } from '../../../sdks/tableau/methods/publishingMethods.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { parseTableauApiError } from '../../../sdks/tableau/tableauApiError.js';
import { PublishedDataSource } from '../../../sdks/tableau/types/dataSource.js';
import { JobDetail } from '../../../sdks/tableau/types/job.js';
import { GranteeCapability } from '../../../sdks/tableau/types/permissions.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { PUBLISH_DATASOURCE_PERMISSIONS_API_SCOPE } from '../../../server/oauth/scopes.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { Provider } from '../../../utils/provider.js';
import { type BucketS3Config } from '../s3Client.js';
import { WebTool } from '../tool.js';
import { TableauWebRequestHandlerExtra } from '../toolContext.js';
import { assertProjectAllowedByBoundedContext } from '../utils/boundedContextUtils.js';
import { sanitizeFindingText } from '../utils/sanitizeFindingText.js';
import {
  type DatasourceFileType,
  getDatasourceFileType,
  streamStagedDatasourceUpload,
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
      'Path to a local .tdsx or .hyper file on the MCP server filesystem. Only supported when staged S3 uploads are not configured. A bare .hyper must contain exactly one table; send multi-table models as .tdsx.',
    ),
  name: z.string().min(1).describe('The name to give the published data source.'),
  projectId: z
    .string()
    .min(1)
    .describe(
      'The Tableau project LUID to publish into (use list-projects). Required: data sources cannot be published to Personal Space.',
    ),
  description: z.string().optional().describe('Optional data source description.'),
  overwrite: z
    .boolean()
    .default(false)
    .describe(
      'Replace an existing data source with the same name in the project, keeping its LUID. Defaults to false.',
    ),
};

export type PublishDatasourceResult =
  | {
      status: 'published';
      datasource: {
        id: string;
        name: string;
        contentUrl: string;
        project: { id: string; name: string };
        webpageUrl?: string;
      };
      server: string;
      siteContentUrl: string;
      overwritten: boolean;
      // Configured grantee rules, not effective user access. Absent if the optional read failed.
      permissions?: GranteeCapability[];
      permissionsNote?: string;
      boundedContextNote?: string;
    }
  | { status: 'pending'; jobId: string; name: string; projectId: string }
  | { status: 'failed'; jobId?: string; message: string };

type PublishedResult = Extract<PublishDatasourceResult, { status: 'published' }>;

// Tableau returns this code when the name is taken and overwrite is false (sync publish only;
// async jobs fail silently, which is why the tool checks for the name before uploading).
const DATASOURCE_NAME_CONFLICT_CODE = '403007';
const NAME_CONFLICT_HINT = 'pass overwrite: true or choose another name.';
const PROJECT_PERMISSION_HINT = 'Use list-projects to find a project you can publish to.';

const JOB_POLL_INITIAL_DELAY_MS = 1_000;
const JOB_POLL_MAX_DELAY_MS = 10_000;
const JOB_FINISH_CODE_SUCCESS = 0;
const JOB_FINISH_CODE_CANCELLED = 2;

// Failed publish jobs often come back with no status notes, so the reason is otherwise lost.
const JOB_FAILED_WITHOUT_NOTES_MESSAGE =
  'Tableau could not publish the data source and did not report a reason. Known causes: a .hyper ' +
  'file with more than one table (send multi-table models as .tdsx), a malformed .tds inside the ' +
  '.tdsx, or a .tdsx whose extract is missing.';

export const getPublishDatasourceTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'publish-datasource',
    minRequiredRole: SiteRole.CREATOR,
    description: [
      'Publishes a TDSX or HYPER data source extract to a Tableau project from a staged upload id (call request-datasource-upload first) or, on local MCP servers without S3 staging, a local file path. A bare .hyper must contain exactly one table; package multi-table models as .tdsx. Live-connection .tds files are not supported.',
      'Publishing runs as a Tableau background job. If it finishes in time, status is "published" with the data source id (LUID), contentUrl, and project. If not, status is "pending" with a jobId; check the job later and find the data source by name and project. status "failed" carries the reason.',
      'Fails before uploading if a data source with the same name already exists in the project and overwrite is false. Overwriting keeps the existing LUID.',
      'Also returns the data source permission rules (configured rules, not effective access) in permissions, or permissionsNote if that optional read fails. boundedContextNote is set when this server restricts which data sources can be queried and the new one is not on the list.',
      'get-datasource-metadata reads Catalog, which can lag publishing by minutes: field descriptions and roles may be missing, and after an overwrite it may still show the old data source description.',
    ].join('\n\n'),
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
    callback: async (args, extra): Promise<CallToolResult> => {
      const {
        datasourceUploadId,
        datasourceFilePath,
        name,
        projectId,
        description,
        overwrite = false,
      } = args;
      return await tool.logAndExecute<PublishDatasourceResult>({
        extra,
        args: {
          datasourceUploadId: datasourceUploadId ? '<redacted>' : undefined,
          datasourceFilePath: datasourceFilePath ? '<redacted>' : undefined,
          name,
          projectId,
          description,
          overwrite,
        },
        callback: async () => {
          const input = await validateDatasourceInput({
            config: extra.config.bucketS3,
            datasourceUploadId,
            datasourceFilePath,
          });
          if (name.includes(',')) {
            // Tableau's REST filter syntax has no escape for commas, so the name lookups that
            // guard against silent overwrite failures and resolve the new LUID can't run.
            throw new ArgsValidationError('Data source names containing commas are not supported.');
          }

          const configWithOverrides = await extra.getConfigWithOverrides();
          assertProjectAllowedByBoundedContext(projectId, configWithOverrides.boundedContext);

          const result = await useRestApi<Result<PublishDatasourceResult, McpToolError>>({
            ...extra,
            jwtScopes: tool.requiredApiScopes,
            callback: async (restApi) => {
              const existing = await findDatasource({ restApi, name, projectId });
              if (existing && !overwrite) {
                return new ArgsValidationError(
                  `A data source named "${name}" already exists in project ${projectId}; ${NAME_CONFLICT_HINT}`,
                ).toErr();
              }

              const source = await openDatasourceInput(input, extra.config.bucketS3);
              const { uploadSessionId, totalBytes } =
                await restApi.publishingMethods.uploadStreamInChunks({
                  siteId: restApi.siteId,
                  filename: source.fileName,
                  stream: source.stream,
                });
              if (totalBytes === 0) {
                return new ArgsValidationError('The data source file must not be empty.').toErr();
              }

              let jobId: string;
              try {
                ({ jobId } = await restApi.datasourcesMethods.publishDatasourceAsJob({
                  siteId: restApi.siteId,
                  uploadSessionId,
                  datasourceType: source.fileType,
                  name,
                  projectId,
                  description,
                  overwrite,
                }));
              } catch (error) {
                const mapped = mapPublishError(error, name);
                if (mapped) {
                  return mapped.toErr();
                }
                throw error;
              }

              const jobOutcome = await waitForJob({
                restApi,
                jobId,
                timeoutMs: extra.config.publishDatasourceJobTimeoutSeconds * 1000,
              });
              if (jobOutcome.status === 'pending') {
                return new Ok({ status: 'pending' as const, jobId, name, projectId });
              }
              if (jobOutcome.status === 'failed') {
                return new Ok({ status: 'failed' as const, jobId, message: jobOutcome.message });
              }

              const published = await findDatasource({ restApi, name, projectId });
              if (!published) {
                throw new UnknownError(
                  `Publish job ${jobId} succeeded, but the data source "${name}" could not be found in project ${projectId}. Use list-datasources to locate it.`,
                );
              }

              const { datasourceIds } = configWithOverrides.boundedContext;
              return new Ok({
                status: 'published' as const,
                datasource: {
                  id: published.id,
                  name: published.name,
                  contentUrl: published.contentUrl ?? '',
                  project: { id: published.project.id, name: published.project.name },
                  webpageUrl: published.webpageUrl,
                },
                server: extra.config.server,
                siteContentUrl: extra.getSiteName(),
                overwritten: existing !== undefined,
                ...(datasourceIds && !datasourceIds.has(published.id)
                  ? {
                      boundedContextNote:
                        `This MCP server only allows querying specific data sources, and the new data source (${published.id}) is not one of them. ` +
                        'query-datasource and get-datasource-metadata will reject it until a server operator adds this LUID to the allowed data sources.',
                    }
                  : {}),
              });
            },
          });

          if (result.isErr() || result.value.status !== 'published') {
            return result;
          }
          // Runs after the publish session has signed out: a second sign-in with the same PAT can
          // invalidate a still-open first session. Best-effort: never fail a completed publish.
          return new Ok(await withPermissions(result.value, extra));
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

type ValidatedDatasourceInput =
  | { type: 'local'; path: string; fileName: string; fileType: DatasourceFileType }
  | { type: 'staged'; datasourceUploadId: string };

async function validateDatasourceInput({
  config,
  datasourceUploadId,
  datasourceFilePath,
}: {
  config: BucketS3Config & { enabled: boolean };
  datasourceUploadId?: string;
  datasourceFilePath?: string;
}): Promise<ValidatedDatasourceInput> {
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
    const fileName = basename(datasourceFilePath);
    const fileType = getDatasourceFileType(fileName);
    if (!fileType) {
      throw new ArgsValidationError('datasourceFilePath must point to a .tdsx or .hyper file.');
    }
    if ((await stat(datasourceFilePath)).size === 0) {
      throw new ArgsValidationError(
        'datasourceFilePath must not point to an empty data source file.',
      );
    }
    return { type: 'local', path: datasourceFilePath, fileName, fileType };
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
  return { type: 'staged', datasourceUploadId };
}

async function openDatasourceInput(
  input: ValidatedDatasourceInput,
  config: BucketS3Config,
): Promise<{
  fileName: string;
  fileType: DatasourceFileType;
  stream: ByteStream;
}> {
  if (input.type === 'local') {
    return {
      fileName: input.fileName,
      fileType: input.fileType,
      stream: createReadStream(input.path),
    };
  }
  return await streamStagedDatasourceUpload({
    datasourceUploadId: input.datasourceUploadId,
    config,
  });
}

async function findDatasource({
  restApi,
  name,
  projectId,
}: {
  restApi: RestApi;
  name: string;
  projectId: string;
}): Promise<PublishedDataSource | undefined> {
  // `eq` treats `*` as a wildcard, so confirm the exact name client-side.
  const { datasources } = await restApi.datasourcesMethods.listDatasources({
    siteId: restApi.siteId,
    filter: `name:eq:${name}`,
    pageSize: 1000,
  });
  return datasources.find(
    (datasource) => datasource.name === name && datasource.project.id === projectId,
  );
}

type JobOutcome =
  | { status: 'succeeded' }
  | { status: 'failed'; message: string }
  | { status: 'pending' };

async function waitForJob({
  restApi,
  jobId,
  timeoutMs,
}: {
  restApi: RestApi;
  jobId: string;
  timeoutMs: number;
}): Promise<JobOutcome> {
  const deadline = Date.now() + timeoutMs;
  let delayMs = JOB_POLL_INITIAL_DELAY_MS;

  for (;;) {
    const job = await restApi.jobsMethods.getJob({ siteId: restApi.siteId, jobId });
    if (job.finishCode !== undefined) {
      return job.finishCode === JOB_FINISH_CODE_SUCCESS
        ? { status: 'succeeded' }
        : { status: 'failed', message: getJobFailureMessage(job) };
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      return { status: 'pending' };
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(delayMs, remainingMs)));
    delayMs = Math.min(delayMs * 2, JOB_POLL_MAX_DELAY_MS);
  }
}

function getJobFailureMessage(job: JobDetail): string {
  if (job.finishCode === JOB_FINISH_CODE_CANCELLED) {
    return 'The publish job was cancelled.';
  }
  const notes = [
    ...(job.statusNotes?.statusNote ?? []).map((note) => note.text ?? note.value),
    job.notes,
  ].filter((note): note is string => !!note?.trim());
  return notes.length > 0
    ? sanitizeFindingText(notes.join('\n'), 2_000).trim()
    : JOB_FAILED_WITHOUT_NOTES_MESSAGE;
}

function mapPublishError(error: unknown, name: string): McpToolError | null {
  const parsed = parseTableauApiError(error);
  if (parsed?.status !== 403) {
    return null;
  }
  if (parsed.code === DATASOURCE_NAME_CONFLICT_CODE) {
    return new ArgsValidationError(
      `A data source named "${name}" already exists in the project; ${NAME_CONFLICT_HINT}`,
    );
  }
  const reason = [parsed.summary, parsed.detail].filter(Boolean).join(': ');
  return new UnknownError(
    `Tableau denied publishing to this project${reason ? ` (${sanitizeFindingText(reason, 500)})` : ''}. ${PROJECT_PERMISSION_HINT}`,
    403,
  );
}

async function withPermissions(
  published: PublishedResult,
  extra: TableauWebRequestHandlerExtra,
): Promise<PublishedResult> {
  try {
    // The optional read bypasses the tool's mandatory-scope middleware check.
    // Honor the same OAuth consent boundary before minting its REST credentials.
    if (
      (extra.authInfo !== undefined || extra.tableauAuthInfo !== undefined) &&
      extra.config.oauth.enforceScopes &&
      extra.config.oauth.advertiseApiScopes &&
      !extra.authInfo?.scopes.includes(PUBLISH_DATASOURCE_PERMISSIONS_API_SCOPE)
    ) {
      throw new Error(`Missing scope: ${PUBLISH_DATASOURCE_PERMISSIONS_API_SCOPE}`);
    }
    const permissions = await useRestApi({
      ...extra,
      jwtScopes: [PUBLISH_DATASOURCE_PERMISSIONS_API_SCOPE],
      callback: async (permissionsApi) =>
        permissionsApi.datasourcesMethods.queryDatasourcePermissions({
          siteId: permissionsApi.siteId,
          datasourceId: published.datasource.id,
        }),
    });
    return { ...published, permissions };
  } catch (error) {
    log({
      message: 'publish-datasource: failed to fetch data source permissions (best-effort)',
      level: 'warning',
      logger: 'publish-datasource',
      data: getExceptionMessage(error),
    });
    return {
      ...published,
      permissionsNote:
        'Published successfully, but the data source permission rules could not be retrieved.',
    };
  }
}
