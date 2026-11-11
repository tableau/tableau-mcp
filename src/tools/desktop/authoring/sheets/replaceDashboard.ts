import type {
  ExecuteCommandError,
  ExecuteCommandWarning,
} from '../../../../desktop/externalApi/executorTypes.js';
import type { ExternalApiToolExecutor } from '../../../../desktop/externalApi/externalApiToolExecutor.js';
import { listWorkbookDashboards } from '../../../../desktop/metadata/dashboards.js';
import {
  deleteDashboardGuarded,
  type GuardedDeleteOutcome,
} from '../../../../desktop/wrappers/deleteDashboardGuarded.js';
import { getWorkbookXml } from '../../../../desktop/wrappers/getWorkbookXml.js';
import { pollReadback } from '../../../../desktop/wrappers/pollReadback.js';
import { decodeXmlEntities, xmlNamesEqual } from '../../../../desktop/xmlElement.js';

type RemoveDashboardOutcome =
  | Exclude<GuardedDeleteOutcome, { kind: 'sent' }>
  | { kind: 'unconfirmed'; warnings: ExecuteCommandWarning[]; readError: ExecuteCommandError }
  | { kind: 'unconfirmed'; warnings: ExecuteCommandWarning[]; thrown: unknown }
  | { kind: 'hidden'; warnings: ExecuteCommandWarning[] }
  | { kind: 'gone'; warnings: ExecuteCommandWarning[]; xml: string };

export async function removeDashboard({
  executor,
  signal,
  dashboardId,
  dashboardName,
  expectedWorkbookXml,
  expectedInstanceId,
  onDispatch,
}: {
  executor: ExternalApiToolExecutor;
  signal: AbortSignal;
  dashboardId: string;
  dashboardName: string;
  expectedWorkbookXml: string;
  expectedInstanceId: string | undefined;
  onDispatch: () => void;
}): Promise<RemoveDashboardOutcome> {
  const deleted = await deleteDashboardGuarded({
    executor,
    signal,
    dashboardId,
    expectedWorkbookXml,
    expectedInstanceId,
    onDispatch,
  });
  if (deleted.kind !== 'sent') return deleted;
  const { warnings } = deleted;
  let thrown: unknown;
  const gone = await pollReadback({
    read: () => getWorkbookXml({ executor, signal }),
    settled: (xml) => !dashboardPresent(xml, dashboardName),
    signal,
  }).catch((error: unknown) => {
    thrown = error;
    return undefined;
  });
  if (gone === undefined) return { kind: 'unconfirmed', warnings, thrown };
  if (!gone.ok) return { kind: 'unconfirmed', warnings, readError: gone.error };
  if (!gone.settled) return { kind: 'hidden', warnings };
  return { kind: 'gone', warnings, xml: gone.value };
}

function dashboardPresent(workbookXml: string, name: string): boolean {
  return (
    listWorkbookDashboards(workbookXml).some((existing) => xmlNamesEqual(existing, name)) ||
    [...workbookXml.matchAll(/<window\b[^>]*>/g)].some(
      ([open]) =>
        /\bclass=(['"])dashboard\1/.test(open) &&
        xmlNamesEqual(decodeXmlEntities(/\bname=(['"])(.*?)\1/.exec(open)?.[2] ?? ''), name),
    )
  );
}
