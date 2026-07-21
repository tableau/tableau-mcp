import { Err, Ok, type Result } from 'ts-results-es';
import { z } from 'zod';

import { type Config, getDesktopConfig } from '../../../config.desktop.js';
import { log } from '../../../logging/logger.js';
import { ExternalApiToolExecutor } from '../../externalApi/externalApiToolExecutor.js';
import { resolveItemByNameOrId } from '../../externalApi/toolUtils.js';
import { extractDashboardXml, listWorkbookDashboards } from '../../metadata/dashboards.js';
import { extractSheetXml, listSheets } from '../../metadata/sheets.js';
import {
  type ExecuteCommandError,
  type ToolExecutor,
  type WithExecutorAndAbortSignal,
} from '../../toolExecutor/toolExecutor.js';
import { decodeXmlEntities } from '../../xmlElement.js';
import { getWorkbookXml } from './getWorkbookXml.js';
import {
  nameMayNeedRawCommandResolution,
  resolveDashboardCommandName,
  resolveWorksheetCommandName,
} from './nameResolution.js';

const LOGGER = 'WorkbookReadGateway';

const worksheetNamesSchema = z.object({
  count: z.number(),
  worksheets: z.array(z.object({ name: z.string() })),
});

const dashboardNamesSchema = z.object({
  count: z.number(),
  dashboards: z.array(z.object({ name: z.string() })),
});

