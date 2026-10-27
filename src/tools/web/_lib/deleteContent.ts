import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import {
  ArgsValidationError,
  DatasourceNotAllowedError,
  McpToolError,
  PreviewNotRunError,
  UnknownError,
  WorkbookNotAllowedError,
} from '../../../errors/mcpToolError.js';
import { isAdminToolsEnabled } from '../../../features/adminTools.js';
import { getFeatureGate } from '../../../features/init.js';
import { log } from '../../../logging/logger.js';
import { useRestApi } from '../../../restApiInstance.js';
import { luidSchema } from '../../../sdks/routeSafety/ids.js';
import {
  DatasourceDownstream,
  getDatasourceDownstreamByLuid,
  getDatasourceDownstreamQuery,
} from '../../../sdks/tableau/methods/lineageUtils.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { Provider } from '../../../utils/provider.js';
import { getAppConfig } from '../../../web/apps/appConfig.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { AppToolResult, WebTool } from '../tool.js';
import { TableauWebRequestHandlerExtra } from '../toolContext.js';
import { resolveOwnerEmail } from '../users/resolveOwnerEmail.js';
import {
  AppApprovalEvidence,
  getMutationPreviewTtlMs,
  RegistryEvidence,
  TagEvidence,
} from './evidence.js';
import {
  renderConfirmClosedMessage,
  renderTagDeleteNextStep,
  renderTokenConfirmNextStep,
} from './hitlText.js';
import { guardMutation, MutationTarget } from './mutationGuard.js';
import {
  checkCleanupBatchAge,
  cleanupDateSchema,
  getPendingDeletionMarkers,
  getUtcCleanupDate,
} from './pendingDeletionTag.js';
import {
  MAX_REMOVE_RESOURCE_IDS,
  removePendingDeletionTags,
  RemovePendingDeletionTagsResult,
} from './removePendingDeletionTags.js';
import { resolveExtractRefreshTaskTarget } from './resolveExtractRefreshTaskTarget.js';
import { checkContentStillStale } from './stalenessCheck.js';

export type DeleteWorkbookConfirmPanel = {
  kind: 'delete-workbook-confirm';
  workbookId: string;
  name?: string;
  project?: string;
  owner?: string;
  // The cleanup batch (UTC YYYY-MM-DD) whose `pending-deletion-<date>` tag the preview wrote, and
  // the staleness threshold it was assessed with — the panel echoes both into confirm-delete-content
  // (Confirm) or delete-content action "remove-pending-tags" (Cancel).
  cleanupDate: string;
  minAgeDays: number;
  expiresAtMs: number;
};

export type DeleteDatasourceConfirmPanel = {
  kind: 'delete-datasource-confirm';
  datasourceId: string;
  name?: string;
  project?: string;
  owner?: string;
  // The cleanup batch (UTC YYYY-MM-DD) whose `pending-deletion-<date>` tag the preview wrote, and
  // the staleness threshold it was assessed with — the panel echoes both into confirm-delete-content
  // (Confirm) or delete-content action "remove-pending-tags" (Cancel).
  cleanupDate: string;
  minAgeDays: number;
  expiresAtMs: number;
};

export type DeleteExtractRefreshTaskConfirmPanel = {
  kind: 'delete-extract-refresh-task-confirm';
  taskId: string;
  expiresAtMs: number;
};

