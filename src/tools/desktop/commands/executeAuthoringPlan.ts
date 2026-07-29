import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { knownLiveFailureFixFor } from '../../../desktop/commandPolicy.js';
import { guardCommand } from '../../../desktop/commands/externalApiCommandGuard.js';
import type { WorkbookDocument } from '../../../desktop/externalApi/externalApiClient.js';
import type { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import {
  DashboardItem,
  WorkbookInventory,
  WorksheetItem,
} from '../../../desktop/externalApi/types.js';
import { resolveField } from '../../../desktop/metadata/field-resolver.js';
import { normalizeArray, parseXML } from '../../../desktop/metadata/parser.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import {
  matchWorksheetFilterSignature,
  readWorksheetSignature,
} from '../../../desktop/validation/readback-verify.js';
import {
  DesktopCommandExecutionError,
  IncompleteOperationError,
  McpToolError,
} from '../../../errors/mcpToolError.js';
import type { GetCommandStatusResponse } from '../../../sdks/desktop/agentApi/types.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import {
  fetchWorksheetSummaryData,
  type WorksheetSummaryData,
} from '../data-source/summaryDataCore.js';
import { type ExternalApiRead, runExternalApiReadTool } from '../externalApiReadHarness.js';
import {
  jsonToolResult,
  prefillNextAction,
  type StructuredResult,
  withNextAction,
} from '../structuredContent.js';
import { DesktopTool } from '../tool.js';
import { checkAuthoringCapabilityCensus } from './authoringCapabilityCensus.js';

const DEFAULT_MAX_ROWS = 200;

const postconditionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('worksheet-exists'), name: z.string() }),
  z.object({
    kind: z.literal('filter-signature'),
    worksheet: z.string(),
    column: z.string(),
    members: z.array(z.string()),
    mode: z.enum(['include', 'exclude']),
    function: z.string().optional(),
  }),
  z.object({ kind: z.literal('mark-type'), worksheet: z.string(), mark: z.string() }),
  z.object({
    kind: z.literal('encoding'),
    worksheet: z.string(),
    channel: z.string(),
    field: z.string(),
  }),
  z.object({
    kind: z.literal('dashboard-contains'),
    dashboard: z.string(),
    worksheet: z.string(),
  }),
]);

const stepSchema = z.object({
  command: z.string().describe('Command ID.'),
  args: z.record(z.unknown()).optional(),
  expect: postconditionSchema.optional(),
});

type PlanPostcondition = z.infer<typeof postconditionSchema>;

const paramsSchema = {
  session: z.string().optional().describe('Session ID.'),
  mode: z.enum(['compile', 'execute']).default('execute').describe('Validate or execute.'),
  steps: z.array(stepSchema).min(1).max(24).describe('1-24 steps.'),
  verify: z.array(z.string()).optional().describe('Post-plan targets.'),
  summary_worksheet: z
    .union([z.string(), z.array(z.string()).min(2)])
    .optional()
    .describe('Summary worksheet.'),
};

type PreparedStep = {
  step: number;
  command: string;
  namespace: 'tabui' | 'tabdoc';
  cmd: string;
  dispatchArgs: Record<string, unknown>;
  expect?: PlanPostcondition;
};

type PlanStepResult = {
  step: number;
  command: string;
  status: GetCommandStatusResponse['status'];
};

type NamedReadback = {
  requested: string[];
  observed: Array<{ id: string; name: string; kind: 'worksheet' | 'dashboard' }>;
  missing: string[];
};

type PlanReadback = {
  verified?: NamedReadback;
  postconditions?: PostconditionReadback[];
  summary_data?: {
    worksheet: { id: string; name: string };
    max_rows: number;
    columns: unknown[];
    rows: unknown[][];
  };
};

type PostconditionReadback = {
  step: number;
  kind: PlanPostcondition['kind'];
  status: 'passed' | 'mismatch' | 'unobservable';
  expected: string;
  observed: string;
};

type ExecutePlanResultBody = {
  message: string;
  steps: PlanStepResult[];
  readback?: PlanReadback;
};

