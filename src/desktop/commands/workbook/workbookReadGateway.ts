import { Err, Ok, type Result } from 'ts-results-es';

import { ExternalApiToolExecutor } from '../../externalApi/externalApiToolExecutor.js';
import { isRouteMissing, resolveItemByNameOrId } from '../../externalApi/toolUtils.js';
import { extractDashboardXml, listWorkbookDashboards } from '../../metadata/dashboards.js';
import { extractSheetXml, listSheets } from '../../metadata/sheets.js';
import {
  type ExecuteCommandError,
  type WithExecutorAndAbortSignal,
} from '../../toolExecutor/toolExecutor.js';
import { getWorkbookXml } from './getWorkbookXml.js';

export type WorkbookReadMode = 'external-api';

export type ListWorksheetsResult = Result<
  {
    count: number;
    worksheets: Array<string>;
  },
  ExecuteCommandError
>;

export type ListDashboardsResult = Result<
  {
    count: number;
    dashboards: Array<string>;
  },
  ExecuteCommandError
>;

export type GetWorksheetXmlError = (
  | { type: 'no-worksheet-found' }
  | { type: 'multiple-worksheets-found' }
) & { message: string };

export type GetWorksheetXmlResult = Result<
  string,
  | { type: 'execute-command-error'; error: ExecuteCommandError }
  | { type: 'get-worksheet-xml-error'; error: GetWorksheetXmlError }
>;

export type GetDashboardXmlError = (
  | { type: 'no-dashboard-found' }
  | { type: 'multiple-dashboards-found' }
) & { message: string };