/**
 * Dispatches on `resourceType`:
 * - `workbook` — batch TagEvidence + staleness precondition + resourceAccessChecker.isWorkbookAllowed.
 * - `datasource` — batch TagEvidence + staleness precondition + isDatasourceAllowed + downstream
 *   warning.
 * - `extract-refresh-task` — RegistryEvidence nonce.
 *
 * Two-phase (preview → confirm). The branch is chosen by whether an MCP-Apps card can ACTUALLY
 * render for THIS client (`extra.mcpAppToolsRenderable` — the feature is on AND the client advertised
 * the UI capability AND it is not a known-incompatible renderer), NOT by the `mcp-apps` flag alone:
 * - Not app-renderable (flag off, OR flag on but an app-incapable client): preview tags
 *   (workbook/datasource) or mints a nonce (extract-refresh-task) and returns a readable TEXT
 *   preview; confirm re-verifies that evidence and deletes. This is the path an app-incapable client
 *   takes even with `mcp-apps` on, so it never receives an unrenderable app-card payload (W-24212898).
 * - App-renderable: preview records `AppApprovalEvidence` and returns a confirm-panel payload for the
 *   MCP-Apps iframe. The iframe's Confirm button calls the separate app-only
 *   `confirm-delete-content` tool (visibility:['app'], model-invisible). Model-driven `confirm:true`
 *   on THIS tool is unconditionally rejected with PreviewNotRunError only when the card can render.
 *
 * Workbook/datasource batch identity (W-24311035): the preview writes `pending-deletion-<today UTC>`
 * and a confirm verifies the tag of the batch it names via `cleanupDate` (default: today), so a
 * marker from an earlier abandoned preview cannot silently authorize a later deletion. Both phases
 * re-evaluate staleness against Admin Insights (checkContentStillStale) — the preview BEFORE it
 * tags, so non-stale content is rejected with no residue.
 */

const RECYCLE_BIN_DOC_URL = 'https://help.tableau.com/current/pro/desktop/en-us/recycle_bin.htm';

/**
 * Human phrase for a target's containing project. `target.project` is the project NAME resolved from
 * the content's REST response (getWorkbook / queryDatasource), which returns a `<project id name>`
 * element for project-resident content and OMITS it entirely for content that has no project — e.g. a
 * workbook in a user's Personal Space (verified live: the same getWorkbook call returns the project
 * name for a project-resident workbook and no project at all for a Personal-Space one). This
 * distinguishes a named project from a genuinely project-less item, instead of the previous
 * misleading "unknown project" wording (which read as a lookup failure when the item simply has no
 * project). Shared by delete-content and confirm-delete-content so both surfaces phrase it identically.
 */
export function formatProjectPhrase(project: string | undefined): string {
  return project ? `in project '${project}'` : 'in no project (e.g. a Personal Space item)';
}

const resourceTypeSchema = z.enum(['workbook', 'datasource', 'extract-refresh-task']);

const actionSchema = z.enum(['delete', 'remove-pending-tags']);

