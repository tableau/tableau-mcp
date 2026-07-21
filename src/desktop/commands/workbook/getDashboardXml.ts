import { Err, Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { getDesktopConfig } from '../../../config.desktop.js';
import { ExternalApiToolExecutor } from '../../externalApi/externalApiToolExecutor.js';
import { DashboardItem } from '../../externalApi/types.js';
import { extractDashboardXml } from '../../metadata/dashboards.js';
import {
  ExecuteCommandError,
  WithExecutorAndAbortSignal,
} from '../../toolExecutor/toolExecutor.js';
import { decodeXmlEntities } from '../../xmlElement.js';
import { getWorkbookXml } from './getWorkbookXml.js';
import { nameMayNeedRawCommandResolution, resolveDashboardCommandName } from './nameResolution.js';

export { isRouteMissing } from '../../externalApi/toolUtils.js';

export type GetDashboardXmlError = (
  | { type: 'no-dashboard-found' }
  | { type: 'multiple-dashboards-found' }
) & { message: string };

type GetDashboardXmlResult = Result<
  string,
  | { type: 'execute-command-error'; error: ExecuteCommandError }
  | { type: 'get-dashboard-xml-error'; error: GetDashboardXmlError }
>;

export async function getDashboardXml(
  args: { dashboardName: string } & WithExecutorAndAbortSignal,
): Promise<GetDashboardXmlResult> {
  if (args.executor instanceof ExternalApiToolExecutor) {
    return getDashboardXmlViaExternalApi(args);
  }
  return getDesktopConfig().externalApiEnabled
    ? getDashboardXmlViaWorkbookDocument(args)
    : getDashboardXmlViaAgentApi(args);
}

async function getDashboardXmlViaAgentApi({
  dashboardName,
  executor,
  signal,
}: { dashboardName: string } & WithExecutorAndAbortSignal): Promise<GetDashboardXmlResult> {
  const result = await getDashboardXmlViaAgentApiName({ dashboardName, executor, signal });
  if (result.isOk() || !nameMayNeedRawCommandResolution(dashboardName)) {
    return result;
  }

  if (
    result.error.type !== 'get-dashboard-xml-error' ||
    result.error.error.type !== 'no-dashboard-found'
  ) {
    return result;
  }

  const commandName = await resolveDashboardCommandName(dashboardName, { executor, signal });
  if (!commandName || commandName === dashboardName) {
    return result;
  }

  return getDashboardXmlViaAgentApiName({
    dashboardName: commandName,
    requestedDashboardName: dashboardName,
    executor,
    signal,
  });
}

async function getDashboardXmlViaAgentApiName({
  dashboardName,
  requestedDashboardName = dashboardName,
  executor,
  signal,
}: {
  dashboardName: string;
  requestedDashboardName?: string;
} & WithExecutorAndAbortSignal): Promise<GetDashboardXmlResult> {
  const result = await executor.executeCommand({
    namespace: 'tabui',
    command: 'save-dashboard',
    args: {
      dashboardName,
    },
    schema: z.object({
      dashboardXml: z.string(),
    }),
    signal,
  });

  if (result.isErr()) {
    return Err({ type: 'execute-command-error', error: result.error });
  }

  const dashboardXml = result.value.parsedResult.dashboardXml;
  const dashboardCount = (dashboardXml.match(/<dashboard/g) || []).length;

  if (dashboardCount === 0) {
    return Err({
      type: 'get-dashboard-xml-error',
      error: {
        type: 'no-dashboard-found',
        message: `No dashboard found for "${requestedDashboardName}".`,
      },
    });
  }

  if (dashboardCount > 1) {
    return Err({
      type: 'get-dashboard-xml-error',
      error: {
        type: 'multiple-dashboards-found',
        message: `${dashboardCount} dashboards found instead of 1.`,
      },
    });
  }

  return Ok(dashboardXml);
}

async function getDashboardXmlViaExternalApi({
  dashboardName,
  executor,
  signal,
}: { dashboardName: string } & WithExecutorAndAbortSignal): Promise<GetDashboardXmlResult> {
  if (!(executor instanceof ExternalApiToolExecutor)) {
    return getDashboardXmlViaAgentApi({ dashboardName, executor, signal });
  }

  const dashboardsResult = await executor.listDashboards(signal);
  if (dashboardsResult.isErr()) {
    return Err({ type: 'execute-command-error', error: dashboardsResult.error });
  }

  const dashboardResult = resolveExternalApiDashboard(
    dashboardName,
    dashboardsResult.value.dashboards ?? [],
  );
  if (dashboardResult.isErr()) {
    return Err({
      type: 'get-dashboard-xml-error',
      error: dashboardResult.error,
    });
  }

  const documentResult = await executor.getDashboardDocument(dashboardResult.value.id, signal);
  if (documentResult.isErr()) {
    return Err({ type: 'execute-command-error', error: documentResult.error });
  }

  return Ok(documentResult.value.xml);
}

async function getDashboardXmlViaWorkbookDocument({
  dashboardName,
  executor,
  signal,
}: { dashboardName: string } & WithExecutorAndAbortSignal): Promise<GetDashboardXmlResult> {
  const workbookResult = await getWorkbookXml({ executor, signal });
  if (workbookResult.isErr()) {
    return Err({ type: 'execute-command-error', error: workbookResult.error });
  }

  let dashboardXml: string | null;
  try {
    dashboardXml = extractDashboardXml(workbookResult.value, dashboardName);
  } catch (error) {
    return Err({ type: 'execute-command-error', error: { type: 'invalid-response', error } });
  }

  if (dashboardXml === null) {
    return Err({
      type: 'get-dashboard-xml-error',
      error: { type: 'no-dashboard-found', message: `No dashboard found for "${dashboardName}".` },
    });
  }

  return Ok(dashboardXml);
}

function resolveExternalApiDashboard(
  dashboardName: string,
  dashboards: DashboardItem[],
): Result<DashboardItem, GetDashboardXmlError> {
  const requested = dashboardName.trim();
  const requestedNames = unique([requested, decodeXmlEntities(requested)]);

  const idMatch = dashboards.find((candidate) => candidate.id === requested);
  if (idMatch) {
    return Ok(idMatch);
  }

  const nameMatches = dashboards.filter((candidate) => requestedNames.includes(candidate.name));
  if (nameMatches.length === 1) {
    return Ok(nameMatches[0]);
  }

  if (nameMatches.length > 1) {
    return Err({
      type: 'multiple-dashboards-found',
      message: `Dashboard "${dashboardName}" matched multiple dashboards. Specify one id: ${formatDashboards(
        nameMatches,
      )}.`,
    });
  }

  return Err({
    type: 'no-dashboard-found',
    message: `No dashboard found for "${dashboardName}".`,
  });
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function formatDashboards(dashboards: DashboardItem[]): string {
  return dashboards.map((dashboard) => `${dashboard.name} (${dashboard.id})`).join(', ');
}
