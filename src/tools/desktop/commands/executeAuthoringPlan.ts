import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { knownLiveFailureFixFor } from '../../../desktop/commandPolicy.js';
import { guardCommand } from '../../../desktop/commands/externalApiCommandGuard.js';
import type { WorkbookDocument } from '../../../desktop/externalApi/externalApiClient.js';
import {
  DashboardItem,
  WorkbookInventory,
  WorksheetItem,
} from '../../../desktop/externalApi/types.js';
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
  command: z.string().describe("'namespace:command' ID."),
  args: z.record(z.unknown()).optional(),
  expect: postconditionSchema.optional(),
});

type PlanPostcondition = z.infer<typeof postconditionSchema>;

const paramsSchema = {
  session: z.string().optional().describe('Session ID if not pinned.'),
  steps: z.array(stepSchema).min(1).max(24).describe('1-24 ordered steps.'),
  verify: z
    .array(z.string())
    .optional()
    .describe('Sheet/dashboard names to verify after the plan.'),
  summary_worksheet: z.string().optional().describe('Worksheet to read summary rows from.'),
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

type PlanResultBody = {
  message: string;
  steps: PlanStepResult[];
  readback?: PlanReadback;
};

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
      'Runs an ordered plan of guarded Tableau commands in one call; stops at first failure; optional readback and typed per-step postconditions after the last step.',
    paramsSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async (
      { session, steps, verify, summary_worksheet },
      extra,
    ): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args: { session, steps, verify, summary_worksheet },
        callback: async (): Promise<Result<PlanResult, McpToolError>> => {
          const preparedResult = prepareSteps(steps);
          if (preparedResult.isErr()) {
            return preparedResult;
          }

          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }
          const resolvedSession = sessionResult.value;
          const executor = await extra.getExecutor(resolvedSession);
          const stepResults: PlanStepResult[] = [];

          for (const step of preparedResult.value) {
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

          const expectations = preparedResult.value.flatMap(({ step, expect }) =>
            expect ? [{ step, expect }] : [],
          );
          if (!hasReadbackRequest(verify, summary_worksheet, expectations)) {
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
              await performReadback(verify, summary_worksheet, expectations, read),
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
): Result<PreparedStep[], McpToolError> {
  const prepared: PreparedStep[] = [];
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
      expect: step.expect,
    });
  }
  return new Ok(prepared);
}

function refusedPlan(
  stepNumber: number,
  command: string,
  reason: string,
): Result<PreparedStep[], McpToolError> {
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
  return (verify?.length ?? 0) > 0 || Boolean(summaryWorksheet) || expectations.length > 0;
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