export type WorkbookReadMode = 'external-api' | 'workbook-document' | 'agent-api';

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
  readonly mode: WorkbookReadMode;
  private readonly executor: ToolExecutor;
  private readonly signal: AbortSignal;

  constructor({
    executor,
    signal,
    config = getDesktopConfig(),
  }: WithExecutorAndAbortSignal & { config?: Config }) {
    this.executor = executor;
    this.signal = signal;
    this.mode = selectMode(executor, config);

    if (this.mode === 'workbook-document') {
      log({
        level: 'warning',
        logger: LOGGER,
        message:
          'External API is enabled but workbook read received a non-External API executor; using whole-workbook document fallback.',
        data: { executor: executor.constructor.name },
      });
    }
  }

  async listWorksheets(): Promise<ListWorksheetsResult> {
    switch (this.mode) {
      case 'external-api':
        return await this.listWorksheetsViaExternalApi();
      case 'workbook-document':
        return await this.listWorksheetsViaWorkbookDocument();
      case 'agent-api':
        return await this.listWorksheetsViaAgentApi();
    }
  }

  async listDashboards(): Promise<ListDashboardsResult> {
    switch (this.mode) {
      case 'external-api':
        return await this.listDashboardsViaExternalApi();
      case 'workbook-document':
        return await this.listDashboardsViaWorkbookDocument();
      case 'agent-api':
        return await this.listDashboardsViaAgentApi();
    }
  }

  async getWorksheetXml(worksheetName: string): Promise<GetWorksheetXmlResult> {
    switch (this.mode) {
      case 'external-api':
        return await this.getWorksheetXmlViaExternalApi(worksheetName);
      case 'workbook-document':
        return await this.getWorksheetXmlViaWorkbookDocument(worksheetName);
      case 'agent-api':
        return await this.getWorksheetXmlViaAgentApi(worksheetName);
    }
  }

  async getDashboardXml(dashboardName: string): Promise<GetDashboardXmlResult> {
    switch (this.mode) {
      case 'external-api':
        return await this.getDashboardXmlViaExternalApi(dashboardName);
      case 'workbook-document':
        return await this.getDashboardXmlViaWorkbookDocument(dashboardName);
      case 'agent-api':
        return await this.getDashboardXmlViaAgentApi(dashboardName);
    }
  }

  private async listWorksheetsViaAgentApi(): Promise<ListWorksheetsResult> {
    const result = await this.executor.executeCommand({
      namespace: 'tabui',
      command: 'list-worksheets',
      schema: z.object({
        worksheets: z.string(),
      }),
      signal: this.signal,
    });

    if (result.isErr()) {
      return result;
    }

    let worksheets: unknown;
    try {
      worksheets = JSON.parse(result.value.parsedResult.worksheets || '[]');
    } catch (e) {
      return Err({ type: 'invalid-response', error: e });
    }

    const worksheetsResult = worksheetNamesSchema.safeParse(worksheets);
    if (!worksheetsResult.success) {
      return Err({ type: 'invalid-response', error: worksheetsResult.error });
    }

    return Ok({
      count: worksheetsResult.data.worksheets.length,
      worksheets: worksheetsResult.data.worksheets.map((worksheet) =>
        decodeXmlEntities(worksheet.name),
      ),
    });
  }

  private async listDashboardsViaAgentApi(): Promise<ListDashboardsResult> {
    const result = await this.executor.executeCommand({
      namespace: 'tabui',
      command: 'list-dashboards',
      schema: z.object({
        dashboards: z.string(),
      }),
      signal: this.signal,
    });

    if (result.isErr()) {
      return result;
    }

    let dashboards: unknown;
    try {
      dashboards = JSON.parse(result.value.parsedResult.dashboards || '[]');
    } catch (e) {
      return Err({ type: 'invalid-response', error: e });
    }

    const dashboardsResult = dashboardNamesSchema.safeParse(dashboards);
    if (!dashboardsResult.success) {
      return Err({ type: 'invalid-response', error: dashboardsResult.error });
    }

    return Ok({
      count: dashboardsResult.data.dashboards.length,
      dashboards: dashboardsResult.data.dashboards.map((dashboard) =>
        decodeXmlEntities(dashboard.name),
      ),
    });
  }

  private async listWorksheetsViaExternalApi(): Promise<ListWorksheetsResult> {
    const executor = this.executor as ExternalApiToolExecutor;
    const result = await executor.listWorksheets(this.signal);
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
    const executor = this.executor as ExternalApiToolExecutor;
    const result = await executor.listDashboards(this.signal);
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

  private async getWorksheetXmlViaAgentApi(worksheetName: string): Promise<GetWorksheetXmlResult> {
    const result = await this.getWorksheetXmlViaAgentApiName({ worksheetName });
    if (result.isOk() || !nameMayNeedRawCommandResolution(worksheetName)) {
      return result;
    }

    if (
      result.error.type !== 'get-worksheet-xml-error' ||
      result.error.error.type !== 'no-worksheet-found'
    ) {
      return result;
    }

    const commandName = await resolveWorksheetCommandName(worksheetName, {
      executor: this.executor,
      signal: this.signal,
    });
    if (!commandName || commandName === worksheetName) {
      return result;
    }

    return await this.getWorksheetXmlViaAgentApiName({
      worksheetName: commandName,
      requestedWorksheetName: worksheetName,
    });
  }

  private async getWorksheetXmlViaAgentApiName({
    worksheetName,
    requestedWorksheetName = worksheetName,
  }: {
    worksheetName: string;
    requestedWorksheetName?: string;
  }): Promise<GetWorksheetXmlResult> {
    const result = await this.executor.executeCommand({
      namespace: 'tabui',
      command: 'save-worksheet',
      args: {
        worksheetName,
      },
      schema: z.object({
        worksheetXml: z.string(),
      }),
      signal: this.signal,
    });

    if (result.isErr()) {
      return Err({ type: 'execute-command-error', error: result.error });
    }

    const worksheetXml = result.value.parsedResult.worksheetXml;
    const worksheetCount = (worksheetXml.match(/<worksheet/g) || []).length;

    if (worksheetCount === 0) {
      const didYouMean = await this.worksheetNameSuggestions(requestedWorksheetName);
      return Err({
        type: 'get-worksheet-xml-error',
        error: {
          type: 'no-worksheet-found',
          message: `No worksheet found for ${requestedWorksheetName}.${didYouMean}`,
        },
      });
    }

    if (worksheetCount > 1) {
      return Err({
        type: 'get-worksheet-xml-error',
        error: {
          type: 'multiple-worksheets-found',
          message: `${worksheetCount} worksheets found instead of 1.`,
        },
      });
    }

    return Ok(worksheetXml);
  }

  private async getDashboardXmlViaAgentApi(dashboardName: string): Promise<GetDashboardXmlResult> {
    const result = await this.getDashboardXmlViaAgentApiName({ dashboardName });
    if (result.isOk() || !nameMayNeedRawCommandResolution(dashboardName)) {
      return result;
    }

    if (
      result.error.type !== 'get-dashboard-xml-error' ||
      result.error.error.type !== 'no-dashboard-found'
    ) {
      return result;
    }

    const commandName = await resolveDashboardCommandName(dashboardName, {
      executor: this.executor,
      signal: this.signal,
    });
    if (!commandName || commandName === dashboardName) {
      return result;
    }

    return await this.getDashboardXmlViaAgentApiName({
      dashboardName: commandName,
      requestedDashboardName: dashboardName,
    });
  }

  private async getDashboardXmlViaAgentApiName({
    dashboardName,
    requestedDashboardName = dashboardName,
  }: {
    dashboardName: string;
    requestedDashboardName?: string;
  }): Promise<GetDashboardXmlResult> {
    const result = await this.executor.executeCommand({
      namespace: 'tabui',
      command: 'save-dashboard',
      args: {
        dashboardName,
      },
      schema: z.object({
        dashboardXml: z.string(),
      }),
      signal: this.signal,
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

  private async getWorksheetXmlViaExternalApi(
    worksheetName: string,
  ): Promise<GetWorksheetXmlResult> {
    const executor = this.executor as ExternalApiToolExecutor;
    const worksheetsResult = await executor.listWorksheets(this.signal);
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

    const documentResult = await executor.getWorksheetDocument(
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
    const executor = this.executor as ExternalApiToolExecutor;
    const dashboardsResult = await executor.listDashboards(this.signal);
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

    const documentResult = await executor.getDashboardDocument(
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

function selectMode(executor: ToolExecutor, config: Config): WorkbookReadMode {
  if (executor instanceof ExternalApiToolExecutor) {
    return 'external-api';
  }
  if (config.externalApiEnabled) {
    return 'workbook-document';
  }
  return 'agent-api';
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