type CompilePlanResultBody = {
  message: 'Plan compiled, nothing executed.';
  compiled: true;
  steps: Array<{
    command: string;
    args: Record<string, unknown>;
    expect?: PlanPostcondition;
  }>;
  capabilities_used: string[];
  would_verify: PlannedVerification[];
};

type PlannedVerification =
  | { kind: 'postcondition'; step: number; expect: PlanPostcondition }
  | { kind: 'name-exists'; target: string }
  | { kind: 'summary-data'; worksheet: string; max_rows: number };

type PlanResultBody = ExecutePlanResultBody | CompilePlanResultBody;
type PlanResult = StructuredResult<PlanResultBody>;

const title = 'Execute Authoring Plan';
export const getExecuteAuthoringPlanTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'execute-authoring-plan',
    title,
    description:
      'Submitting the plan is the capability and field check: preflight validates every step and field reference before any run and refuses safely with "No step ran." Do not pre-verify fields with resolve-field or scan search-commands; submit the plan and read the refusal.',
    paramsSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async (
      { session, mode = 'execute', steps, verify, summary_worksheet },
      extra,
    ): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args: { session, mode, steps, verify, summary_worksheet },
        callback: async (): Promise<Result<PlanResult, McpToolError>> => {
          const preparedResult = prepareSteps(steps, summary_worksheet);
          if (preparedResult.isErr()) {
            return preparedResult;
          }
          const normalizedSummaryWorksheet = normalizeSummaryWorksheet(summary_worksheet);
          const fieldReferences = collectPlannedFieldReferences(preparedResult.value.steps);
          if (mode === 'compile') {
            if (fieldReferences.length > 0) {
              const sessionResult = resolveSession(session);
              if (sessionResult.isErr()) {
                return sessionResult.error.toErr();
              }
              const executor = await extra.getExecutor(sessionResult.value);
              const fieldPreflight = await preflightFieldReferences(
                fieldReferences,
                executor,
                extra.signal,
              );
              if (fieldPreflight.isErr()) {
                return fieldPreflight;
              }
            }
            return new Ok(
              withNextAction(
                {
                  message: 'Plan compiled, nothing executed.',
                  compiled: true,
                  steps: preparedResult.value.steps.map(({ command, dispatchArgs, expect }) => ({
                    command,
                    args: dispatchArgs,
                    ...(expect ? { expect } : {}),
                  })),
                  capabilities_used: preparedResult.value.capabilitiesUsed,
                  would_verify: plannedVerifications(
                    preparedResult.value.steps,
                    verify,
                    normalizedSummaryWorksheet,
                  ),
                },
                prefillNextAction('Execute the compiled plan when ready'),
              ),
            );
          }

          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }
          const resolvedSession = sessionResult.value;
          const executor = await extra.getExecutor(resolvedSession);
          const fieldPreflight = await preflightFieldReferences(
            fieldReferences,
            executor,
            extra.signal,
          );
          if (fieldPreflight.isErr()) {
            return fieldPreflight;
          }
          const stepResults: PlanStepResult[] = [];

          for (const step of preparedResult.value.steps) {
            const result = await executor.executeCommand({
              namespace: step.namespace,
              command: step.cmd,
              args: step.dispatchArgs,
              signal: extra.signal,
            });

            if (result.isErr()) {
              const error = new DesktopCommandExecutionError(
                result.error,
                knownLiveFailureFixFor(step.command),
              );
              return incompletePlan(
                `Step ${step.step} (${step.command}) failed: ${error.getErrorText()} Executed before failure: ${formatExecutedSteps(
                  stepResults,
                )}. No later step ran.`,
                stepResults,
                'Correct the failed step before running another plan',
              );
            }

            const stepResult = {
              step: step.step,
              command: step.command,
              status: result.value.status,
            };
            stepResults.push(stepResult);
            if (result.value.status !== 'completed') {
              return incompletePlan(
                `Step ${step.step} (${step.command}) reports status "${result.value.status}". Completion was not observed. Executed before it: ${formatExecutedSteps(
                  stepResults.slice(0, -1),
                )}. No later step ran.`,
                stepResults,
                'Read workbook state before deciding how to continue',
              );
            }
          }

          const expectations = preparedResult.value.steps.flatMap(({ step, expect }) =>
            expect ? [{ step, expect }] : [],
          );
          if (!hasReadbackRequest(verify, normalizedSummaryWorksheet, expectations)) {
            return new Ok(
              withNextAction(
                {
                  message:
                    'Plan executed, but the outcome is unverified. Read back workbook state before claiming completion.',
                  steps: stepResults,
                },
                prefillNextAction('Read back workbook state before claiming completion'),
              ),
            );
          }

          const readbackResult = await runExternalApiReadTool({
            session: resolvedSession,
            extra,
            callback: async (_executor, _signal, read) =>
              await performReadback(verify, normalizedSummaryWorksheet, expectations, read),
          });
          if (readbackResult.isErr()) {
            return incompletePlan(
              `All ${stepResults.length} steps reported completed, but readback failed: ${readbackResult.error.getErrorText()} The outcome is unverified.`,
              stepResults,
              'Correct the readback request before claiming completion',
            );
          }

          const readbackValue = readbackResult.value;
          const firstFailure = readbackValue.postconditions?.find(
            ({ status }) => status !== 'passed',
          );
          if (firstFailure) {
            const unavailable = firstFailure.status === 'unobservable';
            return incompletePlan(
              `Postcondition ${unavailable ? 'could not be observed' : 'mismatch'} at step ${
                firstFailure.step
              } (${firstFailure.kind}). Expected ${firstFailure.expected}; ${
                unavailable ? 'observed unavailable' : `observed ${firstFailure.observed}`
              }.`,
              stepResults,
              'Correct failed postcondition before claiming completion',
              readbackValue,
            );
          }
          if (readbackValue.verified && readbackValue.verified.missing.length > 0) {
            return incompletePlan(
              `Missing verify target(s): ${readbackValue.verified.missing.join(', ')}. The plan outcome is unverified.`,
              stepResults,
              'Correct missing verify targets before claiming completion',
              readbackValue,
            );
          }
          if (normalizedSummaryWorksheet !== undefined && !readbackValue.summary_data) {
            return incompletePlan(
              'Requested summary readback is absent. The plan outcome is unverified.',
              stepResults,
              'Correct summary readback before claiming completion',
              readbackValue,
            );
          }
          if (readbackValue.summary_data?.rows.length === 0) {
            return incompletePlan(
              'Summary readback returned no rows; values are unverified.',
              stepResults,
              'Correct summary readback before claiming completion',
              readbackValue,
            );
          }
          return new Ok(
            withNextAction(
              {
                message:
                  expectations.length > 0
                    ? `Plan done: all ${expectations.length} declared postcondition(s) passed.`
                    : describeReadback(readbackValue),
                steps: stepResults,
                readback: readbackValue,
              },
              prefillNextAction('Review observed readback before claiming completion'),
            ),
          );
        },
        getSuccessResult: (result) => jsonToolResult(result, { isError: false }),
      });
    },
  });

  return tool;
};

