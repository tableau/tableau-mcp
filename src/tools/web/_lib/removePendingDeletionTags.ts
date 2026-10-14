import { Ok, Result } from 'ts-results-es';

import { AdminOnlyError, McpToolError } from '../../../errors/mcpToolError.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { assertAdmin } from '../adminGate.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { TableauWebRequestHandlerExtra } from '../toolContext.js';
import { NoEvidence } from './evidence.js';
import { guardMutation } from './mutationGuard.js';
import { getPendingDeletionMarkers } from './pendingDeletionTag.js';

export const MAX_REMOVE_RESOURCE_IDS = 100;

export type RemovePendingDeletionTagsItem = {
  resourceId: string;
  status: 'removed' | 'no-markers' | 'not-allowed' | 'error';
  removedTags: string[];
  message?: string;
};

export type RemovePendingDeletionTagsResult = {
  removedCount: number;
  items: RemovePendingDeletionTagsItem[];
};

/**
 * `delete-content` `action: "remove-pending-tags"` (W-24199845): the MCP undo for a preview's marker.
 *
 * Removes ONLY labels matching `pending-deletion` or `pending-deletion-YYYY-MM-DD` — never any
 * other tag — so it cannot become a general tag editor over owners' content. Removing a marker can
 * only make a deletion HARDER (the confirm gate needs it), so no preview/confirm round-trip is
 * required; each item still passes the admin gate and bounded context and is audited
 * (`action: update`).
 */
export async function removePendingDeletionTags({
  restApi,
  extra,
  resourceType,
  resourceIds,
  cleanupDate,
}: {
  restApi: RestApi;
  extra: TableauWebRequestHandlerExtra;
  resourceType: 'workbook' | 'datasource';
  resourceIds: string[];
  cleanupDate: string | undefined;
}): Promise<Result<RemovePendingDeletionTagsResult, McpToolError>> {
  // Fail fast, before any per-item read, so a non-admin learns nothing about the items.
  const adminResult = await assertAdmin(restApi, extra);
  if (adminResult.isErr()) {
    return new AdminOnlyError(adminResult.error).toErr();
  }
  const items: RemovePendingDeletionTagsItem[] = [];
  for (const resourceId of [...new Set(resourceIds)]) {
    const itemResult = await removeMarkersFromItem({
      restApi,
      extra,
      resourceType,
      resourceId,
      cleanupDate,
    });
    if (itemResult.isErr()) {
      // The admin gate is per-caller, not per-item: stop at the first denial.
      return itemResult;
    }
    items.push(itemResult.value);
  }
  return new Ok({
    removedCount: items.reduce((sum, item) => sum + item.removedTags.length, 0),
    items,
  });
}

async function removeMarkersFromItem({
  restApi,
  extra,
  resourceType,
  resourceId,
  cleanupDate,
}: {
  restApi: RestApi;
  extra: TableauWebRequestHandlerExtra;
  resourceType: 'workbook' | 'datasource';
  resourceId: string;
  cleanupDate: string | undefined;
}): Promise<Result<RemovePendingDeletionTagsItem, McpToolError>> {
  const siteId = restApi.siteId;

  let content: {
    name: string;
    project?: { name?: string };
    tags: { tag?: Array<{ label: string }> };
  };
  try {
    const allowed =
      resourceType === 'workbook'
        ? await resourceAccessChecker.isWorkbookAllowed({ workbookId: resourceId, extra })
        : await resourceAccessChecker.isDatasourceAllowed({ datasourceLuid: resourceId, extra });
    if (!allowed.allowed) {
      return new Ok({
        resourceId,
        status: 'not-allowed',
        removedTags: [],
        message: allowed.message,
      });
    }
    // Always re-read live tags: the access checker's cached content may predate a recent preview.
    content =
      resourceType === 'workbook'
        ? await restApi.workbooksMethods.getWorkbook({ workbookId: resourceId, siteId })
        : await restApi.datasourcesMethods.queryDatasource({ datasourceId: resourceId, siteId });
  } catch (e) {
    return new Ok({
      resourceId,
      status: 'error',
      removedTags: [],
      message: getExceptionMessage(e),
    });
  }

  const guardResult = await guardMutation({
    restApi,
    extra,
    tool: 'delete-content',
    action: 'update',
    mode: 'confirm-only',
    phase: 'confirm',
    evidence: new NoEvidence(),
    resolveTarget: async () => ({
      id: resourceId,
      name: content.name,
      project: content.project?.name,
      kind: resourceType,
    }),
    fallbackTargetKind: resourceType,
  });
  if (guardResult.isErr()) {
    return guardResult.error instanceof AdminOnlyError
      ? guardResult.error.toErr()
      : new Ok({
          resourceId,
          status: 'error',
          removedTags: [],
          message: guardResult.error.message,
        });
  }
  const { recordOutcome } = guardResult.value;

  const toRemove = getPendingDeletionMarkers(content.tags)
    .filter((m) => !cleanupDate || m.cleanupDate === cleanupDate)
    .map((m) => m.tag);

  const removedTags: string[] = [];
  try {
    for (const tagLabel of toRemove) {
      if (resourceType === 'workbook') {
        await restApi.workbooksMethods.deleteTagFromWorkbook({
          workbookId: resourceId,
          siteId,
          tagLabel,
        });
      } else {
        await restApi.datasourcesMethods.deleteTagFromDatasource({
          datasourceId: resourceId,
          siteId,
          tagLabel,
        });
      }
      removedTags.push(tagLabel);
    }
  } catch (e) {
    const message = getExceptionMessage(e);
    recordOutcome({ ok: false, failureDetail: message });
    return new Ok({ resourceId, status: 'error', removedTags, message });
  }
  recordOutcome({ ok: true });

  return new Ok({
    resourceId,
    status: removedTags.length > 0 ? 'removed' : 'no-markers',
    removedTags,
  });
}
