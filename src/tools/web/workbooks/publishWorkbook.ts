import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { readFile } from 'fs/promises';
import { basename } from 'path';
import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import {
  ArgsValidationError,
  FeatureDisabledError,
  McpToolError,
  ProjectNotAllowedError,
  UnknownError,
} from '../../../errors/mcpToolError.js';
import { getFeatureGate } from '../../../features/init.js';
import { BoundedContext } from '../../../overridableConfig.js';
import { useRestApi } from '../../../restApiInstance.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { parseTableauApiError } from '../../../sdks/tableau/tableauApiError.js';
import { PersonalSpace } from '../../../sdks/tableau/types/personalSpace.js';
import { Site } from '../../../sdks/tableau/types/site.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { Workbook } from '../../../sdks/tableau/types/workbook.js';
import { ValidationIssue } from '../../../sdks/tableau/types/workbookValidation.js';
import { WebMcpServer } from '../../../server.web.js';
import {
  PUBLISH_WORKBOOK_BASE_API_SCOPES,
  PUBLISH_WORKBOOK_PERSONAL_SPACE_API_SCOPE,
  TableauApiScope,
} from '../../../server/oauth/scopes.js';
import { isSlackClient } from '../../../telemetry/clientDisplayName.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { Provider } from '../../../utils/provider.js';
import { type BucketS3Config } from '../s3Client.js';
import { WebTool } from '../tool.js';
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
      'Path to a local TWB or TWBX workbook file on the MCP server filesystem. Only supported when staged S3 uploads are not configured.',
    ),
  name: z.string().min(1).describe('The name to give the published workbook.'),
  projectId: z
    .string()
    .min(1)
    .optional()
    .describe(
      'The Tableau project LUID to publish the workbook into. Use list-projects to discover available project IDs. If omitted, the workbook is published to your Personal Space when the site supports it; an explicit value always takes precedence.',
    ),
  overwrite: z
    .boolean()
    .default(false)
    .describe(
      'Whether to overwrite an existing workbook with the same name in the target project. Defaults to false.',
    ),
};

