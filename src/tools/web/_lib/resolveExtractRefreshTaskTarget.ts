import { log } from '../../../logging/logger.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { ExtractRefreshTask } from '../../../sdks/tableau/types/extractRefreshTask.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { resolveOwnerEmail } from '../users/resolveOwnerEmail.js';
import { MutationTarget } from './mutationGuard.js';

/**
 * Best-effort resolution of an extract-refresh task's audit-target identity (AC-3, W-23125362).
 *
 * IDENTITY MAPPING (lead decision): an extract-refresh task has no natural name/project/owner of its
 * own. The Tableau REST list entry carries ONLY `{ id, schedule?, datasource?: {id}, workbook?: {id} }`
 * (see src/sdks/tableau/types/extractRefreshTask.ts) and there is NO single-task GET endpoint — so a
 * task's identity DERIVES from its underlying content:
 *   - `target.name`    = the underlying datasource/workbook name
 *   - `target.project` = its project name
 *   - `target.owner`   = its owner email/name (via resolveOwnerEmail, best-effort)
 * If the task has no datasource/workbook reference, or the content lookup fails, the field is left
 * undefined (documented best-effort). This function NEVER throws: every lookup is wrapped so a resolve
 * failure degrades to an id-only target and can never block or fail the guarded mutation/audit.
 *
 * COST: the task list yields only the underlying content ID, so enriching name/project/owner requires
 * ONE content lookup (queryDatasource | getWorkbook) plus ONE owner lookup (queryUserOnSite) —
 * mirroring the cost the workbook/datasource delete branches already pay. Callers that ALREADY hold
 * the task list (the delete-content task branch runs it as its existence check) pass it via `tasks` to
 * avoid a re-list; the confirm/update paths omit it and this helper lists once itself.
 *
 * This is single-sourced across all four extract-refresh-task mutation paths (delete-content task
 * branch, update-cloud-extract-refresh-task, confirm-delete-content, confirm-update-cloud-extract-refresh-task)
 * so the identity mapping lives in exactly one place.
 */
export async function resolveExtractRefreshTaskTarget({
  restApi,
  siteId,
  taskId,
  logger = 'resolve-extract-refresh-task-target',
  tasks,
}: {
  restApi: RestApi;
  siteId: string;
  taskId: string;
  logger?: string;
  /** Pre-fetched task list, if the caller already has it (avoids a re-list). */
  tasks?: ReadonlyArray<ExtractRefreshTask>;
}): Promise<MutationTarget> {
  const idOnly: MutationTarget = { id: taskId, kind: 'extract-refresh-task' };

  try {
    const taskList = tasks ?? (await restApi.tasksMethods.listExtractRefreshTasks({ siteId }));
    const task = taskList.find((t) => t.id === taskId);
    if (!task) {
      return idOnly;
    }

    if (task.datasource?.id) {
      const datasource = await restApi.datasourcesMethods.queryDatasource({
        datasourceId: task.datasource.id,
        siteId,
      });
      const owner = await resolveOwnerEmail(restApi, siteId, datasource.owner?.id, logger);
      return {
        id: taskId,
        name: datasource.name,
        project: datasource.project?.name,
        owner: owner ?? undefined,
        kind: 'extract-refresh-task',
      };
    }

    if (task.workbook?.id) {
      const workbook = await restApi.workbooksMethods.getWorkbook({
        workbookId: task.workbook.id,
        siteId,
      });
      const owner = await resolveOwnerEmail(restApi, siteId, workbook.owner?.id, logger);
      return {
        id: taskId,
        name: workbook.name,
        project: workbook.project?.name,
        owner: owner ?? undefined,
        kind: 'extract-refresh-task',
      };
    }

    return idOnly;
  } catch (error) {
    // Best-effort: a resolve failure must never block or fail the mutation/audit — degrade to id-only.
    log({
      message: `${logger}: failed to resolve underlying content for extract refresh task ${taskId}`,
      level: 'warning',
      logger,
      data: getExceptionMessage(error),
    });
    return idOnly;
  }
}
