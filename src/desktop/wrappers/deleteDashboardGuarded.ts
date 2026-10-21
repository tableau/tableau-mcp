import type { Result } from 'ts-results-es';

import type { ExecuteCommandError, ExecuteCommandWarning } from '../externalApi/executorTypes.js';
import type { ExternalApiToolExecutor } from '../externalApi/externalApiToolExecutor.js';
import { withApplyLock } from './applyMutex.js';

export type GuardedDeleteOutcome =
  | { kind: 'drift' }
  | { kind: 'failed'; error: ExecuteCommandError; dispatched: boolean }
  | { kind: 'sent'; warnings: ExecuteCommandWarning[] };

/** Delete one dashboard only if the workbook still equals `expectedWorkbookXml`; read and delete share one apply lock. */
export async function deleteDashboardGuarded({
  executor,
  signal,
  dashboardId,
  expectedWorkbookXml,
  expectedInstanceId,
  onDispatch,
}: {
  executor: ExternalApiToolExecutor;
  signal: AbortSignal;
  dashboardId: string;
  expectedWorkbookXml: string;
  expectedInstanceId: string | undefined;
  onDispatch: () => void;
}): Promise<GuardedDeleteOutcome> {
  return await withApplyLock(async (): Promise<GuardedDeleteOutcome> => {
    const current = await executor.getWorkbookDocument(signal);
    if (current.isErr()) return { kind: 'failed', error: current.error, dispatched: false };
    if (current.value.xml !== expectedWorkbookXml) return { kind: 'drift' };
    let dispatched = false;
    const deleted: Result<{ warnings?: readonly ExecuteCommandWarning[] }, ExecuteCommandError> =
      await executor.deleteSheet({ kind: 'dashboard', id: dashboardId }, signal, {
        expectedInstanceId,
        onDispatch: () => {
          dispatched = true;
          onDispatch();
        },
      });
    if (deleted.isErr()) return { kind: 'failed', error: deleted.error, dispatched };
    return { kind: 'sent', warnings: [...(deleted.value.warnings ?? [])] };
  });
}