const paramsSchema = {
  action: actionSchema
    .optional()
    .describe(
      '"delete" (default): the preview → confirm deletion flow. "remove-pending-tags": remove ' +
        'pending-deletion marker tags from resourceIds; nothing is deleted.',
    ),
  resourceType: resourceTypeSchema.describe(
    'The kind of resource: "workbook", "datasource", or "extract-refresh-task" (not valid for ' +
      'action "remove-pending-tags").',
  ),
  resourceId: luidSchema
    .optional()
    .describe(
      'Required for action "delete": the LUID of the workbook or data source, or the UUID of the ' +
        'extract refresh task.',
    ),
  resourceIds: z
    .array(luidSchema)
    .min(1)
    .max(MAX_REMOVE_RESOURCE_IDS)
    .optional()
    .describe(
      'Only for action "remove-pending-tags": LUIDs of the workbooks or data sources to clear ' +
        `(1–${MAX_REMOVE_RESOURCE_IDS}).`,
    ),
  confirm: z
    .boolean()
    .optional()
    .describe(
      'When omitted or false, runs a preview: nothing is deleted, but a workbook/datasource gets a ' +
        'reversible pending-deletion-YYYY-MM-DD marker tag. When true, permanently deletes — but ' +
        'only if the prior-preview evidence is present (batch tag for workbook/datasource, ' +
        'confirmationToken for extract-refresh-task). ' +
        'When the `mcp-apps` feature is enabled, model-driven confirm is CLOSED: the destructive ' +
        'step requires a human gesture in the in-iframe confirm panel.',
    ),
  cleanupDate: cleanupDateSchema
    .optional()
    .describe(
      'Only for resourceType="workbook" or "datasource": the cleanup batch date (YYYY-MM-DD, UTC) ' +
        'returned by the preview. On confirm, defaults to today; pass it when confirming on a ' +
        'later day (batches older than the server limit, default 30 days, are rejected). A preview ' +
        'always uses today\'s date. With action "remove-pending-tags": remove only that batch\'s ' +
        'marker (default: every pending-deletion marker on each item, including the legacy undated ' +
        'tag).',
    ),
  minAgeDays: z
    .number()
    .int()
    .min(1)
    .max(3650)
    .optional()
    .describe(
      'Only for resourceType="workbook" or "datasource": minimum days since last access for the ' +
        'item to still count as stale. Defaults to the server stale-content threshold (90).',
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
  | RemovePendingDeletionTagsResult
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
    disabled: new Provider(async () => !(await isAdminToolsEnabled(config))),
    minRequiredRole: SiteRole.EXPLORER_CAN_PUBLISH,
    ...(mcpAppsEnabled ? { app: getAppConfig('delete-content', 'hitl-confirm') } : {}),
    description: `
Permanently deletes a workbook, published data source, or extract refresh task. Restricted to
site administrators (\`ADMIN_TOOLS_ENABLED\`). Dispatches on \`resourceType\`.

Two-phase: preview (\`confirm\` omitted) tags/tokens what would be deleted; confirm (\`confirm:
true\`) permanently deletes after verifying that evidence. Human confirmation is REQUIRED between
the two phases — do not auto-confirm.

Workbooks/datasources must still be stale per Admin Insights at preview AND confirm. Preview tags
them \`pending-deletion-YYYY-MM-DD\` (UTC); confirm accepts only that batch's tag.

Find markers with \`list-workbooks\` / \`list-datasources\` (\`filter: tags:eq:pending-deletion-YYYY-MM-DD\`).
Clear them with \`action: "remove-pending-tags"\` and \`resourceIds\`; this removes only marker tags and
deletes nothing.

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
      {
        action,
        resourceType,
        resourceId,
        resourceIds,
        confirm,
        cleanupDate,
        minAgeDays,
        confirmationToken,
      },
      extra,
    ): Promise<CallToolResult> => {
      const configWithOverrides = await extra.getConfigWithOverrides();
      const today = getUtcCleanupDate();
      const batchDate = cleanupDate ?? today;
      const thresholdDays = minAgeDays ?? configWithOverrides.staleContentMinAgeDays;

      return await tool.logAndExecute<DeleteContentResult>({
        extra,
        args: {
          action,
          resourceType,
          resourceId,
          resourceIds,
          confirm,
          cleanupDate,
          minAgeDays,
          confirmationToken,
        },
        callback: async () => {
          if (action === 'remove-pending-tags') {
            const invalid = validateRemovePendingTagsArgs({
              resourceType,
              resourceId,
              resourceIds,
              confirm,
              minAgeDays,
              confirmationToken,
            });
            if (invalid) {
              return invalid.toErr();
            }
            return await useRestApi({
              ...extra,
              jwtScopes: tool.requiredApiScopes,
              callback: async (restApi) =>
                await removePendingDeletionTags({
                  restApi,
                  extra,
                  resourceType: resourceType as 'workbook' | 'datasource',
                  resourceIds: resourceIds ?? [],
                  cleanupDate,
                }),
            });
          }
          if (resourceId === undefined || resourceIds !== undefined) {
            return new ArgsValidationError(
              'action "delete" requires resourceId and does not accept resourceIds; use action ' +
                '"remove-pending-tags" to clear markers from several items.',
            ).toErr();
          }
          const targetId: string = resourceId;
          // A preview always opens TODAY's batch: back-dating it would let a new preview mint the
          // tag an older batch's confirm accepts. (Future dates are rejected by the schema.)
          if (!confirm && resourceType !== 'extract-refresh-task' && batchDate !== today) {
            return new ArgsValidationError(
              `cleanupDate must be today's UTC date (${today}) for a preview; pass an earlier ` +
                'cleanupDate only with confirm: true.',
            ).toErr();
          }
          // Whether an MCP-Apps confirm card can ACTUALLY render for THIS client — not merely whether
          // the `mcp-apps` flag is on. A flag-on-but-app-incapable client is registered as a PLAIN
          // tool, so returning the app-card payload here would degrade to an unreadable raw JSON blob
          // (W-24212898). Keying the app path on this signal makes such a client fall through to the
          // readable text/token flow instead. Defaults to false when the signal is absent.
          const appRenderable = extra.mcpAppToolsRenderable ?? false;
          // A batch past PENDING_DELETION_MAX_AGE_DAYS no longer authorizes a delete, so a marker
          // orphaned by a crashed or abandoned preview expires on its own. Checked before any REST
          // call; the marker is left for action "remove-pending-tags". (App clients get the
          // confirm-closed message below instead.)
          if (confirm && !appRenderable && resourceType !== 'extract-refresh-task') {
            const expired = checkCleanupBatchAge({
              cleanupDate: batchDate,
              maxAgeDays: getConfig().pendingDeletionMaxAgeDays,
            });
            if (expired) {
              return expired.toErr();
            }
          }
          return await useRestApi({
            ...extra,
            jwtScopes: tool.requiredApiScopes,
            callback: async (restApi) => {
              if (confirm && appRenderable) {
                return new PreviewNotRunError(
                  renderConfirmClosedMessage({
                    actionPhrase: `deleting a ${resourceType}`,
                    panelName: 'the approval panel',
                    previewTool: 'delete-content',
                    appliedClause: 'the deletion is performed only when a person clicks Delete',
                  }),
                ).toErr();
              }
              switch (resourceType) {
                case 'workbook':
                  return await runWorkbookBranch({
                    restApi,
                    extra,
                    workbookId: targetId,
                    confirm,
                    cleanupDate: batchDate,
                    minAgeDays: thresholdDays,
                    appRenderable,
                  });
                case 'datasource':
                  return await runDatasourceBranch({
                    restApi,
                    extra,
                    datasourceId: targetId,
                    confirm,
                    cleanupDate: batchDate,
                    minAgeDays: thresholdDays,
                    appRenderable,
                    disableMetadataApiRequests: configWithOverrides.disableMetadataApiRequests,
                  });
                case 'extract-refresh-task':
                  return await runExtractRefreshTaskBranch({
                    restApi,
                    extra,
                    taskId: targetId,
                    confirm,
                    confirmationToken,
                    appRenderable,
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

/**
 * Per-action argument rules for the flat `delete-content` schema. A parameter that does not apply to
 * the chosen action is rejected, never ignored — most importantly `confirm`, so that
 * `{ action: "remove-pending-tags", confirm: true }` can never be read as a deletion.
 */
function validateRemovePendingTagsArgs({
  resourceType,
  resourceId,
  resourceIds,
  confirm,
  minAgeDays,
  confirmationToken,
}: {
  resourceType: z.infer<typeof resourceTypeSchema>;
  resourceId: string | undefined;
  resourceIds: string[] | undefined;
  confirm: boolean | undefined;
  minAgeDays: number | undefined;
  confirmationToken: string | undefined;
}): ArgsValidationError | null {
  if (resourceType === 'extract-refresh-task') {
    return new ArgsValidationError(
      'action "remove-pending-tags" supports resourceType "workbook" or "datasource" only; ' +
        'extract refresh tasks carry no tags.',
    );
  }
  if (!resourceIds || resourceIds.length === 0) {
    return new ArgsValidationError('action "remove-pending-tags" requires resourceIds.');
  }
  const unsupported = [
    resourceId !== undefined && 'resourceId',
    confirm !== undefined && 'confirm',
    minAgeDays !== undefined && 'minAgeDays',
    confirmationToken !== undefined && 'confirmationToken',
  ].filter((name): name is string => typeof name === 'string');
  if (unsupported.length > 0) {
    return new ArgsValidationError(
      `action "remove-pending-tags" does not accept ${unsupported.join(', ')}. It only removes ` +
        'marker tags and never deletes content.',
    );
  }
  return null;
}

async function runWorkbookBranch({
  restApi,
  extra,
  workbookId,
  confirm,
  cleanupDate,
  minAgeDays,
  appRenderable,
}: {
  restApi: RestApi;
  extra: TableauWebRequestHandlerExtra;
  workbookId: string;
  confirm: boolean | undefined;
  cleanupDate: string;
  minAgeDays: number;
  appRenderable: boolean;
}): Promise<Result<DeleteContentResult, McpToolError>> {
  const siteId = restApi.siteId;
  const tagEvidence = new TagEvidence({ cleanupDate, kind: 'workbook' });
  const pendingTag = tagEvidence.getPendingTag();
  let currentTags: Parameters<typeof getPendingDeletionMarkers>[0];

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
    currentTags = workbook.tags;
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
    evidence: tagEvidence,
    resolveTarget,
    fallbackTargetKind: 'workbook',
    precondition: () =>
      checkContentStillStale({
        restApi,
        resourceType: 'workbook',
        resourceId: workbookId,
        minAgeDays,
        cleanupDate,
      }),
  });
  if (guardResult.isErr()) {
    return guardResult.error.toErr();
  }
  const { target, recordOutcome } = guardResult.value;
  const projectPhrase = formatProjectPhrase(target.project);
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
      `Deleted workbook '${target.name}' (id ${workbookId}) ${projectPhrase}, ${ownerText}. ` +
        `It can be restored from the Tableau recycle bin (${RECYCLE_BIN_DOC_URL}) for a limited ` +
        'time before permanent removal.',
    );
  }

  if (appRenderable) {
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
        cleanupDate,
        minAgeDays,
        expiresAtMs,
      },
      url: '',
    });
  }

  return new Ok<DeleteContentResult>(
    `Preview — workbook '${target.name}' (id ${workbookId}) ${projectPhrase}, ${ownerText}. ` +
      describeMarkerWrite({ pendingTag, cleanupDate, currentTags }) +
      renderTagDeleteNextStep({
        subject: 'show this workbook (name, project, owner)',
        pendingTag,
        cleanupDate,
        resourceType: 'workbook',
        resourceId: workbookId,
      }) +
      `Deleted workbooks are recoverable from the Tableau recycle bin (${RECYCLE_BIN_DOC_URL}) ` +
      'for a limited time.',
  );
}

