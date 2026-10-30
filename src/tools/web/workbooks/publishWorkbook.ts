import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { readFile } from 'fs/promises';
import { basename } from 'path';
import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { isBlobStorageEnabled } from '../../../blobStorage/init.js';
import { getTenantLuids, type TenantIdentitySource } from '../../../blobStorage/tenantKey.js';
import { ArgsValidationError, McpToolError, UnknownError } from '../../../errors/mcpToolError.js';
import { isAuthoringAllowedForClient } from '../../../features/authoringAccess.js';
import { getFeatureGate } from '../../../features/init.js';
import { log } from '../../../logging/logger.js';
import { useRestApi } from '../../../restApiInstance.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { parseTableauApiError } from '../../../sdks/tableau/tableauApiError.js';
import { GranteeCapability } from '../../../sdks/tableau/types/permissions.js';
import { PersonalSpace } from '../../../sdks/tableau/types/personalSpace.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { Workbook } from '../../../sdks/tableau/types/workbook.js';
import { ValidationIssue } from '../../../sdks/tableau/types/workbookValidation.js';
import { WebMcpServer } from '../../../server.web.js';
import { PUBLISH_WORKBOOK_PERMISSIONS_API_SCOPE } from '../../../server/oauth/scopes.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { Provider } from '../../../utils/provider.js';
import { deleteStagedUpload } from '../stagedUpload.js';
import { WebTool } from '../tool.js';
import { assertProjectAllowedByBoundedContext } from '../utils/boundedContextUtils.js';
import {
  mapPersonalSpaceSiteDisabledError,
  notInPersonalSpaceError,
  resolvePersonalSpace,
} from '../utils/personalSpaceUtils.js';
import { getDefaultViewWebUrl } from '../utils/viewUrlUtils.js';
import {
  getWorkbookFileType,
  type ResolvedWorkbook,
  resolveStagedWorkbookUpload,
} from './stagedWorkbookUpload.js';

const paramsSchema = {
  workbookUploadId: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Staged workbook upload id returned by request-workbook-upload. Use this for hosted clients that cannot pass a local path.',
    ),
  workbookFilePath: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Path to a local TWB or TWBX workbook file on the MCP server filesystem. Only supported when blob storage is not configured.',
    ),
  name: z.string().min(1).describe('The name to give the published workbook.'),
  projectId: z
    .string()
    .min(1)
    .optional()
    .describe(
      'The Tableau project LUID to publish into (use list-projects). Takes precedence over personalSpace.',
    ),
  personalSpace: z
    .boolean()
    .default(true)
    .describe(
      'Publish to your Personal Space when projectId is omitted. Defaults to true; set false to require projectId.',
    ),
  overwrite: z
    .boolean()
    .default(false)
    .describe(
      'Whether to overwrite an existing workbook with the same name in the selected destination. Defaults to false.',
    ),
};

const personalSpaceParamsSchema = z.object(paramsSchema).strict();
const projectParamsSchema = personalSpaceParamsSchema.omit({ personalSpace: true }).extend({
  projectId: z
    .string()
    .min(1)
    .describe(
      'The Tableau project LUID to publish the workbook into. Use list-projects to discover available project IDs.',
    ),
});
// Both advertised schemas produce arguments accepted by the same execution path; the project
// schema has no personalSpace, so it is optional on the shared output type.
type PublishWorkbookParamsSchema = z.ZodType<
  Omit<z.output<typeof personalSpaceParamsSchema>, 'personalSpace'> & { personalSpace?: boolean },
  z.ZodTypeDef,
  z.input<typeof personalSpaceParamsSchema>
>;

export type PublishWorkbookResult =
  | {
      status: 'published';
      data: Workbook;
      url: string;
      warnings: ValidationFinding[];
      // Configured grantee rules, not effective user access; returned modes remain unchanged.
      // Absent for Personal Space or a failed permissions read.
      permissions?: GranteeCapability[];
      permissionsNote?: string;
    }
  | {
      status: 'invalid';
      errors: ValidationFinding[];
      warnings: ValidationFinding[];
    };