export type PublishWorkbookResult =
  | {
      status: 'published';
      data: Workbook;
      url: string;
      warnings: ValidationFinding[];
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

export const getPublishWorkbookTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'publish-workbook',
    minRequiredRole: SiteRole.EXPLORER_CAN_PUBLISH,
    description:
      'Publishes a TWB or TWBX workbook from a local file path or staged upload id to a Tableau project. Provide projectId to choose the target project (use list-projects to discover IDs); omit it to publish to your Personal Space when the site supports it, otherwise projectId is required. TWB workbooks are validated up front and uploaded only when validation succeeds, with any blocking errors returned instead of publishing. TWBX workbooks are uploaded directly and validated by Tableau as part of publishing, since Tableau cannot pre-validate extracts packaged inside a TWBX.',
    paramsSchema,
    annotations: {
      title: 'Publish Workbook',
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
      { workbookUploadId, workbookFilePath, name, projectId, overwrite = false },
      extra,
    ): Promise<CallToolResult> => {
      return await tool.logAndExecute<PublishWorkbookResult>({
        extra,
        args: {
          workbookUploadId: workbookUploadId ? '<redacted>' : undefined,
          workbookFilePath: workbookFilePath ? '<redacted>' : undefined,
          name,
          projectId,
          overwrite,
        },
        callback: async () => {
          assertMinimumRestApiVersionSupported();
          const configWithOverrides = await extra.getConfigWithOverrides();
          // Only an explicit projectId is gated by the bounded-context allow-list. The
          // auto-default path resolves the caller's own Personal Space, which an operator's
          // "publish only into these shared projects" allow-list is not meant to block
          // (intentional, confirmed asymmetry — do not make symmetric).
          if (projectId !== undefined) {
            assertProjectAllowedByBoundedContext(projectId, configWithOverrides.boundedContext);
          }

          // Compute the JWT scopes actually needed for THIS call. The tool's static max set
          // advertises the personal-space scope for the MCP-layer gate, but Connected Apps reject
          // a JWT requesting an un-granted scope, so an explicit-projectId call (which never
          // touches Personal Space) must not request it.
          const tableauApiScopes: TableauApiScope[] = [...PUBLISH_WORKBOOK_BASE_API_SCOPES];
          if (!projectId) {
            tableauApiScopes.push(PUBLISH_WORKBOOK_PERSONAL_SPACE_API_SCOPE);
          }

          const result = await useRestApi<Result<PublishWorkbookResult, McpToolError>>({
            ...extra,
            jwtScopes: tableauApiScopes,
            callback: async (restApi) => {
              // Resolve Personal Space up front on the auto-default path so a read-only or
              // unresolvable space fails before uploading anything.
              let personalSpace: PersonalSpace | undefined;
              if (projectId === undefined) {
                const resolvedPersonalSpace = await resolvePersonalSpace(restApi);
                if (resolvedPersonalSpace.isErr()) {
                  return resolvedPersonalSpace;
                }
                personalSpace = resolvedPersonalSpace.value;
              }

              const resolvedWorkbookFile = await resolveWorkbookInput({
                config: extra.config.bucketS3,
                workbookUploadId,
                workbookFilePath,
              });
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
                personalSpace !== undefined
                  ? { location: { id: personalSpace.luid, type: 'PersonalSpace' as const } }
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
                  personalSpace !== undefined ? mapPersonalSpacePublishError(error) : null;
                if (mapped) {
                  return mapped.toErr();
                }
                throw error;
              }

              // Some servers accept the <location> element but silently land the workbook in a
              // default project instead. Treat a personal-space publish that didn't come back as
              // PersonalSpace as a failure, not a silent success.
              if (
                personalSpace !== undefined &&
                publishedWorkbook.location?.type !== 'PersonalSpace'
              ) {
                const landed = publishedWorkbook.project?.name ?? publishedWorkbook.location?.name;
                return new UnknownError(
                  'This Tableau site published the workbook to ' +
                    (landed ? `the "${landed}" project` : 'a project') +
                    ' instead of your personal space — its REST API does not support ' +
                    'personal-space publishing. Delete it there if unwanted, or publish to a ' +
                    'project explicitly by passing projectId.',
                ).toErr();
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

          return result;
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
  config,
  workbookUploadId,
  workbookFilePath,
}: {
  config: BucketS3Config & { enabled: boolean };
  workbookUploadId?: string;
  workbookFilePath?: string;
}): Promise<ResolvedWorkbook> {
  if (workbookUploadId && workbookFilePath) {
    throw new ArgsValidationError('Provide either workbookFilePath or workbookUploadId, not both.');
  }

  if (workbookFilePath) {
    if (config.enabled) {
      throw new ArgsValidationError(
        'workbookFilePath is only supported when staged S3 uploads are not configured. Call request-workbook-upload first and pass workbookUploadId.',
      );
    }
    return await resolveLocalWorkbookFile(workbookFilePath);
  }

  if (!workbookUploadId) {
    throw new ArgsValidationError(
      'Either workbookFilePath or workbookUploadId must be provided. For local MCP servers, pass workbookFilePath. For hosted clients, call request-workbook-upload first and pass workbookUploadId.',
    );
  }
  if (!config.enabled) {
    throw new UnknownError(
      'MCP_S3_BUCKET must be configured before publishing staged workbook uploads.',
    );
  }
  return await resolveStagedWorkbookUpload({
    workbookUploadId,
    config,
  });
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

async function resolvePersonalSpace(
  restApi: RestApi,
): Promise<Result<PersonalSpace, McpToolError>> {
  // Check the site-level capability before resolving the caller's own space: a site with
  // Personal Space turned off entirely has no /personalSpace resource to find, so checking
  // first avoids a doomed-to-404 round trip and gives a clearer, named reason. This does NOT
  // subsume the separate "direct publish to personal space" site setting below — that gate
  // isn't visible on the site resource and only surfaces as a 400000 at publish time (see
  // mapPersonalSpacePublishError).
  let site: Site;
  try {
    site = await restApi.sitesMethods.getSite({ siteId: restApi.siteId });
  } catch (error) {
    return new ArgsValidationError(
      `projectId is required: could not determine whether Personal Space is enabled for this site (${getExceptionMessage(error)}).`,
    ).toErr();
  }

  if (!site.personalSpaceEnabled) {
    return new ArgsValidationError(
      'projectId is required: Personal Space is not enabled for this site.',
    ).toErr();
  }

  let personalSpace: PersonalSpace;
  try {
    personalSpace = await restApi.personalSpaceMethods.getPersonalSpace({
      siteId: restApi.siteId,
    });
  } catch (error) {
    return new ArgsValidationError(
      `projectId is required: could not resolve your Personal Space to use as a default publish target (${getExceptionMessage(error)}).`,
    ).toErr();
  }

  if (personalSpace.readOnly) {
    return new ArgsValidationError(
      'projectId is required: your Personal Space is read-only and cannot be used as a publish target.',
    ).toErr();
  }

  return new Ok(personalSpace);
}

// Map the server's "personal-space publish is disabled for this site" gate (code 400000 with a
// detail mentioning personal space) to a clean tool error, or null so the caller rethrows to the
// generic handler.
function mapPersonalSpacePublishError(error: unknown): FeatureDisabledError | null {
  const parsed = parseTableauApiError(error);
  if (
    parsed?.status === 400 &&
    parsed.code === '400000' &&
    parsed.detail?.toLowerCase().includes('personal space')
  ) {
    return new FeatureDisabledError(
      'Publishing directly to a personal space is not enabled for this Tableau site. Publish to a ' +
        'project instead by passing projectId, or ask a site administrator to enable ' +
        'personal-space publishing.',
    );
  }
  return null;
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