export type GetDashboardXmlResult = Result<
  string,
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
    const result = await this.listWorksheetsViaExternalApi();
    if (result.isErr() && isRouteMissing(result.error)) {
      return await this.listWorksheetsViaWorkbookDocument();
    }
    return result;
  }

  async listDashboards(): Promise<ListDashboardsResult> {
    const result = await this.listDashboardsViaExternalApi();
    if (result.isErr() && isRouteMissing(result.error)) {
      return await this.listDashboardsViaWorkbookDocument();
    }
    return result;
  }

  async getWorksheetXml(worksheetName: string): Promise<GetWorksheetXmlResult> {
    const result = await this.getWorksheetXmlViaExternalApi(worksheetName);
    if (result.isErr() && isExecuteRouteMissing(result.error)) {
      return await this.getWorksheetXmlViaWorkbookDocument(worksheetName);
    }
    return result;
  }

  async getDashboardXml(dashboardName: string): Promise<GetDashboardXmlResult> {
    const result = await this.getDashboardXmlViaExternalApi(dashboardName);
    if (result.isErr() && isExecuteRouteMissing(result.error)) {
      return await this.getDashboardXmlViaWorkbookDocument(dashboardName);
    }
    return result;
  }

  private async listWorksheetsViaExternalApi(): Promise<ListWorksheetsResult> {
    const result = await this.executor.listWorksheets(this.signal);
    if (result.isErr()) {
      return result;
    }

    const worksheets = (result.value.worksheets ?? []).map((worksheet) => worksheet.name);
    return Ok({
      count: worksheets.length,
      worksheets,
    });
  }

  private async listDashboardsViaExternalApi(): Promise<ListDashboardsResult> {
    const result = await this.executor.listDashboards(this.signal);
    if (result.isErr()) {
      return result;
    }

    const dashboards = (result.value.dashboards ?? []).map((dashboard) => dashboard.name);
    return Ok({
      count: dashboards.length,
      dashboards,
    });
  }

  private async listWorksheetsViaWorkbookDocument(): Promise<ListWorksheetsResult> {
    const workbookResult = await getWorkbookXml({ executor: this.executor, signal: this.signal });
    if (workbookResult.isErr()) {
      return workbookResult;
    }

    let worksheets: Array<string>;
    try {
      worksheets = listSheets(workbookResult.value);
    } catch (error) {
      return Err({ type: 'invalid-response', error });
    }

    return Ok({
      count: worksheets.length,
      worksheets,
    });
  }

  private async listDashboardsViaWorkbookDocument(): Promise<ListDashboardsResult> {
    const workbookResult = await getWorkbookXml({ executor: this.executor, signal: this.signal });
    if (workbookResult.isErr()) {
      return workbookResult;
    }

    let dashboards: Array<string>;
    try {
      dashboards = listWorkbookDashboards(workbookResult.value);
    } catch (error) {
      return Err({ type: 'invalid-response', error });
    }

    return Ok({
      count: dashboards.length,
      dashboards,
    });
  }

  private async getWorksheetXmlViaExternalApi(
    worksheetName: string,
  ): Promise<GetWorksheetXmlResult> {
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

    return Ok(documentResult.value.xml);
  }

  private async getDashboardXmlViaExternalApi(
    dashboardName: string,
  ): Promise<GetDashboardXmlResult> {
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

    return Ok(documentResult.value.xml);
  }

  private async getWorksheetXmlViaWorkbookDocument(
    worksheetName: string,
  ): Promise<GetWorksheetXmlResult> {
    const workbookResult = await getWorkbookXml({ executor: this.executor, signal: this.signal });
    if (workbookResult.isErr()) {
      return Err({ type: 'execute-command-error', error: workbookResult.error });
    }

    let worksheetXml: string | null;
    try {
      worksheetXml = extractSheetXml(workbookResult.value, worksheetName);
    } catch (error) {
      return Err({ type: 'execute-command-error', error: { type: 'invalid-response', error } });
    }

    if (worksheetXml === null) {
      const didYouMean = await this.worksheetNameSuggestions(worksheetName);
      return Err({
        type: 'get-worksheet-xml-error',
        error: {
          type: 'no-worksheet-found',
          message: `No worksheet found for ${worksheetName}.${didYouMean}`,
        },
      });
    }

    return Ok(worksheetXml);
  }

  private async getDashboardXmlViaWorkbookDocument(
    dashboardName: string,
  ): Promise<GetDashboardXmlResult> {
    const workbookResult = await getWorkbookXml({ executor: this.executor, signal: this.signal });
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
        error: {
          type: 'no-dashboard-found',
          message: `No dashboard found for "${dashboardName}".`,
        },
      });
    }

    return Ok(dashboardXml);
  }

  private async worksheetNameSuggestions(missName: string): Promise<string> {
    try {
      const listed = await this.listWorksheets();
      if (listed.isErr()) return '';
      const names = listed.value.worksheets.filter((n) => !!n);
      if (names.length === 0) return '';

      const needle = missName.toLowerCase();
      const close = names.filter((n) => {
        const hay = n.toLowerCase();
        return hay.includes(needle) || needle.includes(hay);
      });
      const candidates = (close.length > 0 ? close : names).slice(0, 12);
      const heading = close.length > 0 ? 'Did you mean' : 'Available worksheets';
      return (
        ` ${heading}: ${candidates.map((n) => `"${n}"`).join(', ')}.` +
        ' If it is not obvious which sheet the user meant, ask the user instead of guessing.'
      );
    } catch {
      return '';
    }
  }
}

function worksheetResolutionError(message: string): GetWorksheetXmlError {
  return {
    type: message.includes('matched multiple') ? 'multiple-worksheets-found' : 'no-worksheet-found',
    message,
  };
}

function isExecuteRouteMissing(
  error:
    | { type: 'execute-command-error'; error: ExecuteCommandError }
    | { type: 'get-worksheet-xml-error'; error: GetWorksheetXmlError }
    | { type: 'get-dashboard-xml-error'; error: GetDashboardXmlError },
): boolean {
  return error.type === 'execute-command-error' && isRouteMissing(error.error);
}

function dashboardResolutionError(message: string): GetDashboardXmlError {
  return {
    type: message.includes('matched multiple') ? 'multiple-dashboards-found' : 'no-dashboard-found',
    message,
  };
}
