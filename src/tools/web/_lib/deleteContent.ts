import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import {
  ArgsValidationError,
  DatasourceNotAllowedError,
  McpToolError,
  WorkbookNotAllowedError,
} from '../../../errors/mcpToolError.js';
import { getFeatureGate } from '../../../features/init.js';
import { log } from '../../../logging/logger.js';
import { useRestApi } from '../../../restApiInstance.js';
import {
  DatasourceDownstream,
  getDatasourceDownstreamByLuid,
  getDatasourceDownstreamQuery,
} from '../../../sdks/tableau/methods/lineageUtils.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { WebMcpServer } from '../../../server.web.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { getAppConfig } from '../../../web/apps/appConfig.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { AppToolResult, WebTool } from '../tool.js';
import { TableauWebRequestHandlerExtra } from '../toolContext.js';
import { resolveOwnerEmail } from '../users/resolveOwnerEmail.js';
import {
  AppApprovalEvidence,
  DEFAULT_PENDING_DELETION_TAG,
  getMutationPreviewTtlMs,
  RegistryEvidence,
  TagEvidence,
} from './evidence.js';
import { guardMutation, MutationTarget } from './mutationGuard.js';

export type DeleteWorkbookConfirmPanel = {
  kind: 'delete-workbook-confirm';
  workbookId: string;
  name?: string;
  project?: string;
  owner?: string;
  expiresAtMs: number;
};

export type DeleteDatasourceConfirmPanel = {
  kind: 'delete-datasource-confirm';
  datasourceId: string;
  name?: string;
  project?: string;
  owner?: string;
  expiresAtMs: number;
};

export type DeleteExtractRefreshTaskConfirmPanel = {
  kind: 'delete-extract-refresh-task-confirm';
  taskId: string;
  expiresAtMs: number;
};

/**
 * Dispatches on `resourceType`:
 * - `workbook` — TagEvidence + resourceAccessChecker.isWorkbookAllowed.
 * - `datasource` — TagEvidence + isDatasourceAllowed + downstream warning.
 * - `extract-refresh-task` — RegistryEvidence nonce.
 *
 * Two-phase (preview → confirm):
 * - Flag OFF (`mcp-apps`): preview tags/mints-nonce; confirm re-verifies evidence and deletes.
 * - Flag ON: preview records `AppApprovalEvidence` and returns a confirm-panel payload for the
 *   MCP-Apps iframe. The iframe's Confirm button calls the separate app-only
 *   `confirm-delete-content` tool (visibility:['app'], model-invisible). Model-driven `confirm:true`
 *   on THIS tool is unconditionally rejected with PreviewNotRunError when mcp-apps is enabled.
 */

const RECYCLE_BIN_DOC_URL = 'https://help.tableau.com/current/pro/desktop/en-us/recycle_bin.htm';

const resourceTypeSchema = z.enum(['workbook', 'datasource', 'extract-refresh-task']);

const paramsSchema = {
  resourceType: resourceTypeSchema.describe(
    'The kind of resource to delete: "workbook", "datasource", or "extract-refresh-task".',
  ),
  resourceId: z
    .string()
    .describe(
      'The LUID of the workbook or data source, or the UUID of the extract refresh task. ' +
        'For extract-refresh-task, must be a valid UUID.',
    ),
  confirm: z
    .boolean()
    .optional()
    .describe(
      'When omitted or false, runs a non-destructive preview. When true, permanently deletes — ' +
        'but only if the prior-preview evidence is present (tag for workbook/datasource, ' +
        'confirmationToken for extract-refresh-task). ' +
        'When the `mcp-apps` feature is enabled, model-driven confirm is CLOSED: the destructive ' +
        'step requires a human gesture in the in-iframe confirm panel.',
    ),
  tag: z
    .string()
    .max(200)
    .regex(
      /^[A-Za-z0-9 _-]+$/,
      'tag must contain only letters, numbers, spaces, underscores, and dashes',
    )
    .optional()
    .describe(
      'Only for resourceType="workbook" or "datasource": the pending-deletion tag label. ' +
        `Defaults to '${DEFAULT_PENDING_DELETION_TAG}'.`,
    ),
  confirmationToken: z
    .string()
    .optional()
    .describe(
      'Only for resourceType="extract-refresh-task": the single-use token returned by a prior ' +
        'preview call. Required when confirm is true; ignored otherwise.',
    ),
};

