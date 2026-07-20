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
  SummaryDataOptions,
  WorkbookDocument,
} from './externalApiClient.js';
import { ExternalApiReads } from './externalApiReads.js';
import {
  DashboardItem,
  DashboardList,
  DatasourceList,
  ExternalApiError,
  ExternalApiInstance,
  OperationEnvelope,
  ProblemResponse,
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
  envelopeError: ProblemResponse | undefined;
  createdAt: string | undefined;
  completedAt: string | undefined;
  operationId: string | undefined;
};

/**
 * {@link ToolExecutor} implementation that speaks the Tableau Desktop External Client
 * API ("Athena V0") instead of the legacy Agent API. Its endpoints are exposed as
 * first-class typed calls ({@link ExternalApiReads}); `executeCommand` carries only
 * genuine Agent-registry commands, routed to POST /v0/app:invokeCommand.
 *
 * On a 401 (stale discovery file) the executor rescans discovery exactly once and
 * retries with the fresh instance/token.
 */
export class ExternalApiToolExecutor extends ToolExecutor implements ExternalApiReads {
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

    // `executeCommand` now carries only genuine Agent-registry commands: every command reaches
    // the generic POST /v0/app:invokeCommand escape hatch. The API's own endpoints are typed
    // methods on this class ({@link ExternalApiReads}), not commands.
    const outcomeResult = await this.withRescan(async (client) => {
      const result = await client.invokeCommand(namespace, command, resolvedArgs, signal);
      return result.map((envelope) => normalizeEnvelope(envelope));
    });

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

  private async withRescan<T>(
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

  // --- ExternalApiReads: the API's endpoints as first-class typed calls. Each runs under
  // withRescan (401 → rescan once) and maps transport errors to ExecuteCommandError so command
  // modules see the same error shape they get from executeCommand. ---

  getWorkbookDocument(signal: AbortSignal): Promise<Result<WorkbookDocument, ExecuteCommandError>> {
    return this.read((client) => client.getWorkbookDocument(signal));
  }

  async applyWorkbookDocument(
    xml: string,
    signal: AbortSignal,
  ): Promise<Result<void, ExecuteCommandError>> {
    const outcome = await this.withRescan((client) =>
      client.applyWorkbookDocument(xml, signal).then((r) => r.map(normalizeEnvelope)),
    );
    if (outcome.isErr()) {
      return Err(mapClientError(outcome.error));
    }
    // A completed operation whose envelope reports failure must surface as an error, not success.
    const status = buildCommandStatus(outcome.value, {
      namespace: 'external',
      command: 'apply-workbook-document',
    });
    return status.map(() => undefined);
  }

  listWorksheets(signal: AbortSignal): Promise<Result<WorksheetList, ExecuteCommandError>> {
    return this.read((client) => client.listWorksheets(signal));
  }

  getWorksheet(
    id: string,
    signal: AbortSignal,
  ): Promise<Result<WorksheetItem, ExecuteCommandError>> {
    return this.read((client) => client.getWorksheet(id, signal));
  }

  getWorksheetDocument(
    id: string,
    signal: AbortSignal,
  ): Promise<Result<WorkbookDocument, ExecuteCommandError>> {
    return this.read((client) => client.getWorksheetDocument(id, signal));
  }

  getWorksheetSummaryData(
    id: string,
    options: SummaryDataOptions,
    signal: AbortSignal,
  ): Promise<Result<SummaryData, ExecuteCommandError>> {
    return this.read((client) => client.getWorksheetSummaryData(id, options, signal));
  }

  listDashboards(signal: AbortSignal): Promise<Result<DashboardList, ExecuteCommandError>> {
    return this.read((client) => client.listDashboards(signal));
  }

  getDashboard(
    id: string,
    signal: AbortSignal,
  ): Promise<Result<DashboardItem, ExecuteCommandError>> {
    return this.read((client) => client.getDashboard(id, signal));
  }

  getDashboardDocument(
    id: string,
    signal: AbortSignal,
  ): Promise<Result<WorkbookDocument, ExecuteCommandError>> {
    return this.read((client) => client.getDashboardDocument(id, signal));
  }

  listStoryboards(signal: AbortSignal): Promise<Result<StoryboardList, ExecuteCommandError>> {
    return this.read((client) => client.listStoryboards(signal));
  }

  getStoryboard(
    id: string,
    signal: AbortSignal,
  ): Promise<Result<StoryboardItem, ExecuteCommandError>> {
    return this.read((client) => client.getStoryboard(id, signal));
  }

  getStoryboardDocument(
    id: string,
    signal: AbortSignal,
  ): Promise<Result<WorkbookDocument, ExecuteCommandError>> {
    return this.read((client) => client.getStoryboardDocument(id, signal));
  }

  getWorkbookInventory(
    signal: AbortSignal,
  ): Promise<Result<WorkbookInventory, ExecuteCommandError>> {
    return this.read((client) => client.getWorkbookInventory(signal));
  }

  listWorkbookDatasources(
    signal: AbortSignal,
  ): Promise<Result<DatasourceList, ExecuteCommandError>> {
    return this.read((client) => client.listWorkbookDatasources(signal));
  }

  getSite(signal: AbortSignal): Promise<Result<Site, ExecuteCommandError>> {
    return this.read((client) => client.getSite(signal));
  }

  listSiteDatasources(
    signal: AbortSignal,
  ): Promise<Result<SiteDatasourceList, ExecuteCommandError>> {
    return this.read((client) => client.listSiteDatasources(signal));
  }

  listSiteWorkbooks(signal: AbortSignal): Promise<Result<SiteWorkbookList, ExecuteCommandError>> {
    return this.read((client) => client.listSiteWorkbooks(signal));
  }

  validateWorkbookDocument(
    xml: string,
    signal: AbortSignal,
  ): Promise<Result<ValidationResult, ExecuteCommandError>> {
    return this.read((client) => client.validateWorkbookDocument(xml, signal));
  }

  /** Run a typed client call under withRescan, mapping transport errors to ExecuteCommandError. */
  private async read<T>(
    op: (client: ExternalApiClient) => Promise<Result<T, ExternalApiError>>,
  ): Promise<Result<T, ExecuteCommandError>> {
    const result = await this.withRescan(op);
    return result.mapErr(mapClientError);
  }
}

function normalizeEnvelope(envelope: OperationEnvelope): RawOutcome {
  return {
    result: isRecord(envelope.result) ? envelope.result : undefined,
    state: envelope.state,
    envelopeError: envelope.error,
    createdAt: envelope.createdAt,
    completedAt: envelope.completedAt,
    operationId: envelope.operationId,
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
        message:
          outcome.envelopeError?.detail ??
          outcome.envelopeError?.title ??
          `Command ${namespace}:${command} failed`,
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