function prepareSteps(
  steps: Array<{
    command: string;
    args?: Record<string, unknown>;
    expect?: PlanPostcondition;
  }>,
  summaryWorksheet: string | string[] | undefined,
): Result<{ steps: PreparedStep[]; capabilitiesUsed: string[] }, McpToolError> {
  const parsedCommands: Array<{
    namespace: 'tabui' | 'tabdoc';
    cmd: string;
  }> = [];
  for (const [index, step] of steps.entries()) {
    const stepNumber = index + 1;
    const parts = step.command.split(':');
    if (parts.length !== 2) {
      return refusedPlan(
        stepNumber,
        step.command,
        `Invalid command format. Expected 'namespace:command' (e.g., 'tabdoc:save'), got: ${step.command}`,
      );
    }

    const [namespace, cmd] = parts;
    if (namespace !== 'tabui' && namespace !== 'tabdoc') {
      return refusedPlan(
        stepNumber,
        step.command,
        `Invalid namespace "${namespace}". Expected 'tabui' or 'tabdoc'.`,
      );
    }
    parsedCommands.push({ namespace, cmd });
  }

  const census = checkAuthoringCapabilityCensus({ steps, summaryWorksheet });
  if (census.missing) {
    return refusedCapability(census.missing.name, census.missing.reason);
  }

  const prepared: PreparedStep[] = [];
  for (const [index, step] of steps.entries()) {
    const stepNumber = index + 1;
    const { namespace, cmd } = parsedCommands[index];
    const parsedPostcondition = postconditionSchema.safeParse(step.expect);
    if (step.expect !== undefined && !parsedPostcondition.success) {
      return refusedPlan(
        stepNumber,
        step.command,
        `Invalid postcondition: ${parsedPostcondition.error.issues
          .map(({ message }) => message)
          .join('; ')}.`,
      );
    }

    const commandGuard = guardCommand({
      namespace,
      cmd,
      command: step.command,
      args: step.args,
    });
    if ('refused' in commandGuard) {
      return refusedPlan(stepNumber, step.command, commandGuard.message);
    }

    prepared.push({
      step: stepNumber,
      command: step.command,
      namespace,
      cmd,
      dispatchArgs: commandGuard.dispatchArgs,
      expect: parsedPostcondition.success ? parsedPostcondition.data : undefined,
    });
  }
  return new Ok({ steps: prepared, capabilitiesUsed: census.capabilitiesUsed });
}

