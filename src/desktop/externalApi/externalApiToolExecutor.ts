import { Err, Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { log } from '../../logging/logger.js';
import { GetCommandStatusResponse, GetEventsResponse } from '../../sdks/desktop/agentApi/types.js';
import {
  ExecuteCommandArgs,
  ExecuteCommandError,
  ExecuteCommandResult,
  GetEventsArgs,
  ToolExecutor,
} from '../toolExecutor/toolExecutor.js';
import {
  ExternalApiClient,
  ExternalApiClientOptions,
  WorkbookDocument,
  WorksheetSummaryDataQuery,
} from './externalApiClient.js';
import {
  ApiRoot,
  AppInfo,
  DashboardItem,
  DashboardList,
  DatasourceList,
  ExternalApiError,
  ExternalApiInstance,
  OperationEnvelope,
  OperationError,
  Site,
  SiteDatasourceList,
  SiteWorkbookList,
  StoryboardItem,
  StoryboardList,
  SummaryData,
  ValidationResult,
  WorkbookInventory,
  WorksheetItem,
  WorksheetList,
} from './types.js';

/** The single "get whole workbook document" command, routed to GET /v0/workbook/document. */
const SAVE_UNDERLYING_METADATA = 'save-underlying-metadata';
/** The single "apply whole workbook document" command, routed to POST /v0/workbook/document. */
const LOAD_UNDERLYING_METADATA = 'load-underlying-metadata';

const LOGGER = 'ExternalApiToolExecutor';

export type ExternalApiToolExecutorDeps = {
  /** Returns candidate live instances, newest-first. Re-invoked on rescan. */
  discover: () => Array<ExternalApiInstance> | Promise<Array<ExternalApiInstance>>;
  /** Preferred instance pid (e.g. the MCP session id). Falls back to newest. */
  pid?: number;
  /** Options forwarded to each {@link ExternalApiClient}. */
  clientOptions?: ExternalApiClientOptions;
  /** Client factory — injectable for tests. Defaults to a real client. */
  createClient?: (
    instance: ExternalApiInstance,
    options?: ExternalApiClientOptions,
  ) => ExternalApiClient;
};

type NoInstance = { type: 'no-instance'; pinnedPid?: number };

/** Normalized shape shared by document + invokeCommand responses. */
type RawOutcome = {
  result: Record<string, unknown> | undefined;
  state: string | undefined;
  envelopeError: OperationError | undefined;
  createdAt: string | undefined;
  completedAt: string | undefined;
  operationId: string | undefined;
};

/**
 * {@link ToolExecutor} implementation that speaks the Tableau Desktop External Client
 * API ("Athena V0") instead of the legacy Agent API.
 *
 * Command surface → endpoint mapping (thin, verified against localToolExecutor's
 * command shapes):
 *   - `tabui:save-underlying-metadata` (is-json !== true) → GET  /v0/workbook/document
 *   - `tabui:load-underlying-metadata` (with `text`)      → POST /v0/workbook/document
 *   - everything else                                     → POST /v0/app:invokeCommand
 *     (the API resolves the SAME legacy command registry, so params pass through as-is)
 *
 * On a 401 (stale discovery file) the executor rescans discovery exactly once and
 * retries with the fresh instance/token.
 */
export class ExternalApiToolExecutor extends ToolExecutor {
  private readonly deps: ExternalApiToolExecutorDeps;
  private client: ExternalApiClient | undefined;

  constructor(deps: ExternalApiToolExecutorDeps) {
    super();
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

    const resolved = await this.resolveClient();
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
    this.client = undefined;
  }

  isAvailable(): boolean {
    return this.client !== undefined;
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

    const outcomeResult = await this.withRescan((client) =>
      this.callEndpoint(client, { namespace, command, args: resolvedArgs, signal }),
    );

    if (outcomeResult.isErr()) {
      const mapped = mapClientError(outcomeResult.error);
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

  async listWorksheets(signal: AbortSignal): Promise<Result<WorksheetList, ExecuteCommandError>> {
    return this.readExternalApi((client) => client.listWorksheets(signal));
  }

  async health(signal: AbortSignal): Promise<Result<{ healthy: boolean }, ExecuteCommandError>> {
    return this.readExternalApi((client) => client.health(signal));
  }

  async getRoot(signal: AbortSignal): Promise<Result<ApiRoot, ExecuteCommandError>> {
    return this.readExternalApi((client) => client.getRoot(signal));
  }

  async listDashboards(signal: AbortSignal): Promise<Result<DashboardList, ExecuteCommandError>> {
    return this.readExternalApi((client) => client.listDashboards(signal));
  }

  async listStoryboards(signal: AbortSignal): Promise<Result<StoryboardList, ExecuteCommandError>> {
    return this.readExternalApi((client) => client.listStoryboards(signal));
  }

  async getWorkbook(signal: AbortSignal): Promise<Result<WorkbookInventory, ExecuteCommandError>> {
    return this.readExternalApi((client) => client.getWorkbook(signal));
  }

  async listWorkbookDatasources(
    signal: AbortSignal,
  ): Promise<Result<DatasourceList, ExecuteCommandError>> {
    return this.readExternalApi((client) => client.listWorkbookDatasources(signal));
  }

  async listSiteWorkbooks(
    signal: AbortSignal,
  ): Promise<Result<SiteWorkbookList, ExecuteCommandError>> {
    return this.readExternalApi((client) => client.listSiteWorkbooks(signal));
  }

  async getSite(signal: AbortSignal): Promise<Result<Site, ExecuteCommandError>> {
    return this.readExternalApi((client) => client.getSite(signal));
  }

  async getWorksheet(
    worksheetId: string,
    signal: AbortSignal,
  ): Promise<Result<WorksheetItem, ExecuteCommandError>> {
    return this.readExternalApi((client) => client.getWorksheet(worksheetId, signal));
  }

  async getDashboard(
    dashboardId: string,
    signal: AbortSignal,
  ): Promise<Result<DashboardItem, ExecuteCommandError>> {
    return this.readExternalApi((client) => client.getDashboard(dashboardId, signal));
  }

  async getStoryboard(
    storyboardId: string,
    signal: AbortSignal,
  ): Promise<Result<StoryboardItem, ExecuteCommandError>> {
    return this.readExternalApi((client) => client.getStoryboard(storyboardId, signal));
  }

  async getWorksheetDocument(
    worksheetId: string,
    signal: AbortSignal,
  ): Promise<Result<WorkbookDocument, ExecuteCommandError>> {
    return this.readExternalApi((client) => client.getWorksheetDocument(worksheetId, signal));
  }

  async getDashboardDocument(
    dashboardId: string,
    signal: AbortSignal,
  ): Promise<Result<WorkbookDocument, ExecuteCommandError>> {
    return this.readExternalApi((client) => client.getDashboardDocument(dashboardId, signal));
  }

  async getStoryboardDocument(
    storyboardId: string,
    signal: AbortSignal,
  ): Promise<Result<WorkbookDocument, ExecuteCommandError>> {
    return this.readExternalApi((client) => client.getStoryboardDocument(storyboardId, signal));
  }

  async getApp(signal: AbortSignal): Promise<Result<AppInfo, ExecuteCommandError>> {
    return this.readExternalApi((client) => client.getApp(signal));
  }

  async getWorksheetSummaryData(
    worksheetId: string,
    query: WorksheetSummaryDataQuery,
    signal: AbortSignal,
  ): Promise<Result<SummaryData, ExecuteCommandError>> {
    return this.readExternalApi((client) =>
      client.getWorksheetSummaryData(worksheetId, query, signal),
    );
  }

  async validateWorkbookDocument(
    xml: string,
    signal: AbortSignal,
  ): Promise<Result<ValidationResult, ExecuteCommandError>> {
    return this.readExternalApi((client) => client.validateWorkbookDocument(xml, signal));
  }

  async listSiteDatasources(
    signal: AbortSignal,
  ): Promise<Result<SiteDatasourceList, ExecuteCommandError>> {
    return this.readExternalApi((client) => client.listSiteDatasources(signal));
  }

  async getEvents({ signal: _signal }: GetEventsArgs): Promise<Result<GetEventsResponse, unknown>> {
    // The External Client API contract (this PR revision) exposes no events endpoint.
    // See residual risk in the deliverable report.
    log({
      message: 'getEvents is not supported by the External Client API transport',
      level: 'warning',
      logger: LOGGER,
    });
    return Err(new Error('getEvents is not supported by the External Client API transport.'));
  }

  private createClient(instance: ExternalApiInstance): ExternalApiClient {
    const factory =
      this.deps.createClient ??
      ((i: ExternalApiInstance, o?: ExternalApiClientOptions): ExternalApiClient =>
        new ExternalApiClient(i, o));
    return factory(instance, this.deps.clientOptions);
  }

  private async resolveClient(): Promise<Result<ExternalApiClient, NoInstance>> {
    const instances = await this.deps.discover();
    // A pinned pid must match exactly. Falling back to instances[0] here would silently
    // retarget a different Desktop, which is the split-brain this pin exists to prevent.
    const chosen =
      this.deps.pid !== undefined
        ? instances.find((instance) => instance.pid === this.deps.pid)
        : instances[0];

    if (!chosen) {
      this.client = undefined;
      return Err({ type: 'no-instance', pinnedPid: this.deps.pid });
    }

    this.client = this.createClient(chosen);
    return Ok(this.client);
  }

  private async ensureClient(): Promise<Result<ExternalApiClient, NoInstance>> {
    if (this.client) {
      return Ok(this.client);
    }
    return this.resolveClient();
  }

  private async withRescan(
    op: (client: ExternalApiClient) => Promise<Result<RawOutcome, ExternalApiError>>,
  ): Promise<Result<RawOutcome, ExternalApiError | NoInstance>> {
    const first = await this.ensureClient();
    if (first.isErr()) {
      return Err(first.error);
    }

    let result = await op(first.value);
    if (result.isErr() && result.error.type === 'unauthorized') {
      log({
        message: 'External Client API returned 401 — rescanning discovery once',
        level: 'warning',
        logger: LOGGER,
      });
      this.client = undefined;
      const rescanned = await this.resolveClient();
      if (rescanned.isErr()) {
        return Err(rescanned.error);
      }
      result = await op(rescanned.value);
    }

    return result;
  }

  private async readExternalApi<T>(
    op: (client: ExternalApiClient) => Promise<Result<T, ExternalApiError>>,
  ): Promise<Result<T, ExecuteCommandError>> {
    const result = await this.withClientRescan(op);
    if (result.isErr()) {
      return Err(mapClientError(result.error));
    }
    return Ok(result.value);
  }

  private async withClientRescan<T>(
    op: (client: ExternalApiClient) => Promise<Result<T, ExternalApiError>>,
  ): Promise<Result<T, ExternalApiError | NoInstance>> {
    const first = await this.ensureClient();
    if (first.isErr()) {
      return Err(first.error);
    }

    let result = await op(first.value);
    if (result.isErr() && result.error.type === 'unauthorized') {
      log({
        message: 'External Client API returned 401 — rescanning discovery once',
        level: 'warning',
        logger: LOGGER,
      });
      this.client = undefined;
      const rescanned = await this.resolveClient();
      if (rescanned.isErr()) {
        return Err(rescanned.error);
      }
      result = await op(rescanned.value);
    }

    return result;
  }

  private async callEndpoint(
    client: ExternalApiClient,
    {
      namespace,
      command,
      args,
      signal,
    }: {
      namespace: 'tabui' | 'tabdoc';
      command: string;
      args: Record<string, unknown>;
      signal: AbortSignal;
    },
  ): Promise<Result<RawOutcome, ExternalApiError>> {
    if (namespace === 'tabui' && command === SAVE_UNDERLYING_METADATA && args['is-json'] !== true) {
      const result = await client.getWorkbookDocument(signal);
      if (result.isErr()) {
        return Err(result.error);
      }
      return Ok({
        result: { text: result.value.xml },
        state: 'succeeded',
        envelopeError: undefined,
        createdAt: undefined,
        completedAt: undefined,
        operationId: undefined,
      });
    }

    if (
      namespace === 'tabui' &&
      command === LOAD_UNDERLYING_METADATA &&
      typeof args.text === 'string'
    ) {
      const result = await client.applyWorkbookDocument(args.text, signal);
      if (result.isErr()) {
        return Err(result.error);
      }
      return Ok(normalizeEnvelope(result.value));
    }

    const result = await client.invokeCommand(namespace, command, args, signal);
    if (result.isErr()) {
      return Err(result.error);
    }
    return Ok(normalizeEnvelope(result.value));
  }
}

function normalizeEnvelope(envelope: OperationEnvelope): RawOutcome {
  return {
    result: isRecord(envelope.result) ? envelope.result : undefined,
    state: envelope.state,
    envelopeError: envelope.error,
    createdAt: envelope.createdAt,
    completedAt: envelope.completedAt,
    operationId: envelope.id,
  };
}

function buildCommandStatus(
  outcome: RawOutcome,
  { namespace, command }: { namespace: string; command: string },
): Result<GetCommandStatusResponse, ExecuteCommandError> {
  const state = outcome.state?.toLowerCase();
  const failed = state === 'failed' || state === 'error' || outcome.envelopeError !== undefined;

  if (failed) {
    return Err({
      type: 'command-failed',
      error: {
        code: outcome.envelopeError?.code ?? 'operation-failed',
        message: outcome.envelopeError?.message ?? `Command ${namespace}:${command} failed`,
        recoverable: false,
      },
    });
  }

  const now = new Date().toISOString();
  return Ok({
    command_id: outcome.operationId ?? `ext_${namespace}:${command}_${Date.now()}`,
    status: 'completed',
    submitted_at: outcome.createdAt ?? now,
    started_at: outcome.createdAt ?? now,
    completed_at: outcome.completedAt ?? now,
    result: outcome.result,
  });
}

function mapClientError(error: ExternalApiError | NoInstance): ExecuteCommandError {
  switch (error.type) {
    case 'problem':
      return {
        type: 'command-failed',
        error: {
          code: error.code ?? String(error.status),
          message: error.detail ?? error.title ?? `External Client API problem (${error.status})`,
          recoverable: false,
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
      return { type: 'unknown', error: error.error };
    case 'no-instance':
      return {
        type: 'unknown',
        error:
          error.pinnedPid !== undefined
            ? `Pinned Tableau Desktop (pid ${error.pinnedPid}) is no longer running — relaunch the agent from the Desktop you want to control.`
            : 'No External Client API instance available.',
      };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