type DeleteContentResult =
  | string
  | AppToolResult<DeleteWorkbookConfirmPanel>
  | AppToolResult<DeleteDatasourceConfirmPanel>
  | AppToolResult<DeleteExtractRefreshTaskConfirmPanel>;

export const getDeleteContentTool = async (
  server: WebMcpServer,
): Promise<WebTool<typeof paramsSchema>> => {
  const config = getConfig();
  const mcpAppsEnabled = await getFeatureGate().isFeatureEnabled('mcp-apps');

  const tool = new WebTool({
    server,
    name: 'delete-content',
    disabled: !config.adminToolsEnabled,
    ...(mcpAppsEnabled ? { app: getAppConfig('delete-content', 'hitl-confirm') } : {}),
    description: `
Permanently deletes a workbook, published data source, or extract refresh task. Restricted to
site administrators (\`ADMIN_TOOLS_ENABLED\`). Dispatches on \`resourceType\`.

Two-phase: preview (\`confirm\` omitted) tags/tokens what would be deleted; confirm (\`confirm:
true\`) permanently deletes after verifying that evidence. Human confirmation is REQUIRED between
the two phases — do not auto-confirm.

Workbooks/datasources go to the recycle bin on Tableau Cloud; extract refresh task deletion is
permanent.
`.trim(),
    paramsSchema,
    annotations: {
      title: 'Delete Tableau Content',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async (
      { resourceType, resourceId, confirm, tag, confirmationToken },
      extra,
    ): Promise<CallToolResult> => {
      const configWithOverrides = await extra.getConfigWithOverrides();

      return await tool.logAndExecute<DeleteContentResult>({
        extra,
        args: { resourceType, resourceId, confirm, tag, confirmationToken },
        callback: async () => {
          // Reject bad resourceId shape before opening a Tableau REST session. Only
          // extract-refresh-task requires a UUID; workbook/datasource accept any LUID string and
          // let the REST call surface a 404 if it's genuinely unknown.
          if (resourceType === 'extract-refresh-task') {
            const uuidCheck = z
              .string()
              .uuid('resourceId must be a valid UUID for extract-refresh-task')
              .safeParse(resourceId);
            if (!uuidCheck.success) {
              return new ArgsValidationError(uuidCheck.error.issues[0].message).toErr();
            }
          }
          return await useRestApi({
            ...extra,
            jwtScopes: tool.requiredApiScopes,
            callback: async (restApi) => {
              switch (resourceType) {
                case 'workbook':
                  return await runWorkbookBranch({
                    restApi,
                    extra,
                    workbookId: resourceId,
                    confirm,
                    tag,
                    mcpAppsEnabled,
                  });
                case 'datasource':
                  return await runDatasourceBranch({
                    restApi,
                    extra,
                    datasourceId: resourceId,
                    confirm,
                    tag,
                    mcpAppsEnabled,
                    disableMetadataApiRequests: configWithOverrides.disableMetadataApiRequests,
                  });
                case 'extract-refresh-task':
                  return await runExtractRefreshTaskBranch({
                    restApi,
                    extra,
                    taskId: resourceId,
                    confirm,
                    confirmationToken,
                    mcpAppsEnabled,
                  });
              }
            },
          });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return tool;
};

async function runWorkbookBranch({
  restApi,
  extra,
  workbookId,
  confirm,
  tag,
  mcpAppsEnabled,
}: {
  restApi: RestApi;
  extra: TableauWebRequestHandlerExtra;
  workbookId: string;
  confirm: boolean | undefined;
  tag: string | undefined;
  mcpAppsEnabled: boolean;
}): Promise<Result<DeleteContentResult, McpToolError>> {
  const siteId = restApi.siteId;
  const pendingTag = tag?.trim() || DEFAULT_PENDING_DELETION_TAG;

  const isWorkbookAllowedResult = await resourceAccessChecker.isWorkbookAllowed({
    workbookId,
    extra,
  });
  if (!isWorkbookAllowedResult.allowed) {
    return new WorkbookNotAllowedError(isWorkbookAllowedResult.message).toErr();
  }

  const resolveTarget = async (): Promise<MutationTarget> => {
    const workbook =
      isWorkbookAllowedResult.content ??
      (await restApi.workbooksMethods.getWorkbook({ workbookId, siteId }));
    const ownerEmail = await resolveOwnerEmail(
      restApi,
      siteId,
      workbook.owner?.id,
      'delete-content',
    );
    return {
      id: workbookId,
      name: workbook.name,
      project: workbook.project?.name,
      owner: ownerEmail ?? undefined,
      kind: 'workbook',
    };
  };

  const guardResult = await guardMutation({
    restApi,
    extra,
    tool: 'delete-content',
    action: 'delete',
    mode: 'preview-confirm',
    phase: confirm ? 'confirm' : 'preview',
    evidence: new TagEvidence({ tag: pendingTag, kind: 'workbook' }),
    resolveTarget,
    fallbackTargetKind: 'workbook',
  });
  if (guardResult.isErr()) {
    return guardResult.error.toErr();
  }
  const { target, recordOutcome } = guardResult.value;
  const projectName = target.project ?? 'unknown project';
  const ownerText = target.owner ? `owner ${target.owner}` : 'owner unknown';

  if (confirm) {
    try {
      await restApi.workbooksMethods.deleteWorkbook({ workbookId, siteId });
    } catch (e) {
      recordOutcome({ ok: false, failureDetail: getExceptionMessage(e) });
      throw e;
    }
    recordOutcome({ ok: true });
    return new Ok<DeleteContentResult>(
      `Deleted workbook '${target.name}' (id ${workbookId}) in '${projectName}', ${ownerText}. ` +
        `It can be restored from the Tableau recycle bin (${RECYCLE_BIN_DOC_URL}) for a limited ` +
        'time before permanent removal.',
    );
  }

  if (mcpAppsEnabled) {
    await new AppApprovalEvidence('delete-content').establish({
      restApi,
      siteId,
      target,
      tool: 'delete-content',
      userLuid: extra.getUserLuid(),
    });
    const expiresAtMs = Date.now() + getMutationPreviewTtlMs();
    return new Ok<DeleteContentResult>({
      data: {
        kind: 'delete-workbook-confirm',
        workbookId,
        name: target.name,
        project: target.project,
        owner: target.owner,
        expiresAtMs,
      },
      url: '',
    });
  }

  return new Ok<DeleteContentResult>(
    `Preview — workbook '${target.name}' (id ${workbookId}) in '${projectName}', ${ownerText}. ` +
      `It has been tagged '${pendingTag}' (reversible). ` +
      'NEXT STEP — REQUIRED: show this workbook (name, project, owner) to the user and ask them ' +
      'to explicitly confirm deleting it. Do NOT delete without the user’s approval. ' +
      'Once approved, call again with confirm: true (the server will verify this ' +
      `'${pendingTag}' tag before deleting). ` +
      `Deleted workbooks are recoverable from the Tableau recycle bin (${RECYCLE_BIN_DOC_URL}) ` +
      'for a limited time.',
  );
}

async function runDatasourceBranch({
  restApi,
  extra,
  datasourceId,
  confirm,
  tag,
  mcpAppsEnabled,
  disableMetadataApiRequests,
}: {
  restApi: RestApi;
  extra: TableauWebRequestHandlerExtra;
  datasourceId: string;
  confirm: boolean | undefined;
  tag: string | undefined;
  mcpAppsEnabled: boolean;
  disableMetadataApiRequests: boolean;
}): Promise<Result<DeleteContentResult, McpToolError>> {
  const siteId = restApi.siteId;
  const pendingTag = tag?.trim() || DEFAULT_PENDING_DELETION_TAG;

  const isDatasourceAllowedResult = await resourceAccessChecker.isDatasourceAllowed({
    datasourceLuid: datasourceId,
    extra,
  });
  if (!isDatasourceAllowedResult.allowed) {
    return new DatasourceNotAllowedError(isDatasourceAllowedResult.message).toErr();
  }

  const resolveTarget = async (): Promise<MutationTarget> => {
    const datasource =
      isDatasourceAllowedResult.content ??
      (await restApi.datasourcesMethods.queryDatasource({ datasourceId, siteId }));
    const ownerEmail = await resolveOwnerEmail(
      restApi,
      siteId,
      datasource.owner?.id,
      'delete-content',
    );
    return {
      id: datasourceId,
      name: datasource.name,
      project: datasource.project?.name,
      owner: ownerEmail ?? undefined,
      kind: 'datasource',
    };
  };

  const guardResult = await guardMutation({
    restApi,
    extra,
    tool: 'delete-content',
    action: 'delete',
    mode: 'preview-confirm',
    phase: confirm ? 'confirm' : 'preview',
    evidence: new TagEvidence({ tag: pendingTag, kind: 'datasource' }),
    resolveTarget,
    fallbackTargetKind: 'datasource',
  });
  if (guardResult.isErr()) {
    return guardResult.error.toErr();
  }
  const { target, recordOutcome } = guardResult.value;
  const projectName = target.project ?? 'unknown project';
  const ownerText = target.owner ? `owner ${target.owner}` : 'owner unknown';

  if (confirm) {
    try {
      await restApi.datasourcesMethods.deleteDatasource({ datasourceId, siteId });
    } catch (e) {
      recordOutcome({ ok: false, failureDetail: getExceptionMessage(e) });
      throw e;
    }
    recordOutcome({ ok: true });
    return new Ok<DeleteContentResult>(
      `Deleted data source '${target.name}' (id ${datasourceId}) in '${projectName}', ${ownerText}. ` +
        `On Tableau Cloud it can be restored from the recycle bin (${RECYCLE_BIN_DOC_URL}) for a ` +
        'limited time before permanent removal; on Tableau Server deletion is permanent. ' +
        'Dependent workbooks and flows were not deleted but no longer have this data source.',
    );
  }

  if (mcpAppsEnabled) {
    await new AppApprovalEvidence('delete-content').establish({
      restApi,
      siteId,
      target,
      tool: 'delete-content',
      userLuid: extra.getUserLuid(),
    });
    const expiresAtMs = Date.now() + getMutationPreviewTtlMs();
    return new Ok<DeleteContentResult>({
      data: {
        kind: 'delete-datasource-confirm',
        datasourceId,
        name: target.name,
        project: target.project,
        owner: target.owner,
        expiresAtMs,
      },
      url: '',
    });
  }

  const dependencyWarning = await describeDownstreamDependencies({
    restApi,
    datasourceId,
    disableMetadataApiRequests,
  });

  return new Ok<DeleteContentResult>(
    `Preview — data source '${target.name}' (id ${datasourceId}) in '${projectName}', ${ownerText}. ` +
      `${dependencyWarning} ` +
      `It has been tagged '${pendingTag}' (reversible). ` +
      'NEXT STEP — REQUIRED: show this data source (name, project, owner) and its dependent ' +
      'content to the user and ask them to explicitly confirm deleting it. Do NOT delete ' +
      'without the user’s approval. ' +
      'Once approved, call again with confirm: true (the server will verify this ' +
      `'${pendingTag}' tag before deleting). ` +
      'On Tableau Cloud deleted data sources are recoverable from the recycle bin ' +
      `(${RECYCLE_BIN_DOC_URL}) for a limited time; on Tableau Server deletion is permanent.`,
  );
}

async function runExtractRefreshTaskBranch({
  restApi,
  extra,
  taskId,
  confirm,
  confirmationToken,
  mcpAppsEnabled,
}: {
  restApi: RestApi;
  extra: TableauWebRequestHandlerExtra;
  taskId: string;
  confirm: boolean | undefined;
  confirmationToken: string | undefined;
  mcpAppsEnabled: boolean;
}): Promise<Result<DeleteContentResult, McpToolError>> {
  const siteId = restApi.siteId;

  const resolveTarget = async (): Promise<MutationTarget> => ({
    id: taskId,
    kind: 'extract-refresh-task',
  });

  const registryEvidence = new RegistryEvidence();

  const guardResult = await guardMutation({
    restApi,
    extra,
    tool: 'delete-content',
    action: 'delete',
    mode: 'preview-confirm',
    phase: confirm ? 'confirm' : 'preview',
    evidence: registryEvidence,
    resolveTarget,
    ...(confirm ? { confirmationToken } : {}),
    fallbackTargetKind: 'extract-refresh-task',
  });
  if (guardResult.isErr()) {
    return guardResult.error.toErr();
  }
  const { recordOutcome } = guardResult.value;

  if (confirm) {
    try {
      await restApi.tasksMethods.deleteExtractRefreshTask({ siteId, taskId });
    } catch (e) {
      recordOutcome({ ok: false, failureDetail: getExceptionMessage(e) });
      throw e;
    }
    recordOutcome({ ok: true });
    return new Ok<DeleteContentResult>(
      `Extract refresh task '${taskId}' has been successfully deleted. The underlying data source ` +
        'or workbook is unaffected, but it will no longer be refreshed on this schedule.',
    );
  }

  if (mcpAppsEnabled) {
    await new AppApprovalEvidence('delete-content').establish({
      restApi,
      siteId,
      target: { id: taskId, kind: 'extract-refresh-task' },
      tool: 'delete-content',
      userLuid: extra.getUserLuid(),
    });
    const expiresAtMs = Date.now() + getMutationPreviewTtlMs();
    return new Ok<DeleteContentResult>({
      data: {
        kind: 'delete-extract-refresh-task-confirm',
        taskId,
        expiresAtMs,
      },
      url: '',
    });
  }

  const nonce = registryEvidence.getEstablishedNonce();
  return new Ok<DeleteContentResult>(
    `Preview — extract refresh task '${taskId}' would be permanently deleted (the underlying data ` +
      'source or workbook is unaffected, but it will no longer be refreshed on this schedule). ' +
      'NEXT STEP — REQUIRED: present this task to the user and ask them to explicitly confirm ' +
      'deleting it. Do NOT delete without the user’s approval. ' +
      `Once approved, call again with confirm: true and confirmationToken: "${nonce}" ` +
      '(the server will verify and consume this single-use token before deleting).',
  );
}

/**
 * Duplicates the downstream-dependency warning logic from deleteDatasource.ts. Best-effort; if the
 * Metadata API is disabled or errors, degrades to a neutral note and never fails the preview.
 */
async function describeDownstreamDependencies({
  restApi,
  datasourceId,
  disableMetadataApiRequests,
}: {
  restApi: RestApi;
  datasourceId: string;
  disableMetadataApiRequests: boolean;
}): Promise<string> {
  if (disableMetadataApiRequests) {
    return 'Dependency check skipped (Metadata API requests are disabled).';
  }

  let downstream: DatasourceDownstream | undefined;
  try {
    const response = await restApi.metadataMethods.graphql(
      getDatasourceDownstreamQuery([datasourceId]),
    );
    downstream = getDatasourceDownstreamByLuid(response).get(datasourceId);
  } catch (error) {
    log({
      message: `delete-content(datasource): downstream dependency check failed for ${datasourceId}`,
      level: 'warning',
      logger: 'delete-content',
      data: getExceptionMessage(error),
    });
    return 'Dependency check unavailable (Metadata API error) — verify dependents manually before deleting.';
  }

  const workbooks = downstream?.workbooks ?? [];
  const flows = downstream?.flows ?? [];
  if (workbooks.length === 0 && flows.length === 0) {
    return 'No workbooks or flows were found that depend on this data source.';
  }

  const parts: string[] = [];
  if (workbooks.length > 0) {
    parts.push(`${workbooks.length} workbook(s): ${formatDependentNames(workbooks)}`);
  }
  if (flows.length > 0) {
    parts.push(`${flows.length} flow(s): ${formatDependentNames(flows)}`);
  }
  return `⚠️ WARNING: deleting this data source may break ${parts.join(' and ')}.`;
}

const MAX_DEPENDENT_NAMES_LISTED = 10;

function formatDependentNames(contents: ReadonlyArray<{ name: string }>): string {
  const names = contents.slice(0, MAX_DEPENDENT_NAMES_LISTED).map((c) => c.name);
  const remaining = contents.length - names.length;
  const listed = names.join(', ');
  return remaining > 0 ? `${listed}, …and ${remaining} more` : listed;
}
