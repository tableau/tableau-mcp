import { createHash } from 'node:crypto';

import { log } from '../../../logging/logger.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import {
  ExtractRefreshSchedule,
  ExtractRefreshTask,
} from '../../../sdks/tableau/types/extractRefreshTask.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { resolveOwnerEmail } from '../users/resolveOwnerEmail.js';
import { MutationTarget } from './mutationGuard.js';
import { toPreStateReadError } from './preStateRead.js';

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
 * undefined (documented best-effort). Every lookup is wrapped so a resolve failure degrades to an
 * id-only target and can never block or fail the guarded mutation/audit — except the task-list read
 * when `includeScheduleState` is set (see below).
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
 *
 * `includeScheduleState` (update-cloud-extract-refresh-task only): also return `target.state`, a
 * deterministic hash of the task's CURRENT schedule (see extractRefreshScheduleState), so a signed
 * confirmation token is rejected if the schedule changed between preview and confirm. It is derived
 * from the same task-list entry (no extra REST call) and is set even when the content enrichment
 * fails, so a transient enrichment error cannot make preview and confirm disagree. A task not found
 * in the list yields state ''. With `includeScheduleState`, a failure to LIST the tasks (e.g. a
 * scoped token without `tableau:tasks:read`) is the one case that throws instead of degrading: the
 * state cannot be known, so the caller fails closed. A 401/403 there is rethrown as
 * ConfirmationPreStateForbiddenError naming `tableau:tasks:read` (see preStateRead.ts), which
 * guardMutation audits and returns as a clean tool error instead of a generic "Permission denied".
 */
export async function resolveExtractRefreshTaskTarget({
  restApi,
  siteId,
  taskId,
  logger = 'resolve-extract-refresh-task-target',
  tasks,
  includeScheduleState = false,
}: {
  restApi: RestApi;
  siteId: string;
  taskId: string;
  logger?: string;
  /** Pre-fetched task list, if the caller already has it (avoids a re-list). */
  tasks?: ReadonlyArray<ExtractRefreshTask>;
  /** Also return `state` (hash of the task's current schedule). Off by default. */
  includeScheduleState?: boolean;
}): Promise<MutationTarget> {
  let idOnly: MutationTarget = { id: taskId, kind: 'extract-refresh-task' };

  let taskList: ReadonlyArray<ExtractRefreshTask>;
  try {
    taskList = tasks ?? (await restApi.tasksMethods.listExtractRefreshTasks({ siteId }));
  } catch (error) {
    // The schedule pre-state comes from this list. Fail closed rather than degrade to an empty
    // state: if one phase read the schedule and the other could not, an empty fallback would make a
    // confirm either spuriously match (both phases failed) or mask why it was rejected. Throwing
    // means no token is minted on a preview and nothing is mutated on a confirm.
    if (includeScheduleState) {
      throw toPreStateReadError(error, {
        description: "this extract refresh task's current schedule",
        requiredScopes: ['tableau:tasks:read'],
      });
    }
    log({
      message: `${logger}: failed to list extract refresh tasks while resolving task ${taskId}`,
      level: 'warning',
      logger,
      data: getExceptionMessage(error),
    });
    return idOnly;
  }

  try {
    const task = taskList.find((t) => t.id === taskId);
    if (!task) {
      return includeScheduleState ? { ...idOnly, state: '' } : idOnly;
    }
    if (includeScheduleState) {
      idOnly = { ...idOnly, state: extractRefreshScheduleState(task.schedule) };
    }
    const state = idOnly.state;

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
        ...(state === undefined ? {} : { state }),
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
        ...(state === undefined ? {} : { state }),
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

/**
 * Deterministic fingerprint of an extract-refresh task's current schedule, used as the signed
 * confirmation token's pre-state. Only the user-settable recurrence is included — `frequency` and
 * `frequencyDetails` (start, end, intervals) — NOT `nextRunAt`/`updatedAt`/`state`, which move on
 * their own as the task runs and would spuriously invalidate a confirm. Object keys are sorted at
 * every depth and the interval bag is normalized to a sorted array (Tableau returns a single
 * interval as an object and several as an array), so every replica and both phases compute the same
 * value from the same server state. A task with no schedule yields ''.
 */
export function extractRefreshScheduleState(schedule: ExtractRefreshSchedule | undefined): string {
  if (!schedule) {
    return '';
  }
  const rawInterval = schedule.frequencyDetails?.intervals?.interval;
  const intervals =
    rawInterval === undefined ? [] : Array.isArray(rawInterval) ? rawInterval : [rawInterval];
  const snapshot = {
    frequency: schedule.frequency ?? null,
    start: schedule.frequencyDetails?.start ?? null,
    end: schedule.frequencyDetails?.end ?? null,
    intervals: intervals.map((i) => stableStringify(i)).sort(),
  };
  return createHash('sha256').update(stableStringify(snapshot)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}