async function runDatasourceBranch({
  restApi,
  extra,
  datasourceId,
  confirm,
  cleanupDate,
  minAgeDays,
  appRenderable,
  disableMetadataApiRequests,
}: {
  restApi: RestApi;
  extra: TableauWebRequestHandlerExtra;
  datasourceId: string;
  confirm: boolean | undefined;
  cleanupDate: string;
  minAgeDays: number;
  appRenderable: boolean;
  disableMetadataApiRequests: boolean;
}): Promise<Result<DeleteContentResult, McpToolError>> {
  const siteId = restApi.siteId;
  const tagEvidence = new TagEvidence({ cleanupDate, kind: 'datasource' });
  const pendingTag = tagEvidence.getPendingTag();
  let currentTags: Parameters<typeof getPendingDeletionMarkers>[0];

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
    currentTags = datasource.tags;
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
    evidence: tagEvidence,
    resolveTarget,
    fallbackTargetKind: 'datasource',
    precondition: () =>
      checkContentStillStale({
        restApi,
        resourceType: 'datasource',
        resourceId: datasourceId,
        minAgeDays,
        cleanupDate,
      }),
  });
  if (guardResult.isErr()) {
    return guardResult.error.toErr();
  }
  const { target, recordOutcome } = guardResult.value;
  const projectPhrase = formatProjectPhrase(target.project);
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
      `Deleted data source '${target.name}' (id ${datasourceId}) ${projectPhrase}, ${ownerText}. ` +
        `On Tableau Cloud it can be restored from the recycle bin (${RECYCLE_BIN_DOC_URL}) for a ` +
        'limited time before permanent removal; on Tableau Server deletion is permanent. ' +
        'Dependent workbooks and flows were not deleted but no longer have this data source.',
    );
  }

  if (appRenderable) {
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
        cleanupDate,
        minAgeDays,
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
    `Preview — data source '${target.name}' (id ${datasourceId}) ${projectPhrase}, ${ownerText}. ` +
      `${dependencyWarning} ` +
      describeMarkerWrite({ pendingTag, cleanupDate, currentTags }) +
      renderTagDeleteNextStep({
        subject: 'show this data source (name, project, owner) and its dependent content',
        pendingTag,
        cleanupDate,
        resourceType: 'datasource',
        resourceId: datasourceId,
      }) +
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
  appRenderable,
}: {
  restApi: RestApi;
  extra: TableauWebRequestHandlerExtra;
  taskId: string;
  confirm: boolean | undefined;
  confirmationToken: string | undefined;
  appRenderable: boolean;
}): Promise<Result<DeleteContentResult, McpToolError>> {
  const siteId = restApi.siteId;

  // Confirm existence BEFORE the guard mints a nonce. Unlike the workbook/datasource branches (whose
  // resolveTarget reads the target via getWorkbook/queryDatasource, so a missing resource 404s before
  // any evidence is established), the task branch has no single-get endpoint — so list-and-find is the
  // only existence check available. Run it unconditionally (preview AND confirm) to stay symmetric
  // with the sibling branches and to keep the guard from minting a confirmationToken for a task that
  // does not exist on this site.
  const tasks = await restApi.tasksMethods.listExtractRefreshTasks({ siteId });
  if (!tasks.some((task) => task.id === taskId)) {
    return new UnknownError(
      `Extract refresh task '${taskId}' not found. Deleting an extract refresh task is Tableau ` +
        "Cloud only — verify you're connected to a Cloud site (not Server) and that the taskId " +
        'came from list-extract-refresh-tasks.',
      404,
    ).toErr();
  }

  // Enrich the audit target with the underlying content's name/project/owner (AC-3). The already-
  // fetched `tasks` list carries only the underlying content id, so this pays ONE content lookup +
  // ONE owner lookup on the preview/confirm path — the same cost the workbook/datasource branches
  // already pay. The shared helper is best-effort: a lookup failure degrades to an id-only target and
  // never fails the mutation. Feed it the already-fetched `tasks` to avoid re-listing.
  const resolveTarget = async (): Promise<MutationTarget> =>
    resolveExtractRefreshTaskTarget({
      restApi,
      siteId,
      taskId,
      logger: 'delete-content',
      tasks,
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

  if (appRenderable) {
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
      renderTokenConfirmNextStep({
        subject: 'present this task',
        approvalClause: 'confirm deleting it. Do NOT delete',
        nonce,
        tail: ' before deleting).',
      }),
  );
}

/**
 * The preview's honest account of its one write (W-24199845): nothing was deleted, the item now
 * carries this batch's marker, and any markers from OTHER batches (which do not authorize this one)
 * are named so the admin can clear them. `currentTags` is the item as read before the preview tagged.
 */
function describeMarkerWrite({
  pendingTag,
  cleanupDate,
  currentTags,
}: {
  pendingTag: string;
  cleanupDate: string;
  currentTags: Parameters<typeof getPendingDeletionMarkers>[0];
}): string {
  const others = getPendingDeletionMarkers(currentTags)
    .map((m) => m.tag)
    .filter((t) => t !== pendingTag);
  const otherText =
    others.length > 0
      ? `It also carries ${others.map((t) => `'${t}'`).join(', ')} from an earlier cleanup ` +
        'batch; those markers do not authorize this deletion and can be cleared with ' +
        'delete-content action "remove-pending-tags". '
      : '';
  return (
    'Nothing has been deleted. The item is still stale and has been marked with the reversible ' +
    `tag '${pendingTag}' (cleanup batch ${cleanupDate}, UTC). ${otherText}`
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
