import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import { getFeatureGate } from '../../../features/init.js';
import { useRestApi } from '../../../restApiInstance.js';
import { WebMcpServer } from '../../../server.web.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { Provider } from '../../../utils/provider.js';
import { WebTool } from '../tool.js';
import { resolveOwnerEmail } from '../users/resolveOwnerEmail.js';
import { AllEvidence, AppApprovalEvidence, TagEvidence } from './evidence.js';
import { guardMutation, MutationTarget } from './mutationGuard.js';

const resourceTypeSchema = z.enum(['workbook', 'datasource', 'extract-refresh-task']);

const paramsSchema = {
  resourceType: resourceTypeSchema.describe(
    'The kind of resource to delete: "workbook", "datasource", or "extract-refresh-task".',
  ),
  resourceId: z
    .string()
    .describe('The LUID of the workbook or data source, or the UUID of the extract refresh task.'),
  tag: z
    .string()
    .max(200)
    .regex(
      /^[A-Za-z0-9 _-]+$/,
      'tag must contain only letters, numbers, spaces, underscores, and dashes',
    )
    .optional()
    .describe(
      'Only for resourceType="workbook" or "datasource": the pending-deletion tag label used in the preview.',
    ),
};

export const getConfirmDeleteContentTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const config = getConfig();

  const confirmDeleteContentTool = new WebTool({
    server,
    name: 'confirm-delete-content',
    disabled: new Provider(
      async () =>
        !config.adminToolsEnabled || !(await getFeatureGate().isFeatureEnabled('mcp-apps')),
    ),
    description: `
Confirms and executes a content deletion previously previewed by \`delete-content\`. This tool is
**not visible to the model** — it is invoked only by an explicit human confirmation gesture inside
the rendered MCP App interface, never by the assistant.

Before executing the deletion, the server re-verifies that a human approved it in the App within the
allowed time window. If the check fails the deletion is rejected and the user must preview again.
`.trim(),
    paramsSchema,
    annotations: {
      title: 'Confirm Delete Content',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    meta: {
      ui: {
        visibility: ['app'],
      },
    },
    callback: async (args, extra): Promise<CallToolResult> => {
      return await confirmDeleteContentTool.logAndExecute<string>({
        extra,
        args,
        callback: async () => {
          return await useRestApi({
            ...extra,
            jwtScopes: confirmDeleteContentTool.requiredApiScopes,
            callback: async (restApi) => {
              const { resourceType, resourceId } = args;
              const siteId = restApi.siteId;

              switch (resourceType) {
                case 'workbook': {
                  const resolveTarget = async (): Promise<MutationTarget> => {
                    const workbook = await restApi.workbooksMethods.getWorkbook({
                      workbookId: resourceId,
                      siteId,
                    });
                    const ownerEmail = await resolveOwnerEmail(
                      restApi,
                      siteId,
                      workbook.owner?.id,
                      'confirm-delete-content',
                    );
                    return {
                      id: resourceId,
                      name: workbook.name,
                      project: workbook.project?.name,
                      owner: ownerEmail ?? undefined,
                      kind: 'workbook',
                    };
                  };

                  const guardResult = await guardMutation({
                    restApi,
                    extra,
                    tool: 'confirm-delete-content',
                    previewTool: 'delete-content',
                    action: 'delete',
                    mode: 'preview-confirm',
                    phase: 'confirm',
                    evidence: new AllEvidence([
                      new TagEvidence({ tag: args.tag ?? '', kind: 'workbook' }),
                      new AppApprovalEvidence('delete-content'),
                    ]),
                    resolveTarget,
                    fallbackTargetKind: 'workbook',
                  });
                  if (guardResult.isErr()) {
                    return guardResult.error.toErr();
                  }
                  const { target, recordOutcome } = guardResult.value;

                  try {
                    await restApi.workbooksMethods.deleteWorkbook({
                      workbookId: resourceId,
                      siteId,
                    });
                  } catch (e) {
                    recordOutcome({ ok: false, failureDetail: getExceptionMessage(e) });
                    throw e;
                  }
                  recordOutcome({ ok: true });

                  const projectName = target.project ?? 'unknown project';
                  const ownerText = target.owner ? `owner ${target.owner}` : 'owner unknown';
                  return new Ok(
                    `Deleted workbook '${target.name}' (id ${resourceId}) in '${projectName}', ${ownerText}. ` +
                      'It can be restored from the Tableau recycle bin for a limited time before permanent removal.',
                  );
                }

                case 'datasource': {
                  const resolveTarget = async (): Promise<MutationTarget> => {
                    const datasource = await restApi.datasourcesMethods.queryDatasource({
                      datasourceId: resourceId,
                      siteId,
                    });
                    const ownerEmail = await resolveOwnerEmail(
                      restApi,
                      siteId,
                      datasource.owner?.id,
                      'confirm-delete-content',
                    );
                    return {
                      id: resourceId,
                      name: datasource.name,
                      project: datasource.project?.name,
                      owner: ownerEmail ?? undefined,
                      kind: 'datasource',
                    };
                  };

                  const guardResult = await guardMutation({
                    restApi,
                    extra,
                    tool: 'confirm-delete-content',
                    previewTool: 'delete-content',
                    action: 'delete',
                    mode: 'preview-confirm',
                    phase: 'confirm',
                    evidence: new AllEvidence([
                      new TagEvidence({ tag: args.tag ?? '', kind: 'datasource' }),
                      new AppApprovalEvidence('delete-content'),
                    ]),
                    resolveTarget,
                    fallbackTargetKind: 'datasource',
                  });
                  if (guardResult.isErr()) {
                    return guardResult.error.toErr();
                  }
                  const { target, recordOutcome } = guardResult.value;

                  try {
                    await restApi.datasourcesMethods.deleteDatasource({
                      datasourceId: resourceId,
                      siteId,
                    });
                  } catch (e) {
                    recordOutcome({ ok: false, failureDetail: getExceptionMessage(e) });
                    throw e;
                  }
                  recordOutcome({ ok: true });

                  const projectName = target.project ?? 'unknown project';
                  const ownerText = target.owner ? `owner ${target.owner}` : 'owner unknown';
                  return new Ok(
                    `Deleted data source '${target.name}' (id ${resourceId}) in '${projectName}', ${ownerText}. ` +
                      'On Tableau Cloud it can be restored from the recycle bin for a limited time before permanent removal; ' +
                      'on Tableau Server deletion is permanent. ' +
                      'Dependent workbooks and flows were not deleted but no longer have this data source.',
                  );
                }

                case 'extract-refresh-task': {
                  const resolveTarget = async (): Promise<MutationTarget> => ({
                    id: resourceId,
                    kind: 'extract-refresh-task',
                  });

                  const guardResult = await guardMutation({
                    restApi,
                    extra,
                    tool: 'confirm-delete-content',
                    previewTool: 'delete-content',
                    action: 'delete',
                    mode: 'preview-confirm',
                    phase: 'confirm',
                    evidence: new AppApprovalEvidence('delete-content'),
                    resolveTarget,
                    fallbackTargetKind: 'extract-refresh-task',
                  });
                  if (guardResult.isErr()) {
                    return guardResult.error.toErr();
                  }
                  const { recordOutcome } = guardResult.value;

                  try {
                    await restApi.tasksMethods.deleteExtractRefreshTask({
                      siteId,
                      taskId: resourceId,
                    });
                  } catch (e) {
                    recordOutcome({ ok: false, failureDetail: getExceptionMessage(e) });
                    throw e;
                  }
                  recordOutcome({ ok: true });

                  return new Ok(
                    `Extract refresh task '${resourceId}' has been successfully deleted. The underlying data source ` +
                      'or workbook is unaffected, but it will no longer be refreshed on this schedule.',
                  );
                }
              }
            },
          });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return confirmDeleteContentTool;
};
