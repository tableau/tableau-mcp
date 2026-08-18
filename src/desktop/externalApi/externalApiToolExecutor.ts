import { Err, Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { log } from '../../logging/logger.js';
import {
  BLOCKING_DIALOG_GUIDANCE,
  desktopCallTimeoutMessage,
  isDesktopCallTimeout,
} from '../callDeadline.js';
import {
  noInstanceFoundMessage,
  unknownInstanceUnreachableMessage,
  unreachableInstanceMessage,
} from '../session/unreachableInstance.js';
import { apiVersionAtLeast } from './apiVersion.js';
import {
  ApplyWorkbookDocumentOptions,
  ExecuteCommandArgs,
  ExecuteCommandError,
  ExecuteCommandResult,
  GetCommandStatusResponse,
  WorkbookDocument,
} from './executorTypes.js';
import { ExternalApiHttp, ExternalApiHttpOptions } from './externalApiHttp.js';
import {
  ApiRoot,
  apiRootSchema,
  AppInfo,
  appInfoSchema,
  dashboardDocumentRoute,
  dashboardImageRoute,
  DashboardItem,
  dashboardItemSchema,
  DashboardList,
  dashboardListSchema,
  dashboardPauseAutoUpdatesRoute,
  dashboardResumeAutoUpdatesRoute,
  dashboardRoute,
  DatasourceList,
  datasourceListSchema,
  EXTERNAL_API_ROUTES,
  ExternalApiError,
  ExternalApiInstance,
  ImageExportQuery,
  ImageResult,
  imageResultSchema,
  LogicalTableList,
  logicalTableListSchema,
  OperationEnvelope,
  OperationError,
  OperationWarning,
  sheetActionRoute,
  SheetRef,
  Site,
  SiteDatasourceList,
  siteDatasourceListSchema,
  siteSchema,
  SiteWorkbookList,
  siteWorkbookListSchema,
  storyboardDocumentRoute,
  storyboardImageRoute,
  StoryboardItem,
  storyboardItemSchema,
  StoryboardList,
  storyboardListSchema,
  storyboardRoute,
  SummaryData,
  summaryDataSchema,
  ValidationResult,
  validationResultSchema,
  WindowInfo,
  workbookDashboardsNewRoute,
  WorkbookInventory,
  workbookInventorySchema,
  workbookStoryboardsNewRoute,
  workbookWorksheetsNewRoute,
  worksheetDocumentRoute,
  worksheetImageRoute,
  WorksheetItem,
  worksheetItemSchema,
  WorksheetList,
  worksheetListSchema,
  worksheetLogicalTableDataRoute,
  worksheetLogicalTablesRoute,
  worksheetPauseAutoUpdatesRoute,
  worksheetResumeAutoUpdatesRoute,
  worksheetRoute,
  WorksheetSort,
  worksheetSortRoute,
  WorksheetSummaryDataQuery,
  worksheetSummaryDataRoute,
  WorksheetUnderlyingDataQuery,
} from './types.js';

const LOGGER = 'ExternalApiToolExecutor';

// Liveness must fail fast: the health probe runs on a shorter budget than the global
// request ceiling (the HTTP layer only ever tightens, so a smaller global still wins).
const HEALTH_TIMEOUT_MS = 10_000;

export type ExternalApiToolExecutorDeps = {
  /** Returns candidate live instances, newest-first. Re-invoked on rescan. */
  discover: () => Array<ExternalApiInstance> | Promise<Array<ExternalApiInstance>>;
  /** Preferred instance pid (e.g. the MCP session id). Falls back to newest. */
  pid?: number;
  /** Options forwarded to each {@link ExternalApiHttp}. */
  clientOptions?: ExternalApiHttpOptions;
  /** HTTP-layer factory — injectable for tests. Defaults to a real {@link ExternalApiHttp}. */
  createClient?: (
    instance: ExternalApiInstance,
    options?: ExternalApiHttpOptions,
  ) => ExternalApiHttp;
  /** Optional fail-soft observer for one logical Desktop operation, including a 401 rescan. */
  onRpc?: (event: DesktopRpcTelemetryEvent) => void | Promise<void>;
};

export type DesktopRpcTelemetryEvent = {
  operation: 'read' | 'command' | 'document_apply';
  durationMs: number;
  transportSuccess: boolean;
  rescanCount: number;
};

type NoInstance = { type: 'no-instance'; pinnedPid?: number };
type InstanceMismatch = { type: 'instance-mismatch'; expected: string; actual: string };

/** Normalized shape shared by document + invokeCommand responses. */
type RawOutcome = {
  result: Record<string, unknown> | undefined;
  state: string | undefined;
  envelopeError: OperationError | undefined;
  warnings: OperationWarning[] | undefined;
  createdAt: string | undefined;
  completedAt: string | undefined;
  operationId: string | undefined;
  apiVersion: string | undefined;
};

/**
 * The one executor for Tableau Desktop: every tool call reaches Desktop through the
 * External Client API ("Athena V0") it wraps.
 *
 * This class is the single home of the endpoint surface — each endpoint method is one
 * route (from types.ts) + schema call through the generic {@link ExternalApiHttp}.
 * Command execution uses POST /v0/app:invokeCommand; workbook document round-trips use
 * the dedicated GET/POST document routes.
 *
 * On a 401 (stale discovery file) the executor rescans discovery exactly once and
 * retries with the fresh instance/token.
 */
export class ExternalApiToolExecutor {
  private readonly deps: ExternalApiToolExecutorDeps;
  private http: ExternalApiHttp | undefined;

  constructor(deps: ExternalApiToolExecutorDeps) {
    this.deps = deps;
  }

  async start(): Promise<void> {
    log({
      message:
        'ExternalApiToolExecutor starting — desktop transport: External Client API (Athena V0)',
      level: 'info',
      logger: LOGGER,
      data: { pid: this.deps.pid },
    });

    const resolved = await this.resolveHttp();
    if (resolved.isErr()) {
      log({
        message: 'No External Client API instance discovered yet',
        level: 'warning',
        logger: LOGGER,
        data: { pid: this.deps.pid },
      });
      return;
    }

    log({
      message: 'Connected to External Client API instance',
      level: 'info',
      logger: LOGGER,
      data: { baseUrl: resolved.value.baseUrl, pid: resolved.value.pid },
    });
  }

  stop(): void {
    log({ message: 'ExternalApiToolExecutor stopped', level: 'info', logger: LOGGER });
    this.http = undefined;
  }

  isAvailable(): boolean {
    return this.http !== undefined;
  }

  get desktopInstanceId(): string | undefined {
    return this.http?.instanceId;
  }

  async executeCommand(
    args: ExecuteCommandArgs<undefined>,
  ): Promise<Result<ExecuteCommandResult, ExecuteCommandError>>;
  async executeCommand<Z extends z.ZodTypeAny>(
    args: ExecuteCommandArgs<Z>,
  ): Promise<Result<ExecuteCommandResult<Z>, ExecuteCommandError>>;
  async executeCommand({
    command,
    namespace,
    signal,
    args,
    schema,
  }: ExecuteCommandArgs<z.ZodTypeAny | undefined>): Promise<
    Result<
      ExecuteCommandResult<undefined> | ExecuteCommandResult<z.ZodTypeAny>,
      ExecuteCommandError
    >
  > {
    const resolvedArgs = args ?? {};

    const outcomeResult = await this.withRescan('command', async (http) => {
      const result = await http.postJsonEnvelope(
        EXTERNAL_API_ROUTES.invokeCommand,
        { namespace, command, parameters: resolvedArgs },
        signal,
      );
      if (result.isErr()) {
        return Err(result.error);
      }
      return Ok(normalizeEnvelope(result.value, http.apiVersion));
    });

    if (outcomeResult.isErr()) {
      const mapped = mapClientError(outcomeResult.error, this.deps.pid);
      log({
        message: `Failed to execute command ${namespace}:${command} via External Client API`,
        level: 'error',
        logger: LOGGER,
        data: mapped,
      });
      return Err(mapped);
    }

    const statusResult = buildCommandStatus(outcomeResult.value, { namespace, command });
    if (statusResult.isErr()) {
      log({
        message: `Command ${namespace}:${command} failed`,
        level: 'error',
        logger: LOGGER,
        data: statusResult.error,
      });
      return statusResult;
    }

    const commandResult = statusResult.value;
    if (!schema) {
      return Ok(commandResult);
    }

    const resultObject = commandResult.result ?? {};
    const safeParsedResult = schema.safeParse(resultObject);
    if (!safeParsedResult.success) {
      log({
        message: `Failed to parse command result with schema ${schema.toString()}.`,
        level: 'error',
        logger: LOGGER,
        data: safeParsedResult.error,
      });
      return Err({ type: 'unknown', error: safeParsedResult.error });
    }

    return Ok({ ...commandResult, parsedResult: safeParsedResult.data });
  }

  async health(signal: AbortSignal): Promise<Result<{ healthy: boolean }, ExecuteCommandError>> {
    return this.readExternalApi(async (http) => {
      const probe = await http.getOk(EXTERNAL_API_ROUTES.health, signal, {
        timeoutMs: HEALTH_TIMEOUT_MS,
      });
      return probe.map(({ ok }) => ({ healthy: ok }));
    });
  }

  async getRoot(signal: AbortSignal): Promise<Result<ApiRoot, ExecuteCommandError>> {
    return this.readExternalApi((http) =>
      http.getJson(EXTERNAL_API_ROUTES.root, apiRootSchema, signal),
    );
  }

  async getApp(signal: AbortSignal): Promise<Result<AppInfo, ExecuteCommandError>> {
    return this.readExternalApi((http) =>
      http.getJson(EXTERNAL_API_ROUTES.app, appInfoSchema, signal),
    );
  }

  async getSite(signal: AbortSignal): Promise<Result<Site, ExecuteCommandError>> {
    return this.readExternalApi((http) =>
      http.getJson(EXTERNAL_API_ROUTES.site, siteSchema, signal),
    );
  }

  async listSiteWorkbooks(
    signal: AbortSignal,
  ): Promise<Result<SiteWorkbookList, ExecuteCommandError>> {
    return this.readExternalApi((http) =>
      http.getJson(EXTERNAL_API_ROUTES.siteWorkbooks, siteWorkbookListSchema, signal),
    );
  }

  async listSiteDatasources(
    signal: AbortSignal,
  ): Promise<Result<SiteDatasourceList, ExecuteCommandError>> {
    return this.readExternalApi((http) =>
      http.getJson(EXTERNAL_API_ROUTES.siteDatasources, siteDatasourceListSchema, signal),
    );
  }

  async getWorkbook(signal: AbortSignal): Promise<Result<WorkbookInventory, ExecuteCommandError>> {
    return this.readExternalApi((http) =>
      http.getJson(EXTERNAL_API_ROUTES.workbook, workbookInventorySchema, signal),
    );
  }

  async listWorksheets(signal: AbortSignal): Promise<Result<WorksheetList, ExecuteCommandError>> {
    return this.readExternalApi((http) =>
      http.getJson(EXTERNAL_API_ROUTES.workbookWorksheets, worksheetListSchema, signal),
    );
  }

  async listDashboards(signal: AbortSignal): Promise<Result<DashboardList, ExecuteCommandError>> {
    return this.readExternalApi((http) =>
      http.getJson(EXTERNAL_API_ROUTES.workbookDashboards, dashboardListSchema, signal),
    );
  }

  async listStoryboards(signal: AbortSignal): Promise<Result<StoryboardList, ExecuteCommandError>> {
    return this.readExternalApi((http) =>
      http.getJson(EXTERNAL_API_ROUTES.workbookStoryboards, storyboardListSchema, signal),
    );
  }

  async listWorkbookDatasources(
    signal: AbortSignal,
  ): Promise<Result<DatasourceList, ExecuteCommandError>> {
    return this.readExternalApi((http) =>
      http.getJson(EXTERNAL_API_ROUTES.workbookDatasources, datasourceListSchema, signal),
    );
  }

  async getWorksheet(
    worksheetId: string,
    signal: AbortSignal,
  ): Promise<Result<WorksheetItem, ExecuteCommandError>> {
    return this.readExternalApi((http) =>
      http.getJson(worksheetRoute(worksheetId), worksheetItemSchema, signal),
    );
  }

  async getDashboard(
    dashboardId: string,
    signal: AbortSignal,
  ): Promise<Result<DashboardItem, ExecuteCommandError>> {
    return this.readExternalApi((http) =>
      http.getJson(dashboardRoute(dashboardId), dashboardItemSchema, signal),
    );
  }

  async getStoryboard(
    storyboardId: string,
    signal: AbortSignal,
  ): Promise<Result<StoryboardItem, ExecuteCommandError>> {
    return this.readExternalApi((http) =>
      http.getJson(storyboardRoute(storyboardId), storyboardItemSchema, signal),
    );
  }

  async getWorkbookDocument(
    signal: AbortSignal,
  ): Promise<Result<WorkbookDocument, ExecuteCommandError>> {
    return this.readExternalApi(async (http) => {
      const result = await http.getXml(EXTERNAL_API_ROUTES.workbookDocument, signal);
      if (result.isErr()) return result;
      return Ok({ ...result.value, instanceId: http.instanceId });
    });
  }

  async getWorksheetDocument(
    worksheetId: string,
    signal: AbortSignal,
  ): Promise<Result<WorkbookDocument, ExecuteCommandError>> {
    return this.readExternalApi((http) => http.getXml(worksheetDocumentRoute(worksheetId), signal));
  }

  async getDashboardDocument(
    dashboardId: string,
    signal: AbortSignal,
  ): Promise<Result<WorkbookDocument, ExecuteCommandError>> {
    return this.readExternalApi((http) => http.getXml(dashboardDocumentRoute(dashboardId), signal));
  }

  async getStoryboardDocument(
    storyboardId: string,
    signal: AbortSignal,
  ): Promise<Result<WorkbookDocument, ExecuteCommandError>> {
    return this.readExternalApi((http) =>
      http.getXml(storyboardDocumentRoute(storyboardId), signal),
    );
  }

  async getWorksheetSummaryData(
    worksheetId: string,
    query: WorksheetSummaryDataQuery,
    signal: AbortSignal,
  ): Promise<Result<SummaryData, ExecuteCommandError>> {
    return this.readExternalApi((http) =>
      http.getJson(worksheetSummaryDataRoute(worksheetId, query), summaryDataSchema, signal),
    );
  }

  async listWorksheetLogicalTables(
    worksheetId: string,
    signal: AbortSignal,
  ): Promise<Result<LogicalTableList, ExecuteCommandError>> {
    return this.readExternalApi((http) =>
      http.getJson(worksheetLogicalTablesRoute(worksheetId), logicalTableListSchema, signal),
    );
  }

  async getWorksheetUnderlyingData(
    worksheetId: string,
    logicalTableId: string,
    query: WorksheetUnderlyingDataQuery,
    signal: AbortSignal,
  ): Promise<Result<SummaryData, ExecuteCommandError>> {
    return this.readExternalApi((http) =>
      http.getJson(
        worksheetLogicalTableDataRoute(worksheetId, logicalTableId, query),
        summaryDataSchema,
        signal,
      ),
    );
  }

  async exportWorksheetImage(
    worksheetId: string,
    query: ImageExportQuery,
    signal: AbortSignal,
  ): Promise<Result<ImageResult, ExecuteCommandError>> {
    return this.readExternalApi((http) =>
      http.getJson(worksheetImageRoute(worksheetId, query), imageResultSchema, signal),
    );
  }

  async exportDashboardImage(
    dashboardId: string,
    query: ImageExportQuery,
    signal: AbortSignal,
  ): Promise<Result<ImageResult, ExecuteCommandError>> {
    return this.readExternalApi((http) =>
      http.getJson(dashboardImageRoute(dashboardId, query), imageResultSchema, signal),
    );
  }

  async exportStoryboardImage(
    storyboardId: string,
    query: ImageExportQuery,
    signal: AbortSignal,
  ): Promise<Result<ImageResult, ExecuteCommandError>> {
    return this.readExternalApi((http) =>
      http.getJson(storyboardImageRoute(storyboardId, query), imageResultSchema, signal),
    );
  }

  async validateWorkbookDocument(
    xml: string,
    signal: AbortSignal,
  ): Promise<Result<ValidationResult, ExecuteCommandError>> {
    return this.readExternalApi((http) =>
      http.postXmlForBody(
        EXTERNAL_API_ROUTES.workbookDocumentValidate,
        xml,
        validationResultSchema,
        signal,
      ),
    );
  }

  async applyWorkbookDocument(
    xml: string,
    signal: AbortSignal,
    options?: ApplyWorkbookDocumentOptions,
  ): Promise<Result<ExecuteCommandResult<undefined>, ExecuteCommandError>> {
    return this.applyDocument(
      (http) => http.postXmlEnvelope(EXTERNAL_API_ROUTES.workbookDocument, xml, signal),
      'apply-workbook-document',
      options,
    );
  }

  async applyWorksheetDocument(
    worksheetId: string,
    xml: string,
    signal: AbortSignal,
  ): Promise<Result<ExecuteCommandResult<undefined>, ExecuteCommandError>> {
    return this.applyDocument(
      (http) => http.postXmlEnvelope(worksheetDocumentRoute(worksheetId), xml, signal),
      'apply-worksheet-document',
    );
  }

  async applyDashboardDocument(
    dashboardId: string,
    xml: string,
    signal: AbortSignal,
  ): Promise<Result<ExecuteCommandResult<undefined>, ExecuteCommandError>> {
    return this.applyDocument(
      (http) => http.postXmlEnvelope(dashboardDocumentRoute(dashboardId), xml, signal),
      'apply-dashboard-document',
    );
  }

  async applyStoryboardDocument(
    storyboardId: string,
    xml: string,
    signal: AbortSignal,
  ): Promise<Result<ExecuteCommandResult<undefined>, ExecuteCommandError>> {
    return this.applyDocument(
      (http) => http.postXmlEnvelope(storyboardDocumentRoute(storyboardId), xml, signal),
      'apply-storyboard-document',
    );
  }

  async undo(
    signal: AbortSignal,
  ): Promise<Result<ExecuteCommandResult<undefined>, ExecuteCommandError>> {
    return this.applyDocument(
      (http) => http.postEnvelope(EXTERNAL_API_ROUTES.workbookUndo, signal),
      'undo',
    );
  }

  async redo(
    signal: AbortSignal,
  ): Promise<Result<ExecuteCommandResult<undefined>, ExecuteCommandError>> {
    return this.applyDocument(
      (http) => http.postEnvelope(EXTERNAL_API_ROUTES.workbookRedo, signal),
      'redo',
    );
  }

  async deleteSheet(
    sheet: SheetRef,
    signal: AbortSignal,
  ): Promise<Result<ExecuteCommandResult<undefined>, ExecuteCommandError>> {
    return this.applyDocument(
      (http) => http.postEnvelope(sheetActionRoute(sheet, 'delete'), signal),
      'delete-sheet',
    );
  }

  async renameSheet(
    sheet: SheetRef,
    name: string,
    signal: AbortSignal,
  ): Promise<Result<ExecuteCommandResult<undefined>, ExecuteCommandError>> {
    return this.applyDocument(
      (http) => http.postJsonEnvelope(sheetActionRoute(sheet, 'rename'), { name }, signal),
      'rename-sheet',
    );
  }

  async sortWorksheet(
    worksheetId: string,
    sort: WorksheetSort,
    signal: AbortSignal,
  ): Promise<Result<ExecuteCommandResult<undefined>, ExecuteCommandError>> {
    return this.applyDocument(
      (http) => http.postJsonEnvelope(worksheetSortRoute(worksheetId), sort, signal),
      'sort-worksheet',
    );
  }

  async goToSheet(
    sheetId: string,
    signal: AbortSignal,
  ): Promise<Result<ExecuteCommandResult<undefined>, ExecuteCommandError>> {
    return this.applyDocument(
      (http) =>
        http.postJsonEnvelope(EXTERNAL_API_ROUTES.workbookGoToSheet, { id: sheetId }, signal),
      'go-to-sheet',
    );
  }

  async pauseWorksheetAutoUpdates(
    worksheetId: string,
    signal: AbortSignal,
  ): Promise<Result<ExecuteCommandResult<undefined>, ExecuteCommandError>> {
    return this.applyDocument(
      (http) => http.postEnvelope(worksheetPauseAutoUpdatesRoute(worksheetId), signal),
      'pause-worksheet-auto-updates',
    );
  }

  async resumeWorksheetAutoUpdates(
    worksheetId: string,
    signal: AbortSignal,
  ): Promise<Result<ExecuteCommandResult<undefined>, ExecuteCommandError>> {
    return this.applyDocument(
      (http) => http.postEnvelope(worksheetResumeAutoUpdatesRoute(worksheetId), signal),
      'resume-worksheet-auto-updates',
    );
  }

  async pauseDashboardAutoUpdates(
    dashboardId: string,
    signal: AbortSignal,
  ): Promise<Result<ExecuteCommandResult<undefined>, ExecuteCommandError>> {
    return this.applyDocument(
      (http) => http.postEnvelope(dashboardPauseAutoUpdatesRoute(dashboardId), signal),
      'pause-dashboard-auto-updates',
    );
  }

  async resumeDashboardAutoUpdates(
    dashboardId: string,
    signal: AbortSignal,
  ): Promise<Result<ExecuteCommandResult<undefined>, ExecuteCommandError>> {
    return this.applyDocument(
      (http) => http.postEnvelope(dashboardResumeAutoUpdatesRoute(dashboardId), signal),
      'resume-dashboard-auto-updates',
    );
  }

  async openFile(
    filePath: string,
    signal: AbortSignal,
  ): Promise<Result<ExecuteCommandResult<undefined>, ExecuteCommandError>> {
    return this.applyDocument(
      (http) => http.postJsonEnvelope(EXTERNAL_API_ROUTES.appOpenFile, { filePath }, signal),
      'open-workbook-file',
    );
  }

  async saveWorkbook(
    filePath: string | undefined,
    signal: AbortSignal,
  ): Promise<Result<ExecuteCommandResult<undefined>, ExecuteCommandError>> {
    return this.applyDocument(
      (http) =>
        http.postJsonEnvelope(
          EXTERNAL_API_ROUTES.workbookSave,
          filePath !== undefined ? { filePath } : {},
          signal,
        ),
      'save-workbook-file',
    );
  }

  async addWorksheet(
    index: number | undefined,
    signal: AbortSignal,
  ): Promise<Result<ExecuteCommandResult<undefined>, ExecuteCommandError>> {
    return this.applyDocument(
      (http) => http.postEnvelope(workbookWorksheetsNewRoute(index), signal),
      'new-worksheet',
    );
  }

  async addDashboard(
    index: number | undefined,
    signal: AbortSignal,
  ): Promise<Result<ExecuteCommandResult<undefined>, ExecuteCommandError>> {
    return this.applyDocument(
      (http) => http.postEnvelope(workbookDashboardsNewRoute(index), signal),
      'new-dashboard',
    );
  }

  async addStoryboard(
    index: number | undefined,
    signal: AbortSignal,
  ): Promise<Result<ExecuteCommandResult<undefined>, ExecuteCommandError>> {
    return this.applyDocument(
      (http) => http.postEnvelope(workbookStoryboardsNewRoute(index), signal),
      'new-storyboard',
    );
  }

  /**
   * Shared document-apply pipeline for the whole-workbook and per-sheet POST routes: run the
   * HTTP call through withRescan, normalize the operation envelope, then fold it into a
   * command-status result (envelope FAILED / Tableau error → command-failed). `command` labels
   * the operation for logs and the synthetic command id.
   */
  private async applyDocument(
    call: (http: ExternalApiHttp) => Promise<Result<OperationEnvelope, ExternalApiError>>,
    command: string,
    options?: ApplyWorkbookDocumentOptions,
  ): Promise<Result<ExecuteCommandResult<undefined>, ExecuteCommandError>> {
    const outcomeResult = await this.withRescan('document_apply', async (http) => {
      if (
        options?.expectedInstanceId !== undefined &&
        http.instanceId !== options.expectedInstanceId
      ) {
        return Err({
          type: 'instance-mismatch' as const,
          expected: options.expectedInstanceId,
          actual: http.instanceId,
        });
      }
      options?.onDispatch?.();
      const result = await call(http);
      if (result.isErr()) {
        return Err(result.error);
      }
      return Ok(normalizeEnvelope(result.value, http.apiVersion));
    });

    if (outcomeResult.isErr()) {
      const mapped = mapClientError(outcomeResult.error, this.deps.pid);
      log({
        message: `Failed to ${command} via External Client API`,
        level: 'error',
        logger: LOGGER,
        data: mapped,
      });
      return Err(mapped);
    }

    const statusResult = buildCommandStatus(outcomeResult.value, {
      namespace: 'external-api',
      command,
    });
    if (statusResult.isErr()) {
      log({
        message: `Document apply failed: ${command}`,
        level: 'error',
        logger: LOGGER,
        data: statusResult.error,
      });
    }
    return statusResult;
  }

  private createHttp(instance: ExternalApiInstance): ExternalApiHttp {
    const factory =
      this.deps.createClient ??
      ((i: ExternalApiInstance, o?: ExternalApiHttpOptions): ExternalApiHttp =>
        new ExternalApiHttp(i, o));
    return factory(instance, this.deps.clientOptions);
  }

  private async resolveHttp(): Promise<Result<ExternalApiHttp, NoInstance>> {
    const instances = await this.deps.discover();
    // A pinned pid must match exactly. Falling back to instances[0] here would silently
    // retarget a different Desktop, which is the split-brain this pin exists to prevent.
    const chosen =
      this.deps.pid !== undefined
        ? instances.find((instance) => instance.pid === this.deps.pid)
        : instances[0];

    if (!chosen) {
      this.http = undefined;
      return Err({ type: 'no-instance', pinnedPid: this.deps.pid });
    }

    this.http = this.createHttp(chosen);
    return Ok(this.http);
  }

  private async ensureHttp(): Promise<Result<ExternalApiHttp, NoInstance>> {
    if (this.http) {
      return Ok(this.http);
    }
    return this.resolveHttp();
  }

  private async withRescan<T>(
    operation: DesktopRpcTelemetryEvent['operation'],
    op: (http: ExternalApiHttp) => Promise<Result<T, ExternalApiError | InstanceMismatch>>,
  ): Promise<Result<T, ExternalApiError | NoInstance | InstanceMismatch>> {
    const startedAt = performance.now();
    let rescanCount = 0;
    let finalResult: Result<T, ExternalApiError | NoInstance | InstanceMismatch> | undefined;
    try {
      const first = await this.ensureHttp();
      if (first.isErr()) {
        finalResult = Err(first.error);
        return finalResult;
      }

      let result = await op(first.value);
      if (result.isErr() && result.error.type === 'unauthorized') {
        rescanCount = 1;
        log({
          message: 'External Client API returned 401 — rescanning discovery once',
          level: 'warning',
          logger: LOGGER,
        });
        this.http = undefined;
        const rescanned = await this.resolveHttp();
        if (rescanned.isErr()) {
          finalResult = Err(rescanned.error);
          return finalResult;
        }
        result = await op(rescanned.value);
      }

      finalResult = result;
      return finalResult;
    } finally {
      try {
        const delivery = this.deps.onRpc?.({
          operation,
          durationMs: performance.now() - startedAt,
          transportSuccess: finalResult?.isOk() ?? false,
          rescanCount,
        });
        void delivery?.catch(() => undefined);
      } catch {
        // Telemetry is observational and must never alter a Desktop operation.
      }
    }
  }

  private async readExternalApi<T>(
    op: (http: ExternalApiHttp) => Promise<Result<T, ExternalApiError>>,
  ): Promise<Result<T, ExecuteCommandError>> {
    const result = await this.withRescan('read', op);
    if (result.isErr()) {
      return Err(mapClientError(result.error, this.deps.pid));
    }
    return Ok(result.value);
  }
}

function normalizeEnvelope(envelope: OperationEnvelope, apiVersion?: string): RawOutcome {
  return {
    result: isRecord(envelope.result) ? envelope.result : undefined,
    state: envelope.state,
    envelopeError: envelope.error,
    warnings: envelope.warnings,
    createdAt: envelope.createdAt,
    completedAt: envelope.completedAt,
    operationId: envelope.id,
    apiVersion,
  };
}

function buildCommandStatus(
  outcome: RawOutcome,
  { namespace, command }: { namespace: string; command: string },
): Result<GetCommandStatusResponse, ExecuteCommandError> {
  const state = outcome.state?.toUpperCase();
  const failed = state === 'FAILED' || state === 'CANCELLED' || outcome.envelopeError !== undefined;

  if (failed) {
    const tableauErrorCode = getTableauErrorCode(outcome.envelopeError);
    return Err({
      type: 'command-failed',
      error: {
        code: outcome.envelopeError?.code ?? 'operation-failed',
        message: outcome.envelopeError?.message ?? `Command ${namespace}:${command} failed`,
        recoverable: false,
        ...(tableauErrorCode ? { 'tableau-error-code': tableauErrorCode } : {}),
      },
    });
  }

  // A non-terminal state reaching here means the HTTP layer's poll did not resolve it — report it
  // as still running, never as completed (the guard against the old false-success-on-202 bug).
  if (state !== 'SUCCEEDED') {
    return Ok({
      command_id: outcome.operationId ?? `ext_${namespace}:${command}_${Date.now()}`,
      status: state === 'QUEUED' ? 'queued' : 'running',
      submitted_at: outcome.createdAt ?? new Date().toISOString(),
    });
  }

  const now = new Date().toISOString();
  const resultPayload =
    outcome.result !== undefined || supportsOperationResult(outcome.apiVersion)
      ? { result: outcome.result }
      : {};
  return Ok({
    command_id: outcome.operationId ?? `ext_${namespace}:${command}_${Date.now()}`,
    status: 'completed',
    submitted_at: outcome.createdAt ?? now,
    started_at: outcome.createdAt ?? now,
    completed_at: outcome.completedAt ?? now,
    ...resultPayload,
    ...(outcome.warnings ? { warnings: outcome.warnings } : {}),
  });
}

function getTableauErrorCode(error: OperationError | undefined): string | undefined {
  const value = error?.['tableau-error-code'];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function supportsOperationResult(apiVersion: string | undefined): boolean {
  return apiVersionAtLeast(apiVersion, '0.1.1');
}

function describeBlockingWindows(windows: Array<WindowInfo> | undefined): string {
  if (windows === undefined || windows.length === 0) {
    return '';
  }
  const named = windows.map((window) => {
    const label = window.title || window.messageText || window.className || 'a dialog';
    return window.messageText && window.messageText !== label
      ? `"${label}" (${window.messageText})`
      : `"${label}"`;
  });
  return ` Open dialog(s): ${named.join('; ')}.`;
}

function mapClientError(
  error: ExternalApiError | NoInstance | InstanceMismatch,
  pinnedPid?: number,
): ExecuteCommandError {
  switch (error.type) {
    case 'instance-mismatch':
      return {
        type: 'unknown',
        error: `External Client API instance changed from ${error.expected} to ${error.actual}. Build a fresh artifact for the current Desktop instance.`,
      };
    case 'problem':
      return {
        type: 'command-failed',
        error: {
          code: error.code ?? String(error.status),
          message: error.detail ?? error.title ?? `External Client API problem (${error.status})`,
          recoverable: false,
          ...(error.code ? { 'tableau-error-code': error.code } : {}),
        },
      };
    case 'unauthorized':
      return {
        type: 'unknown',
        error: 'External Client API returned 401 after a rescan (stale discovery token).',
      };
    case 'invalid-response':
      return { type: 'invalid-response', error: error.error };
    case 'network':
      return mapNetworkFailure(error.error, pinnedPid, error.aborted);
    case 'operation-pending':
      return {
        type: 'command-failed',
        error: {
          code: 'operation-pending',
          message:
            'Desktop is still preparing this read (a prerequisite lookup is in flight). Retry the request.',
          recoverable: true,
        },
      };
    case 'awaiting-user':
      return {
        type: 'command-failed',
        error: {
          code: 'awaiting-user',
          message:
            'The operation is blocked on a Tableau Desktop dialog and cannot complete over the API ' +
            `until a person dismisses it.${describeBlockingWindows(error.blockingWindows)}`,
          recoverable: false,
        },
      };
    case 'operation-expired':
      return {
        type: 'command-timed-out',
        error: `The async operation expired before it completed (polled past the Desktop retention window). ${BLOCKING_DIALOG_GUIDANCE}`,
      };
    case 'poll-timeout':
      return {
        type: 'command-timed-out',
        error: `The async operation did not reach a terminal state within the poll deadline. ${BLOCKING_DIALOG_GUIDANCE}`,
      };
    case 'no-instance':
      return {
        type: 'unknown',
        error:
          error.pinnedPid !== undefined
            ? noInstanceFoundMessage(error.pinnedPid)
            : unknownInstanceUnreachableMessage(),
      };
  }
}

/**
 * A dead-but-cached Desktop used to surface as a raw `fetch failed`, which the agent could not
 * act on. Name the instance so it can re-target, and keep a timeout honest as a timeout.
 */
function mapNetworkFailure(
  cause: unknown,
  pinnedPid?: number,
  aborted = false,
): ExecuteCommandError {
  if (isDesktopCallTimeout(cause)) {
    return {
      type: 'command-timed-out',
      error: desktopCallTimeoutMessage({ budgetMs: cause.budgetMs }),
    };
  }

  // Caller AbortError is reported as timed out for now; MCP cancellation discards this response.
  if (
    aborted ||
    (cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError'))
  ) {
    return {
      type: 'command-timed-out',
      error:
        cause instanceof Error
          ? cause.message
          : 'External Client API request was aborted before completion.',
    };
  }

  const detail = cause instanceof Error ? cause.message : undefined;
  return {
    type: 'unknown',
    error:
      pinnedPid !== undefined
        ? unreachableInstanceMessage(pinnedPid, detail)
        : unknownInstanceUnreachableMessage(detail),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