type PlannedFieldReference = {
  step: number;
  command: string;
  field: string;
};

function collectPlannedFieldReferences(steps: PreparedStep[]): PlannedFieldReference[] {
  const references = new Map<string, PlannedFieldReference>();

  for (const step of steps) {
    if (step.command !== 'tabdoc:generate-viz-from-notional-spec') continue;
    const rawSpec = step.dispatchArgs.NotionalSpecJson;
    if (typeof rawSpec !== 'string') continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawSpec);
    } catch {
      continue;
    }
    if (!isRecord(parsed)) continue;

    const add = (value: unknown): void => {
      if (typeof value !== 'string' || value.trim().length === 0) return;
      const field = value.trim();
      if (!references.has(field)) {
        references.set(field, { step: step.step, command: step.command, field });
      }
    };

    if (Array.isArray(parsed.fields)) {
      for (const field of parsed.fields) {
        if (!isRecord(field)) continue;
        add(typeof field.fieldIdentifier === 'string' ? field.fieldIdentifier : field.caption);
      }
    }
    if (isRecord(parsed.sort)) {
      add(parsed.sort.field);
      add(parsed.sort.by);
    }
    for (const key of [
      'rangeFilters',
      'dateRangeFilters',
      'relativeDateFilters',
      'categoricalFilters',
    ]) {
      const filters = parsed[key];
      if (!Array.isArray(filters)) continue;
      for (const filter of filters) {
        if (isRecord(filter)) add(filter.field);
      }
    }
  }

  return [...references.values()];
}