type ValidationFinding = {
  severity: string;
  message: string;
  line?: number;
  column?: number;
  elementName: string;
};

export const getPublishWorkbookTool = (
  server: WebMcpServer,
): WebTool<PublishWorkbookParamsSchema> => {
  const tool = new WebTool<PublishWorkbookParamsSchema>({
    server,
    name: 'publish-workbook',
    minRequiredRole: SiteRole.EXPLORER_CAN_PUBLISH,
    description: new Provider(async () => {
      const dataAppsEnabled = await getFeatureGate().isFeatureEnabled('data-apps');
      return [
        'Publishes a TWB or TWBX workbook from a local file path or staged upload id to Tableau. ' +
          (dataAppsEnabled
            ? 'Provide projectId to choose the target project (use list-projects to discover IDs). Without projectId, publishes to your Personal Space unless personalSpace is false, which requires projectId. '
            : 'Provide projectId to choose the target project (use list-projects to discover IDs). ') +
          'TWB workbooks are validated up front and uploaded only when validation succeeds, with any blocking errors returned instead of publishing. TWBX workbooks are uploaded directly and validated by Tableau as part of publishing, since Tableau cannot pre-validate extracts packaged inside a TWBX.',
        'Project publishes also return the workbook permission rules (configured rules, not effective access) in permissions, or permissionsNote if that optional read fails.',
      ].join('\n\n');
    }),
    paramsSchema: new Provider(async () =>
      (await getFeatureGate().isFeatureEnabled('data-apps'))
        ? personalSpaceParamsSchema
        : projectParamsSchema,
    ),
    annotations: {
      title: 'Publish Workbook',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    disabled: new Provider(async () => !(await isAuthoringAllowedForClient(server.clientId))),
    callback: async (args, extra): Promise<CallToolResult> => {
      const {
        workbookUploadId,
        workbookFilePath,
        name,
        projectId,
        personalSpace,
        overwrite = false,
      } = args;
      return await tool.logAndExecute<PublishWorkbookResult>({
        extra,
        args: {
          workbookUploadId: workbookUploadId ? '<redacted>' : undefined,
          workbookFilePath: workbookFilePath ? '<redacted>' : undefined,
          name,
          projectId,
          personalSpace,
          overwrite,
        },
        callback: async () => {
          // Recheck at execution time in case the client cached a schema from before the flag changed.
          const dataAppsEnabled = await getFeatureGate().isFeatureEnabled('data-apps');
          // projectId always wins. Without it, the destination is Personal Space unless it is
          // opted out (or the flag is off, e.g. a stale cached schema), which requires projectId.
          const usePersonalSpace =
            projectId === undefined && dataAppsEnabled && personalSpace !== false;
          if (projectId === undefined && !usePersonalSpace) {
            throw new ArgsValidationError('projectId is required to publish a workbook.');
          }
          assertMinimumRestApiVersionSupported();
          const configWithOverrides = await extra.getConfigWithOverrides();
          // Only an explicit projectId is gated by the bounded-context allow-list. The
          // personalSpace path resolves the caller's own Personal Space, which an operator's
          // "publish only into these shared projects" allow-list is not meant to block
          // (intentional, confirmed asymmetry — do not make symmetric).
          if (projectId !== undefined) {
            assertProjectAllowedByBoundedContext(projectId, configWithOverrides.boundedContext);
          }

          const result = await useRestApi<Result<PublishWorkbookResult, McpToolError>>({
            ...extra,
            jwtScopes: tool.requiredApiScopes,
            callback: async (restApi) => {
              // Resolve Personal Space up front when explicitly selected so a read-only or
              // unresolvable space fails before uploading anything.
              let personalSpaceTarget: PersonalSpace | undefined;
              if (usePersonalSpace) {
                const resolvedPersonalSpace = await resolvePersonalSpace(restApi, 'publish');
                if (resolvedPersonalSpace.isErr()) {
                  return resolvedPersonalSpace;
                }
                personalSpaceTarget = resolvedPersonalSpace.value;
              }

              const resolvedWorkbookInput = await resolveWorkbookInput({
                workbookUploadId,
                workbookFilePath,
                tenant: extra,
              });
              if (resolvedWorkbookInput.isErr()) {
                return resolvedWorkbookInput;
              }
              const resolvedWorkbookFile = resolvedWorkbookInput.value;
              const fileType = getWorkbookFileType(resolvedWorkbookFile.fileName);
              if (!fileType) {
                throw new UnknownError(
                  `Resolved workbook file "${resolvedWorkbookFile.fileName}" is neither a .twb nor a .twbx file.`,
                );
              }

              const outcome =
                fileType === 'twb'
                  ? await validateAndUploadTwb({ restApi, resolvedWorkbookFile })
                  : await uploadTwbx({ restApi, resolvedWorkbookFile });

              if (outcome.status === 'invalid') {
                return new Ok({
                  status: 'invalid' as const,
                  errors: outcome.errors,
                  warnings: outcome.warnings,
                });
              }

              const destination =
                personalSpaceTarget !== undefined
                  ? { location: personalSpaceTarget.luid }
                  : { projectId };

              let publishedWorkbook: Workbook;
              try {
                publishedWorkbook = await restApi.workbooksMethods.publishWorkbook({
                  siteId: restApi.siteId,
                  uploadSessionId: outcome.uploadSessionId,
                  name,
                  workbookType: fileType,
                  ...destination,
                  overwrite,
                });
              } catch (error) {
                const mapped =
                  (personalSpaceTarget !== undefined
                    ? mapPersonalSpaceSiteDisabledError(error, 'publish')
                    : null) ?? mapPublishWorkbookError(error);
                if (mapped) {
                  return mapped.toErr();
                }
                throw error;
              }

              await deleteStagedUpload(resolvedWorkbookFile, 'publish-workbook');

              if (personalSpaceTarget !== undefined) {
                const notInPersonalSpace = notInPersonalSpaceError(publishedWorkbook, 'publish');
                if (notInPersonalSpace) {
                  return notInPersonalSpace.toErr();
                }
              }

              const url =
                getDefaultViewWebUrl(publishedWorkbook, extra.config.server, extra.getSiteName()) ??
                publishedWorkbook.webpageUrl ??
                '';

              return new Ok({
                status: 'published' as const,
                data: publishedWorkbook,
                url,
                warnings: outcome.warnings,
              });
            },
          });

          // Disclose the workbook's permission rules for project publishes only. Personal-space
          // content has no shareable grantees. Runs after the publish session has signed out: a
          // second sign-in with the same PAT can invalidate a still-open first session.
          // Best-effort: a permissions-read failure must not fail an already-completed publish.
          if (usePersonalSpace || result.isErr() || result.value.status !== 'published') {
            return result;
          }
          const published = result.value;
          try {
            // The optional read bypasses the tool's mandatory-scope middleware check.
            // Honor the same OAuth consent boundary before minting its REST credentials.
            if (
              (extra.authInfo !== undefined || extra.tableauAuthInfo !== undefined) &&
              extra.config.oauth.enforceScopes &&
              extra.config.oauth.advertiseApiScopes &&
              !extra.authInfo?.scopes.includes(PUBLISH_WORKBOOK_PERMISSIONS_API_SCOPE)
            ) {
              throw new Error(`Missing scope: ${PUBLISH_WORKBOOK_PERMISSIONS_API_SCOPE}`);
            }
            const permissions = await useRestApi({
              ...extra,
              jwtScopes: [PUBLISH_WORKBOOK_PERMISSIONS_API_SCOPE],
              callback: async (permissionsApi) =>
                permissionsApi.workbooksMethods.queryWorkbookPermissions({
                  siteId: permissionsApi.siteId,
                  workbookId: published.data.id,
                }),
            });
            return new Ok({ ...published, permissions });
          } catch (error) {
            log({
              message: 'publish-workbook: failed to fetch workbook permissions (best-effort)',
              level: 'warning',
              logger: 'publish-workbook',
              data: getExceptionMessage(error),
            });
            return new Ok({
              ...published,
              permissionsNote:
                'Published successfully, but the workbook permission rules could not be retrieved.',
            });
          }
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

type ValidationOutcome =
  | { status: 'invalid'; errors: ValidationFinding[]; warnings: ValidationFinding[] }
  | { status: 'valid'; warnings: ValidationFinding[]; uploadSessionId: string };

async function validateAndUploadTwb({
  restApi,
  resolvedWorkbookFile,
}: {
  restApi: RestApi;
  resolvedWorkbookFile: ResolvedWorkbook;
}): Promise<ValidationOutcome> {
  const validation = await restApi.workbooksMethods.validateWorkbookAndUpload({
    siteId: restApi.siteId,
    filename: resolvedWorkbookFile.fileName,
    workbook: resolvedWorkbookFile.bytes,
  });

  const errors = (validation.errors ?? []).map(toValidationFinding);
  const warnings = (validation.warnings ?? []).map(toValidationFinding);

  if (errors.length > 0) {
    return { status: 'invalid', errors, warnings };
  }

  if (!validation.uploadId) {
    throw new UnknownError(
      'Tableau validation succeeded but did not return an uploadId to publish.',
    );
  }

  return { status: 'valid', warnings, uploadSessionId: validation.uploadId };
}

/**
 * Tableau's TWB-only validate endpoint cannot resolve extracts embedded in a TWBX package -
 * it only sees the inner .twb XML, whose data source paths only exist inside the zip. TWBX
 * files are uploaded directly and validated by Tableau as part of publishing instead.
 */
async function uploadTwbx({
  restApi,
  resolvedWorkbookFile,
}: {
  restApi: RestApi;
  resolvedWorkbookFile: ResolvedWorkbook;
}): Promise<ValidationOutcome> {
  const uploadSessionId = await restApi.publishingMethods.uploadFileInChunks({
    siteId: restApi.siteId,
    filename: resolvedWorkbookFile.fileName,
    content: resolvedWorkbookFile.bytes,
  });

  return { status: 'valid', warnings: [], uploadSessionId };
}

async function resolveWorkbookInput({
  workbookUploadId,
  workbookFilePath,
  tenant,
}: {
  workbookUploadId?: string;
  workbookFilePath?: string;
  tenant: TenantIdentitySource;
}): Promise<Result<ResolvedWorkbook, McpToolError>> {
  if (workbookUploadId && workbookFilePath) {
    throw new ArgsValidationError('Provide either workbookFilePath or workbookUploadId, not both.');
  }

  if (workbookFilePath) {
    if (isBlobStorageEnabled()) {
      throw new ArgsValidationError(
        'workbookFilePath is only supported when staged uploads are not configured. Call request-workbook-upload first and pass workbookUploadId.',
      );
    }
    return new Ok(await resolveLocalWorkbookFile(workbookFilePath));
  }

  if (!workbookUploadId) {
    throw new ArgsValidationError(
      'Either workbookFilePath or workbookUploadId must be provided. For local MCP servers, pass workbookFilePath. For hosted clients, call request-workbook-upload first and pass workbookUploadId.',
    );
  }
  if (!isBlobStorageEnabled()) {
    throw new UnknownError(
      'Blob storage provider must be configured before publishing staged workbook uploads.',
    );
  }
  const tenantLuids = getTenantLuids(tenant);
  if (tenantLuids.isErr()) {
    return tenantLuids;
  }
  return new Ok(await resolveStagedWorkbookUpload({ workbookUploadId, tenant: tenantLuids.value }));
}

async function resolveLocalWorkbookFile(workbookFilePath: string): Promise<ResolvedWorkbook> {
  const fileName = basename(workbookFilePath);
  if (!getWorkbookFileType(fileName)) {
    throw new ArgsValidationError('workbookFilePath must point to a .twb or .twbx file.');
  }

  const bytes = await readFile(workbookFilePath);
  if (bytes.byteLength === 0) {
    throw new ArgsValidationError('workbookFilePath must not point to an empty workbook file.');
  }

  return { fileName, bytes };
}

function assertMinimumRestApiVersionSupported(): void {
  if (!RestApi.versionIsAtLeast('3.29')) {
    throw new UnknownError(
      `publish-workbook requires Tableau REST API version 3.29 or later (Tableau Server 2026.2+). The connected server is using REST API version ${RestApi.version}.`,
    );
  }
}

// Guidance per documented Publish Workbook error code. Some codes cover several conditions, so
// Tableau's own summary/detail is always appended to tell them apart.
// https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_publishing.htm#publish_workbook
const publishErrorGuidance: Record<string, string> = {
  '400000': 'The publish request was malformed or did not include the uploaded workbook.',
  '400008': 'The publish request contained an invalid true/false value.',
  '400011': 'Tableau could not publish the workbook. Check that the workbook file is valid.',
  '400020': 'The workbook file name must end in .twb or .twbx.',
  '400035': 'The uploaded workbook is missing or is not a .twb or .twbx file.',
  '403007':
    'Tableau refused the publish. You may lack publish permission on the project, a workbook with this name may already exist (set overwrite to true to replace it), or a data source the workbook uses could not be reached.',
  '403008': 'The site does not have enough storage for this workbook.',
  '403130':
    'A workbook with this name already exists. Set overwrite to true to replace it, or choose a different name.',
  '403131': 'Another publish of this workbook is already in progress. Wait and retry.',
  '403132':
    'Tableau could not connect to a data source the workbook uses. Check its connection credentials and that it is reachable from Tableau.',
  '404005': 'The project was not found. Use list-projects to find a valid projectId.',
  '404006':
    'overwrite was true but no workbook with this name exists. Retry with overwrite set to false.',
  '404015': 'The upload session was not found or has expired. Retry publish-workbook.',
};

// Axios's own message ("Request failed with status code 400") drops Tableau's reason, which the
// model needs to correct the publish. 5xx and body-less errors keep the generic path.
function mapPublishWorkbookError(error: unknown): McpToolError | null {
  const parsed = parseTableauApiError(error);
  if (!parsed || parsed.status < 400 || parsed.status >= 500) {
    return null;
  }

  const guidance =
    (parsed.code && publishErrorGuidance[parsed.code]) || 'Tableau rejected the workbook publish.';
  const reason = [parsed.summary, parsed.detail].filter(Boolean).join(': ');
  const tableauError = reason
    ? ` Tableau error${parsed.code ? ` ${parsed.code}` : ''}: ${reason}`
    : '';

  return new McpToolError({
    type: 'publish-rejected',
    message: sanitizeFindingText(`${guidance}${tableauError}`, 2_000),
    statusCode: parsed.status,
  });
}

function toValidationFinding(issue: ValidationIssue): ValidationFinding {
  return {
    severity: sanitizeFindingText(issue.severity, 100),
    message: sanitizeFindingText(issue.message, 2_000),
    line: issue.line,
    column: issue.column,
    elementName: sanitizeFindingText(issue.elementName, 255),
  };
}

function sanitizeFindingText(value: string, maxLength: number): string {
  return Array.from(value)
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || codePoint === 127 ? ' ' : character;
    })
    .join('')
    .slice(0, maxLength);
}
