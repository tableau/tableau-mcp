import { Err, Ok, type Result } from 'ts-results-es';

import {
  type ExecuteCommandError,
  type WithExecutorAndAbortSignal,
} from '../externalApi/executorTypes.js';
import { ExternalApiToolExecutor } from '../externalApi/externalApiToolExecutor.js';
import { resolveItemByNameOrId } from '../externalApi/toolUtils.js';
import { type DashboardItem, type WorksheetItem } from '../externalApi/types.js';

export type WorkbookReadMode = 'external-api';

export type ListWorksheetsResult = Result<
  {
    count: number;
    worksheets: Array<WorksheetItem>;
  },
  ExecuteCommandError
>;

export type ListDashboardsResult = Result<
  {
    count: number;
    dashboards: Array<DashboardItem>;
  },
  ExecuteCommandError
>;

export type GetWorksheetXmlError = (
  | { type: 'no-worksheet-found' }
  | { type: 'multiple-worksheets-found' }
  | { type: 'malformed-worksheet-fragment' }
) & { message: string };

export type GetWorksheetXmlResult = Result<
  { xml: string; name: string },
  | { type: 'execute-command-error'; error: ExecuteCommandError }
  | { type: 'get-worksheet-xml-error'; error: GetWorksheetXmlError }
>;

export type GetDashboardXmlError = (
  { type: 'no-dashboard-found' } | { type: 'multiple-dashboards-found' }
) & { message: string };

export type GetDashboardXmlResult = Result<
  { xml: string; name: string },
  | { type: 'execute-command-error'; error: ExecuteCommandError }
  | { type: 'get-dashboard-xml-error'; error: GetDashboardXmlError }
>;

export class WorkbookReadGateway {
  readonly mode: WorkbookReadMode = 'external-api';
  private readonly executor: ExternalApiToolExecutor;
  private readonly signal: AbortSignal;

  constructor({ executor, signal }: WithExecutorAndAbortSignal) {
    this.executor = executor as ExternalApiToolExecutor;
    this.signal = signal;
  }

  async listWorksheets(): Promise<ListWorksheetsResult> {
    const result = await this.executor.listWorksheets(this.signal);
    if (result.isErr()) {
      return result;
    }

    const worksheets = result.value.worksheets ?? [];
    return Ok({
      count: worksheets.length,
      worksheets,
    });
  }

  async listDashboards(): Promise<ListDashboardsResult> {
    const result = await this.executor.listDashboards(this.signal);
    if (result.isErr()) {
      return result;
    }

    const dashboards = result.value.dashboards ?? [];
    return Ok({
      count: dashboards.length,
      dashboards,
    });
  }

  async getWorksheetXml(worksheetName: string): Promise<GetWorksheetXmlResult> {
    const worksheetsResult = await this.executor.listWorksheets(this.signal);
    if (worksheetsResult.isErr()) {
      return Err({ type: 'execute-command-error', error: worksheetsResult.error });
    }

    const worksheetResult = resolveItemByNameOrId(
      'Worksheet',
      worksheetName,
      worksheetsResult.value.worksheets ?? [],
    );
    if (worksheetResult.isErr()) {
      return Err({
        type: 'get-worksheet-xml-error',
        error: worksheetResolutionError(worksheetResult.error.message),
      });
    }

    const documentResult = await this.executor.getWorksheetDocument(
      worksheetResult.value.id,
      this.signal,
    );
    if (documentResult.isErr()) {
      return Err({ type: 'execute-command-error', error: documentResult.error });
    }

    return Ok({ xml: documentResult.value.xml, name: worksheetResult.value.name });
  }

  async getDashboardXml(dashboardName: string): Promise<GetDashboardXmlResult> {
    const dashboardsResult = await this.executor.listDashboards(this.signal);
    if (dashboardsResult.isErr()) {
      return Err({ type: 'execute-command-error', error: dashboardsResult.error });
    }

    const dashboardResult = resolveItemByNameOrId(
      'Dashboard',
      dashboardName,
      dashboardsResult.value.dashboards ?? [],
    );
    if (dashboardResult.isErr()) {
      return Err({
        type: 'get-dashboard-xml-error',
        error: dashboardResolutionError(dashboardResult.error.message),
      });
    }

    const documentResult = await this.executor.getDashboardDocument(
      dashboardResult.value.id,
      this.signal,
    );
    if (documentResult.isErr()) {
      return Err({ type: 'execute-command-error', error: documentResult.error });
    }

    return Ok({ xml: documentResult.value.xml, name: dashboardResult.value.name });
  }
}

function worksheetResolutionError(message: string): GetWorksheetXmlError {
  return {
    type: message.includes('matched multiple') ? 'multiple-worksheets-found' : 'no-worksheet-found',
    message,
  };
}

function dashboardResolutionError(message: string): GetDashboardXmlError {
  return {
    type: message.includes('matched multiple') ? 'multiple-dashboards-found' : 'no-dashboard-found',
    message,
  };
}