async function preflightFieldReferences(
  references: PlannedFieldReference[],
  executor: ExternalApiToolExecutor,
  signal: AbortSignal,
): Promise<Result<void, McpToolError>> {
  if (references.length === 0) {
    return new Ok(undefined);
  }

  const documentResult = await executor.getWorkbookDocument(signal);
  const first = references[0];
  if (documentResult.isErr()) {
    const error = new DesktopCommandExecutionError(documentResult.error);
    return refusedPlan(
      first.step,
      first.command,
      `Could not validate field references: ${error.getErrorText()}`,
    );
  }

  let unresolved: PlannedFieldReference[];
  try {
    unresolved = references.filter(({ field }) => {
      const resolution = resolveField(documentResult.value.xml, field);
      return resolution.kind !== 'exact' && resolution.kind !== 'rewritten';
    });
  } catch (error) {
    return refusedPlan(
      first.step,
      first.command,
      `Could not validate field references from the workbook document: ${
        error instanceof Error ? error.message : String(error)
      }.`,
    );
  }

  if (unresolved.length > 0) {
    const refused = unresolved[0];
    return refusedPlan(
      refused.step,
      refused.command,
      `Unresolved field reference(s): ${unresolved
        .map(({ field }) => JSON.stringify(field))
        .join(', ')}.`,
    );
  }

  return new Ok(undefined);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function refusedPlan(
  stepNumber: number,
  command: string,
  reason: string,
): Result<never, McpToolError> {
  return new IncompleteOperationError(
    withNextAction(
      {
        message: `Plan refused during preflight at step ${stepNumber} (${command}): ${reason} No step ran.`,
        steps: [],
      },
      prefillNextAction('Correct the refused step before running the plan'),
    ),
  ).toErr();
}

function refusedCapability(name: string, reason: string): Result<never, McpToolError> {
  return new IncompleteOperationError(
    withNextAction(
      {
        message: `Plan refused during preflight: requires uncensused capability '${name}': ${reason} No step ran.`,
        steps: [],
      },
      prefillNextAction('Revise the plan to use admitted capabilities'),
    ),
  ).toErr();
}

function incompletePlan(
  message: string,
  steps: PlanStepResult[],
  nextAction: string,
  readback?: PlanReadback,
): Result<PlanResult, McpToolError> {
  return new IncompleteOperationError<PlanResultBody>(
    withNextAction(
      { message, steps, ...(readback ? { readback } : {}) },
      prefillNextAction(nextAction),
    ),
  ).toErr();
}

function formatExecutedSteps(steps: PlanStepResult[]): string {
  return steps.length > 0
    ? steps.map(({ step, command }) => `${step} (${command})`).join(', ')
    : 'none';
}

function hasReadbackRequest(
  verify: string[] | undefined,
  summaryWorksheet: string | undefined,
  expectations: Array<{ step: number; expect: PlanPostcondition }>,
): boolean {
  return (verify?.length ?? 0) > 0 || summaryWorksheet !== undefined || expectations.length > 0;
}

function normalizeSummaryWorksheet(
  summaryWorksheet: string | string[] | undefined,
): string | undefined {
  return Array.isArray(summaryWorksheet) ? summaryWorksheet[0] : summaryWorksheet;
}

function plannedVerifications(
  steps: PreparedStep[],
  verify: string[] | undefined,
  summaryWorksheet: string | undefined,
): PlannedVerification[] {
  return [
    ...steps.flatMap(({ step, expect }) =>
      expect ? [{ kind: 'postcondition' as const, step, expect }] : [],
    ),
    ...(verify ?? []).map((target) => ({ kind: 'name-exists' as const, target })),
    ...(summaryWorksheet
      ? [{ kind: 'summary-data' as const, worksheet: summaryWorksheet, max_rows: DEFAULT_MAX_ROWS }]
      : []),
  ];
}

async function performReadback(
  verify: string[] | undefined,
  summaryWorksheet: string | undefined,
  expectations: Array<{ step: number; expect: PlanPostcondition }>,
  read: ExternalApiRead,
): Promise<Result<PlanReadback, McpToolError>> {
  const output: PlanReadback = {};
  if ((verify?.length ?? 0) > 0 || expectations.length > 0) {
    const inventoryResult = await read(
      'workbook inventory',
      async (executor, signal) => await executor.getWorkbook(signal),
    );
    if (inventoryResult.isErr()) {
      if (expectations.length === 0) return inventoryResult;
      const observed = inventoryResult.error.getErrorText();
      output.postconditions = expectations.map(({ step, expect }) => ({
        step,
        kind: expect.kind,
        status: 'unobservable',
        expected: JSON.stringify(expect),
        observed,
      }));
    } else {
      if ((verify?.length ?? 0) > 0) {
        output.verified = matchNamedItems(verify ?? [], inventoryResult.value);
      }
      if (expectations.length > 0) {
        output.postconditions = await evaluatePostconditions(
          expectations,
          inventoryResult.value,
          read,
        );
      }
    }
  }

  if (summaryWorksheet) {
    const maxRows = DEFAULT_MAX_ROWS;
    const summaryResult = await fetchWorksheetSummaryData({
      read,
      worksheet: summaryWorksheet,
      maxRows,
    });
    if (summaryResult.isErr()) {
      return summaryResult.error.type === 'worksheet'
        ? summaryResult.error.error.toErr()
        : summaryResult.error.error.toErr();
    }
    output.summary_data = shapeSummaryReadback(summaryResult.value, maxRows);
  }

  return new Ok(output);
}

function matchNamedItems(requested: string[], inventory: WorkbookInventory): NamedReadback {
  const available = [
    ...(inventory.worksheets ?? []).map((item: WorksheetItem) => ({
      id: item.id,
      name: item.name,
      kind: 'worksheet' as const,
    })),
    ...(inventory.dashboards ?? []).map((item: DashboardItem) => ({
      id: item.id,
      name: item.name,
      kind: 'dashboard' as const,
    })),
  ];
  const observed = requested.flatMap((target) => {
    const trimmed = target.trim();
    const match = available.find(({ id, name }) => id === trimmed || name === trimmed);
    return match ? [match] : [];
  });
  const observedKeys = new Set(observed.flatMap(({ id, name }) => [id, name]));
  return {
    requested,
    observed,
    missing: requested.filter((target) => !observedKeys.has(target.trim())),
  };
}

async function evaluatePostconditions(
  expectations: Array<{ step: number; expect: PlanPostcondition }>,
  inventory: WorkbookInventory,
  read: ExternalApiRead,
): Promise<PostconditionReadback[]> {
  const worksheetDocuments = new Map<string, Promise<Result<WorkbookDocument, McpToolError>>>();
  const dashboardDocuments = new Map<string, Promise<Result<WorkbookDocument, McpToolError>>>();
  const outcomes: PostconditionReadback[] = [];

  const worksheetDocument = (
    worksheet: WorksheetItem,
  ): Promise<Result<WorkbookDocument, McpToolError>> => {
    const cached = worksheetDocuments.get(worksheet.id);
    if (cached) return cached;
    const requested = read(
      `worksheet "${worksheet.name}" document`,
      async (executor, signal) => await executor.getWorksheetDocument(worksheet.id, signal),
    );
    worksheetDocuments.set(worksheet.id, requested);
    return requested;
  };
  const dashboardDocument = (
    dashboard: DashboardItem,
  ): Promise<Result<WorkbookDocument, McpToolError>> => {
    const cached = dashboardDocuments.get(dashboard.id);
    if (cached) return cached;
    const requested = read(
      `dashboard "${dashboard.name}" document`,
      async (executor, signal) => await executor.getDashboardDocument(dashboard.id, signal),
    );
    dashboardDocuments.set(dashboard.id, requested);
    return requested;
  };

  for (const { step, expect } of expectations) {
    const expected = JSON.stringify(expect);
    if (expect.kind === 'worksheet-exists') {
      const matched = findWorksheet(inventory, expect.name);
      outcomes.push({
        step,
        kind: expect.kind,
        status: matched ? 'passed' : 'mismatch',
        expected,
        observed: JSON.stringify((inventory.worksheets ?? []).map(({ name }) => name)),
      });
      continue;
    }

    if (expect.kind === 'dashboard-contains') {
      const dashboard = findDashboard(inventory, expect.dashboard);
      if (!dashboard) {
        outcomes.push(unobservable(step, expect, `dashboard "${expect.dashboard}" not observed`));
        continue;
      }
      const document = await dashboardDocument(dashboard);
      if (document.isErr()) {
        outcomes.push(unobservable(step, expect, document.error.getErrorText()));
        continue;
      }
      const zoneNames = readDashboardZoneNames(document.value.xml);
      if (!zoneNames) {
        outcomes.push(unobservable(step, expect, 'dashboard document could not be parsed'));
        continue;
      }
      outcomes.push({
        step,
        kind: expect.kind,
        status: zoneNames.includes(expect.worksheet) ? 'passed' : 'mismatch',
        expected,
        observed: JSON.stringify(zoneNames),
      });
      continue;
    }

    const worksheet = findWorksheet(inventory, expect.worksheet);
    if (!worksheet) {
      outcomes.push(unobservable(step, expect, `worksheet "${expect.worksheet}" not observed`));
      continue;
    }
    const document = await worksheetDocument(worksheet);
    if (document.isErr()) {
      outcomes.push(unobservable(step, expect, document.error.getErrorText()));
      continue;
    }

    if (expect.kind === 'filter-signature') {
      const match = matchWorksheetFilterSignature(document.value.xml, expect);
      if (!match) {
        outcomes.push(unobservable(step, expect, 'worksheet document could not be parsed'));
        continue;
      }
      outcomes.push({
        step,
        kind: expect.kind,
        status: match.matched ? 'passed' : 'mismatch',
        expected,
        observed: JSON.stringify(match.observed),
      });
      continue;
    }

    const signature = readWorksheetSignature(document.value.xml);
    if (!signature) {
      outcomes.push(unobservable(step, expect, 'worksheet document could not be parsed'));
      continue;
    }
    if (expect.kind === 'mark-type') {
      const observed = signature.marks.map(({ klass }) => klass);
      outcomes.push({
        step,
        kind: expect.kind,
        status: observed.includes(expect.mark) ? 'passed' : 'mismatch',
        expected,
        observed: JSON.stringify(observed),
      });
      continue;
    }

    const observed = signature.encodings.map(({ tag, column }) => ({
      channel: tag,
      field: column,
    }));
    outcomes.push({
      step,
      kind: expect.kind,
      status: observed.some(
        ({ channel, field }) => channel === expect.channel && field === expect.field,
      )
        ? 'passed'
        : 'mismatch',
      expected,
      observed: JSON.stringify(observed),
    });
  }

  return outcomes;
}

function unobservable(
  step: number,
  expect: PlanPostcondition,
  observed: string,
): PostconditionReadback {
  return {
    step,
    kind: expect.kind,
    status: 'unobservable',
    expected: JSON.stringify(expect),
    observed,
  };
}

function findWorksheet(inventory: WorkbookInventory, target: string): WorksheetItem | undefined {
  return (inventory.worksheets ?? []).find(({ id, name }) => id === target || name === target);
}

function findDashboard(inventory: WorkbookInventory, target: string): DashboardItem | undefined {
  return (inventory.dashboards ?? []).find(({ id, name }) => id === target || name === target);
}

function readDashboardZoneNames(xml: string): string[] | null {
  try {
    const names: string[] = [];
    walkXml(parseXML(xml), (tag, node) => {
      if (tag === 'zone' && typeof node['@_name'] === 'string') {
        names.push(node['@_name']);
      }
    });
    return names;
  } catch {
    return null;
  }
}

function walkXml(node: unknown, visit: (tag: string, node: Record<string, unknown>) => void): void {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return;
  for (const [tag, value] of Object.entries(node)) {
    if (tag.startsWith('@_') || tag === '#text') continue;
    for (const child of normalizeArray(value)) {
      if (!child || typeof child !== 'object' || Array.isArray(child)) continue;
      visit(tag, child as Record<string, unknown>);
      walkXml(child, visit);
    }
  }
}

function shapeSummaryReadback(
  summary: WorksheetSummaryData,
  maxRows: number,
): NonNullable<PlanReadback['summary_data']> {
  return {
    worksheet: { id: summary.worksheet.id, name: summary.worksheet.name },
    max_rows: maxRows,
    columns: summary.columns,
    rows: summary.rows,
  };
}

function describeReadback(readback: PlanReadback): string {
  const observations: string[] = [];
  if (readback.verified) {
    observations.push(describeNamedReadback(readback.verified));
  }
  if (readback.summary_data) {
    observations.push(
      `${readback.summary_data.rows.length} summary-data row(s) across ${
        readback.summary_data.columns.length
      } column(s) for worksheet "${readback.summary_data.worksheet.name}"`,
    );
  }
  return `Readback observed ${observations.join('; ')}.`;
}

function describeNamedReadback(readback: NamedReadback): string {
  const observed =
    readback.observed.length > 0
      ? readback.observed.map(({ kind, name }) => `${kind} "${name}"`).join(', ')
      : 'no requested items';
  return readback.missing.length > 0
    ? `${observed}; requested item(s) not observed: ${readback.missing.join(', ')}`
    : observed;
}
