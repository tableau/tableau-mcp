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
import { readWorksheetSignature } from '../../../desktop/validation/readback-verify.js';
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
import {
  type AssertionReadback,
  type CompiledPlan,
  compileIntentPlan,
  type IntentAssertion,
  type IntentAssertionRecord,
  IntentDigestCompileError,
  type PlanPostcondition,
  postconditionSchema,
} from './executeAuthoringPlan.intentDigest.js';

const DEFAULT_MAX_ROWS = 200;

const postconditionInputSchema = z
  .object({
    kind: z.enum([
      'worksheet-exists',
      'dashboard-exists',
      'datasource-exists',
      'calculation-signature',
      'datasource-binding',
      'field-binding',
      'filter-signature',
      'mark-type',
      'encoding',
      'dashboard-contains',
      'dashboard-zone',
      'summary-signature',
    ]),
  })
  .passthrough()
  .describe(
    'Optional step assertion fields: worksheet-exists, dashboard-exists {name; each asserts the sheet was created by this plan (baseline-diffed)}; datasource-exists {name}; calculation-signature {datasource,name,formula,datatype,role}; datasource-binding {worksheet,datasource}; field-binding {worksheet,placement,field}; filter-signature {worksheet,column,members:string[],mode:include|exclude,function?}; mark-type {worksheet,mark}; encoding {worksheet,channel,field}; dashboard-contains {dashboard,worksheet}; dashboard-zone {dashboard,worksheet,zoneType,multiplicity}; summary-signature {worksheet,columns:string[],rows:scalar[][]}. Summary scalars: string, number, boolean, or null. Missing filter function is accepted for compatibility and normalized to null. Assertions use strict mechanical equality at readback; unavailable evidence is unobservable.',
  );

const stepSchema = z.object({
  command: z.string().describe('Command ID.'),
  args: z.record(z.unknown()).optional(),
  expect: postconditionInputSchema.optional(),
});

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
  assertions?: AssertionReadback[];
  final_diff?: AssertionReadback[];
  postconditions?: LegacyPostconditionReadback[];
  summary_data?: {
    worksheet: { id: string; name: string };
    max_rows: number;
    columns: unknown[];
    rows: unknown[][];
  };
};

type LegacyPostconditionReadback = {
  step: number;
  kind: PlanPostcondition['kind'];
  status: 'passed' | 'mismatch' | 'unobservable';
  expected: string;
  observed: string;
};

type IntentBaseline = {
  inventory: WorkbookInventory;
};

type ExecutePlanResultBody = {
  message: string;
  steps: PlanStepResult[];
  intent_digest_sha256?: string;
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
  intent_digest: CompiledPlan<PreparedStep>['digest'];
  dependency_edges: CompiledPlan<PreparedStep>['dependencyEdges'];
  would_verify: PlannedVerification[];
};

type PlannedVerification =
  | {
      kind: 'intent-assertion';
      id: string;
      step: number;
      checkpoint: IntentAssertionRecord['checkpoint'];
      expect: IntentAssertion;
    }
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
          let compiledPlan: CompiledPlan<PreparedStep>;
          try {
            compiledPlan = compileIntentPlan(preparedResult.value.steps);
          } catch (error) {
            if (error instanceof IntentDigestCompileError) {
              return refusedPlan(error.step, error.command, error.message);
            }
            throw error;
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
                  intent_digest: compiledPlan.digest,
                  dependency_edges: compiledPlan.dependencyEdges,
                  would_verify: plannedVerifications(
                    compiledPlan.digest.assertions,
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
          const baselineResult = await captureIntentBaseline(
            compiledPlan.digest.assertions,
            executor,
            extra.signal,
          );
          if (baselineResult.isErr()) {
            const firstStep = preparedResult.value.steps[0];
            return refusedPlan(
              firstStep.step,
              firstStep.command,
              `Could not capture the pre-plan baseline: ${baselineResult.error.getErrorText()}`,
            );
          }
          const intentBaseline = baselineResult.value;
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

            const checkpointIds =
              compiledPlan.immediateAssertionIdsByProducingStep[step.step] ?? [];
            if (checkpointIds.length > 0) {
              const checkpointAssertions = compiledPlan.digest.assertions.filter(({ id }) =>
                checkpointIds.includes(id),
              );
              const checkpointResult = await runExternalApiReadTool({
                session: resolvedSession,
                extra,
                callback: async (_executor, _signal, read) =>
                  await performReadback(
                    undefined,
                    undefined,
                    checkpointAssertions,
                    read,
                    intentBaseline,
                  ),
              });
              if (checkpointResult.isErr()) {
                return incompletePlan(
                  `Checkpoint readback failed after step ${step.step} (${step.command}) for digest ${compiledPlan.digest.sha256}: ${checkpointResult.error.getErrorText()} Executed prefix: ${formatExecutedSteps(
                    stepResults,
                  )}. Skipped suffix: ${formatSkippedSteps(
                    preparedResult.value.steps,
                    step.step,
                  )}. No later step ran.`,
                  stepResults,
                  'Repair the readback probe before deciding whether to continue',
                  undefined,
                  compiledPlan.digest.sha256,
                );
              }
              const checkpointReadback = checkpointResult.value;
              const firstCheckpointFailure = checkpointReadback.final_diff?.[0];
              if (firstCheckpointFailure) {
                return incompletePlan(
                  formatAssertionFailure({
                    phase: 'Checkpoint',
                    failure: firstCheckpointFailure,
                    digestSha256: compiledPlan.digest.sha256,
                    command: step.command,
                    executed: stepResults,
                    skipped: preparedResult.value.steps.filter(
                      ({ step: candidate }) => candidate > step.step,
                    ),
                  }),
                  stepResults,
                  'Repair or extend the readback probe; do not repeat the write',
                  checkpointReadback,
                  compiledPlan.digest.sha256,
                );
              }
            }
          }

          const assertions = compiledPlan.digest.assertions;
          if (!hasReadbackRequest(verify, normalizedSummaryWorksheet, assertions)) {
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
              await performReadback(
                verify,
                normalizedSummaryWorksheet,
                assertions,
                read,
                intentBaseline,
              ),
          });
          if (readbackResult.isErr()) {
            return incompletePlan(
              `All ${stepResults.length} steps reported completed, but readback failed: ${readbackResult.error.getErrorText()} The outcome is unverified.`,
              stepResults,
              'Correct the readback request before claiming completion',
              undefined,
              compiledPlan.digest.sha256,
            );
          }

          const readbackValue = readbackResult.value;
          const firstFailure = readbackValue.final_diff?.[0];
          if (firstFailure) {
            const unavailable = firstFailure.status === 'unobservable';
            return incompletePlan(
              `Postcondition ${unavailable ? 'could not be observed' : 'mismatch'} at step ${
                firstFailure.introducedByStep
              } (${firstFailure.expected.kind}), assertion ${firstFailure.id}, digest ${
                compiledPlan.digest.sha256
              }. Expected ${JSON.stringify(firstFailure.expected)}; ${
                unavailable
                  ? 'observed unavailable'
                  : `observed ${JSON.stringify(firstFailure.observed)}`
              }; delta ${JSON.stringify(firstFailure.delta)}.`,
              stepResults,
              unavailable
                ? 'Repair the readback probe before another write'
                : 'Correct failed postcondition before claiming completion',
              readbackValue,
              compiledPlan.digest.sha256,
            );
          }
          if (readbackValue.verified && readbackValue.verified.missing.length > 0) {
            return incompletePlan(
              `Missing verify target(s): ${readbackValue.verified.missing.join(', ')}. The plan outcome is unverified.`,
              stepResults,
              'Correct missing verify targets before claiming completion',
              readbackValue,
              compiledPlan.digest.sha256,
            );
          }
          if (normalizedSummaryWorksheet !== undefined && !readbackValue.summary_data) {
            return incompletePlan(
              'Requested summary readback is absent. The plan outcome is unverified.',
              stepResults,
              'Correct summary readback before claiming completion',
              readbackValue,
              compiledPlan.digest.sha256,
            );
          }
          if (readbackValue.summary_data?.rows.length === 0) {
            return incompletePlan(
              'Summary readback returned no rows; values are unverified.',
              stepResults,
              'Correct summary readback before claiming completion',
              readbackValue,
              compiledPlan.digest.sha256,
            );
          }
          return new Ok(
            withNextAction(
              {
                message:
                  assertions.length > 0
                    ? assertions.length ===
                      preparedResult.value.steps.filter(({ expect }) => expect !== undefined).length
                      ? `Plan done: all ${assertions.length} declared postcondition(s) passed.`
                      : 'Plan done: final intent diff is empty.'
                    : describeReadback(readbackValue),
                steps: stepResults,
                intent_digest_sha256: compiledPlan.digest.sha256,
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
    expect?: unknown;
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
        message: `Plan refused during preflight: requires uncensused capability '${name}': ${reason}. No step ran.`,
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
  intentDigestSha256?: string,
): Result<PlanResult, McpToolError> {
  return new IncompleteOperationError<PlanResultBody>(
    withNextAction(
      {
        message,
        steps,
        ...(intentDigestSha256 ? { intent_digest_sha256: intentDigestSha256 } : {}),
        ...(readback ? { readback } : {}),
      },
      prefillNextAction(nextAction),
    ),
  ).toErr();
}

function formatExecutedSteps(steps: PlanStepResult[]): string {
  return steps.length > 0
    ? steps.map(({ step, command }) => `${step} (${command})`).join(', ')
    : 'none';
}

function formatSkippedSteps(steps: PreparedStep[], completedStep: number): string {
  const skipped = steps.filter(({ step }) => step > completedStep);
  return skipped.length > 0
    ? skipped.map(({ step, command }) => `${step} (${command})`).join(', ')
    : 'none';
}

function formatAssertionFailure({
  phase,
  failure,
  digestSha256,
  command,
  executed,
  skipped,
}: {
  phase: 'Checkpoint' | 'Final';
  failure: AssertionReadback;
  digestSha256: string;
  command: string;
  executed: PlanStepResult[];
  skipped: PreparedStep[];
}): string {
  const status = failure.status === 'unobservable' ? 'unobservable' : 'mismatch';
  return `${phase} ${status} after step ${failure.introducedByStep} (${command}), assertion ${
    failure.id
  }, digest ${digestSha256}. Expected ${JSON.stringify(
    failure.expected,
  )}; observed ${JSON.stringify(failure.observed)}; delta ${JSON.stringify(
    failure.delta,
  )}. Executed prefix: ${formatExecutedSteps(executed)}. Skipped suffix: ${
    skipped.length > 0
      ? skipped.map(({ step, command: skippedCommand }) => `${step} (${skippedCommand})`).join(', ')
      : 'none'
  }. No later step ran.`;
}

function hasReadbackRequest(
  verify: string[] | undefined,
  summaryWorksheet: string | undefined,
  assertions: IntentAssertionRecord[],
): boolean {
  return (verify?.length ?? 0) > 0 || summaryWorksheet !== undefined || assertions.length > 0;
}

function normalizeSummaryWorksheet(
  summaryWorksheet: string | string[] | undefined,
): string | undefined {
  return Array.isArray(summaryWorksheet) ? summaryWorksheet[0] : summaryWorksheet;
}

function plannedVerifications(
  assertions: IntentAssertionRecord[],
  verify: string[] | undefined,
  summaryWorksheet: string | undefined,
): PlannedVerification[] {
  return [
    ...assertions.map(({ id, introducedByStep, checkpoint, expect }) => ({
      kind: 'intent-assertion' as const,
      id,
      step: introducedByStep,
      checkpoint,
      expect,
    })),
    ...(verify ?? []).map((target) => ({ kind: 'name-exists' as const, target })),
    ...(summaryWorksheet
      ? [{ kind: 'summary-data' as const, worksheet: summaryWorksheet, max_rows: DEFAULT_MAX_ROWS }]
      : []),
  ];
}

async function captureIntentBaseline(
  assertions: IntentAssertionRecord[],
  executor: ExternalApiToolExecutor,
  signal: AbortSignal,
): Promise<Result<IntentBaseline | undefined, McpToolError>> {
  const existenceAssertions = assertions.filter(({ expect }) =>
    ['worksheet-exists', 'dashboard-exists'].includes(expect.kind),
  );
  if (existenceAssertions.length === 0) return new Ok(undefined);

  const inventoryResult = await executor.getWorkbook(signal);
  if (inventoryResult.isErr()) {
    return new DesktopCommandExecutionError(inventoryResult.error).toErr();
  }

  return new Ok({ inventory: inventoryResult.value });
}

async function performReadback(
  verify: string[] | undefined,
  summaryWorksheet: string | undefined,
  assertions: IntentAssertionRecord[],
  read: ExternalApiRead,
  baseline: IntentBaseline | undefined,
): Promise<Result<PlanReadback, McpToolError>> {
  const output: PlanReadback = {};
  const summaryCache = new Map<string, Promise<Result<WorksheetSummaryData, McpToolError>>>();
  const readSummary = (worksheet: string): Promise<Result<WorksheetSummaryData, McpToolError>> => {
    const cached = summaryCache.get(worksheet);
    if (cached) return cached;
    const requested = (async (): Promise<Result<WorksheetSummaryData, McpToolError>> => {
      const result = await fetchWorksheetSummaryData({
        read,
        worksheet,
        maxRows: DEFAULT_MAX_ROWS,
      });
      return result.isErr() ? result.error.error.toErr() : result;
    })();
    summaryCache.set(worksheet, requested);
    return requested;
  };

  if ((verify?.length ?? 0) > 0 || assertions.length > 0) {
    const inventoryResult = await read(
      'workbook inventory',
      async (executor, signal) => await executor.getWorkbook(signal),
    );
    if (inventoryResult.isErr()) {
      if (assertions.length === 0) return inventoryResult;
      const observed = inventoryResult.error.getErrorText();
      output.assertions = assertions.map((assertion) =>
        assertionOutcome(assertion, 'unobservable', observed),
      );
    } else {
      if ((verify?.length ?? 0) > 0) {
        output.verified = matchNamedItems(verify ?? [], inventoryResult.value);
      }
      if (assertions.length > 0) {
        output.assertions = await evaluateAssertions(
          assertions,
          inventoryResult.value,
          read,
          readSummary,
          baseline,
        );
      }
    }
    if (output.assertions) {
      output.final_diff = output.assertions.filter(({ status }) => status !== 'passed');
      output.postconditions = legacyPostconditions(output.assertions);
    }
  }

  if (summaryWorksheet) {
    const maxRows = DEFAULT_MAX_ROWS;
    const summaryResult = await readSummary(summaryWorksheet);
    if (summaryResult.isErr()) {
      return summaryResult;
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

async function evaluateAssertions(
  assertions: IntentAssertionRecord[],
  inventory: WorkbookInventory,
  read: ExternalApiRead,
  readSummary: (worksheet: string) => Promise<Result<WorksheetSummaryData, McpToolError>>,
  baseline: IntentBaseline | undefined,
): Promise<AssertionReadback[]> {
  const worksheetDocuments = new Map<string, Promise<Result<WorkbookDocument, McpToolError>>>();
  const dashboardDocuments = new Map<string, Promise<Result<WorkbookDocument, McpToolError>>>();
  let workbookDocument: Promise<Result<WorkbookDocument, McpToolError>> | undefined;
  const outcomes: AssertionReadback[] = [];

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
  const getWorkbookDocument = (): Promise<Result<WorkbookDocument, McpToolError>> => {
    workbookDocument ??= read(
      'workbook document',
      async (executor, signal) => await executor.getWorkbookDocument(signal),
    );
    return workbookDocument;
  };

  for (const assertion of assertions) {
    const { expect } = assertion;
    if (expect.kind === 'worksheet-exists') {
      if (!baseline) {
        outcomes.push(
          assertionOutcome(assertion, 'unobservable', 'pre-plan workbook baseline is unavailable'),
        );
        continue;
      }
      const observed = (inventory.worksheets ?? []).map(({ id, name }) => ({ id, name }));
      const before = (baseline.inventory.worksheets ?? []).map(({ id, name }) => ({ id, name }));
      const matched = observed.filter(({ id, name }) => id === expect.name || name === expect.name);
      const existedBefore = before.some(
        ({ id, name }) => id === expect.name || name === expect.name,
      );
      outcomes.push(
        assertionOutcome(
          assertion,
          matched.length === 1 && !existedBefore ? 'passed' : 'mismatch',
          { before, after: observed },
        ),
      );
      continue;
    }

    if (expect.kind === 'dashboard-exists') {
      if (!baseline) {
        outcomes.push(
          assertionOutcome(assertion, 'unobservable', 'pre-plan workbook baseline is unavailable'),
        );
        continue;
      }
      const observed = (inventory.dashboards ?? []).map(({ id, name }) => ({ id, name }));
      const before = (baseline.inventory.dashboards ?? []).map(({ id, name }) => ({ id, name }));
      const matched = observed.filter(({ id, name }) => id === expect.name || name === expect.name);
      const existedBefore = before.some(
        ({ id, name }) => id === expect.name || name === expect.name,
      );
      outcomes.push(
        assertionOutcome(
          assertion,
          matched.length === 1 && !existedBefore ? 'passed' : 'mismatch',
          { before, after: observed },
        ),
      );
      continue;
    }

    if (expect.kind === 'calculation-signature') {
      const document = await getWorkbookDocument();
      if (document.isErr()) {
        outcomes.push(assertionOutcome(assertion, 'unobservable', document.error.getErrorText()));
        continue;
      }
      const observed = readCalculationSignatures(document.value.xml).filter(
        ({ datasource, name }) => datasource === expect.datasource && name === expect.name,
      );
      const matched = observed.some(
        ({ formula, datatype, role }) =>
          formula === expect.formula && datatype === expect.datatype && role === expect.role,
      );
      outcomes.push(assertionOutcome(assertion, matched ? 'passed' : 'mismatch', observed));
      continue;
    }

    if (expect.kind === 'summary-signature') {
      const summary = await readSummary(expect.worksheet);
      if (summary.isErr()) {
        outcomes.push(assertionOutcome(assertion, 'unobservable', summary.error.getErrorText()));
        continue;
      }
      const columns = summary.value.columns.map(summaryColumnName);
      if (columns.some((column) => column === null)) {
        outcomes.push(
          assertionOutcome(assertion, 'unobservable', 'summary column names are unavailable'),
        );
        continue;
      }
      const observed = { columns, rows: summary.value.rows };
      const matched =
        JSON.stringify(columns) === JSON.stringify(expect.columns) &&
        JSON.stringify(summary.value.rows) === JSON.stringify(expect.rows);
      outcomes.push(assertionOutcome(assertion, matched ? 'passed' : 'mismatch', observed));
      continue;
    }

    if (expect.kind === 'dashboard-contains') {
      const dashboard = findDashboard(inventory, expect.dashboard);
      if (!dashboard) {
        outcomes.push(
          assertionOutcome(
            assertion,
            'unobservable',
            `dashboard "${expect.dashboard}" not observed`,
          ),
        );
        continue;
      }
      const document = await dashboardDocument(dashboard);
      if (document.isErr()) {
        outcomes.push(assertionOutcome(assertion, 'unobservable', document.error.getErrorText()));
        continue;
      }
      const zoneNames = readDashboardZoneNames(document.value.xml);
      if (!zoneNames) {
        outcomes.push(
          assertionOutcome(assertion, 'unobservable', 'dashboard document could not be parsed'),
        );
        continue;
      }
      outcomes.push(
        assertionOutcome(
          assertion,
          zoneNames.includes(expect.worksheet) ? 'passed' : 'mismatch',
          zoneNames,
        ),
      );
      continue;
    }

    if (expect.kind === 'dashboard-zone') {
      const dashboard = findDashboard(inventory, expect.dashboard);
      if (!dashboard) {
        outcomes.push(
          assertionOutcome(
            assertion,
            'unobservable',
            `dashboard "${expect.dashboard}" not observed`,
          ),
        );
        continue;
      }
      const document = await dashboardDocument(dashboard);
      if (document.isErr()) {
        outcomes.push(assertionOutcome(assertion, 'unobservable', document.error.getErrorText()));
        continue;
      }
      const zones = readDashboardZones(document.value.xml);
      if (!zones) {
        outcomes.push(
          assertionOutcome(assertion, 'unobservable', 'dashboard document could not be parsed'),
        );
        continue;
      }
      const observed = zones.filter(({ worksheet }) => worksheet === expect.worksheet);
      if (observed.some(({ zoneType }) => zoneType === null)) {
        outcomes.push(
          assertionOutcome(assertion, 'unobservable', 'dashboard zone type is unavailable'),
        );
        continue;
      }
      outcomes.push(
        assertionOutcome(
          assertion,
          observed.length === expect.multiplicity &&
            observed.every(({ zoneType }) => zoneType === expect.zoneType)
            ? 'passed'
            : 'mismatch',
          observed,
        ),
      );
      continue;
    }

    const worksheet = findWorksheet(inventory, expect.worksheet);
    if (!worksheet) {
      outcomes.push(
        assertionOutcome(assertion, 'unobservable', `worksheet "${expect.worksheet}" not observed`),
      );
      continue;
    }

    if (expect.kind === 'datasource-binding') {
      const observed = worksheet.datasources ?? [];
      outcomes.push(
        assertionOutcome(
          assertion,
          observed.filter((datasource) => datasource === expect.datasource).length === 1
            ? 'passed'
            : 'mismatch',
          observed,
        ),
      );
      continue;
    }

    const document = await worksheetDocument(worksheet);
    if (document.isErr()) {
      outcomes.push(assertionOutcome(assertion, 'unobservable', document.error.getErrorText()));
      continue;
    }

    if (expect.kind === 'filter-signature') {
      const signature = readWorksheetSignature(document.value.xml);
      if (!signature) {
        outcomes.push(
          assertionOutcome(assertion, 'unobservable', 'worksheet document could not be parsed'),
        );
        continue;
      }
      const observed = signature.filters.filter(({ column }) => column === expect.column);
      const members = [...expect.members].sort();
      const matched = observed.some(
        (candidate) =>
          JSON.stringify(candidate.members) === JSON.stringify(members) &&
          candidate.mode === expect.mode &&
          (expect.function === null || candidate.groupFunction === expect.function),
      );
      outcomes.push(assertionOutcome(assertion, matched ? 'passed' : 'mismatch', observed));
      continue;
    }

    const signature = readWorksheetSignature(document.value.xml);
    if (!signature) {
      outcomes.push(
        assertionOutcome(assertion, 'unobservable', 'worksheet document could not be parsed'),
      );
      continue;
    }
    if (expect.kind === 'mark-type') {
      const observed = signature.marks.map(({ klass }) => klass);
      outcomes.push(
        assertionOutcome(
          assertion,
          observed.includes(expect.mark) ? 'passed' : 'mismatch',
          observed,
        ),
      );
      continue;
    }

    if (expect.kind === 'field-binding') {
      const observed =
        expect.placement === 'rows' || expect.placement === 'cols'
          ? signature.shelves[expect.placement]
          : signature.encodings
              .filter(({ tag }) => tag === expect.placement)
              .map(({ column }) => column);
      outcomes.push(
        assertionOutcome(
          assertion,
          observed.includes(expect.field) ? 'passed' : 'mismatch',
          observed,
        ),
      );
      continue;
    }

    const observed = signature.encodings.map(({ tag, column }) => ({
      channel: tag,
      field: column,
    }));
    outcomes.push(
      assertionOutcome(
        assertion,
        observed.some(({ channel, field }) => channel === expect.channel && field === expect.field)
          ? 'passed'
          : 'mismatch',
        observed,
      ),
    );
  }

  return outcomes;
}

function assertionOutcome(
  assertion: IntentAssertionRecord,
  status: AssertionReadback['status'],
  observed: unknown,
): AssertionReadback {
  return {
    id: assertion.id,
    introducedByStep: assertion.introducedByStep,
    checkpoint: assertion.checkpoint,
    status,
    expected: assertion.expect,
    observed,
    delta:
      status === 'passed'
        ? { kind: 'none', expected: null, observed: null }
        : { kind: status, expected: assertion.expect, observed },
  };
}

function legacyPostconditions(assertions: AssertionReadback[]): LegacyPostconditionReadback[] {
  return assertions.map(({ introducedByStep, expected, status, observed }) => ({
    step: introducedByStep,
    kind: expected.kind,
    status,
    expected: JSON.stringify(expected),
    observed: typeof observed === 'string' ? observed : JSON.stringify(observed),
  }));
}

function findWorksheet(inventory: WorkbookInventory, target: string): WorksheetItem | undefined {
  return (inventory.worksheets ?? []).find(({ id, name }) => id === target || name === target);
}

function findDashboard(inventory: WorkbookInventory, target: string): DashboardItem | undefined {
  return (inventory.dashboards ?? []).find(({ id, name }) => id === target || name === target);
}

type CalculationSignature = {
  datasource: string;
  name: string;
  formula: string;
  datatype: string;
  role: string;
};

function readCalculationSignatures(xml: string): CalculationSignature[] {
  try {
    const signatures: CalculationSignature[] = [];
    collectCalculationSignatures(parseXML(xml), undefined, signatures);
    return signatures;
  } catch {
    return [];
  }
}

function collectCalculationSignatures(
  node: unknown,
  datasource: string | undefined,
  output: CalculationSignature[],
): void {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return;
  for (const [tag, value] of Object.entries(node)) {
    if (tag.startsWith('@_') || tag === '#text') continue;
    for (const child of normalizeArray(value)) {
      if (!child || typeof child !== 'object' || Array.isArray(child)) continue;
      const record = child as Record<string, unknown>;
      const nestedDatasource =
        tag === 'datasource'
          ? typeof record['@_caption'] === 'string'
            ? record['@_caption']
            : typeof record['@_name'] === 'string'
              ? record['@_name']
              : datasource
          : datasource;
      if (tag === 'column' && nestedDatasource) {
        const calculation = normalizeArray(record.calculation).find(
          (candidate): candidate is Record<string, unknown> =>
            typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate),
        );
        const name =
          typeof record['@_caption'] === 'string'
            ? record['@_caption']
            : typeof record['@_name'] === 'string'
              ? record['@_name']
              : undefined;
        const formula =
          calculation && typeof calculation['@_formula'] === 'string'
            ? calculation['@_formula']
            : undefined;
        if (name && formula) {
          output.push({
            datasource: nestedDatasource,
            name,
            formula,
            datatype: typeof record['@_datatype'] === 'string' ? record['@_datatype'] : '',
            role: typeof record['@_role'] === 'string' ? record['@_role'] : '',
          });
        }
      }
      collectCalculationSignatures(record, nestedDatasource, output);
    }
  }
}

type DashboardZoneObservation = {
  worksheet: string;
  zoneType: string | null;
};

function readDashboardZones(xml: string): DashboardZoneObservation[] | null {
  try {
    const zones: DashboardZoneObservation[] = [];
    walkXml(parseXML(xml), (tag, node) => {
      if (tag !== 'zone' || typeof node['@_name'] !== 'string') return;
      const zoneType =
        typeof node['@_type'] === 'string'
          ? node['@_type']
          : typeof node['@_zone-type'] === 'string'
            ? node['@_zone-type']
            : null;
      zones.push({ worksheet: node['@_name'], zoneType });
    });
    return zones;
  } catch {
    return null;
  }
}

function readDashboardZoneNames(xml: string): string[] | null {
  return readDashboardZones(xml)?.map(({ worksheet }) => worksheet) ?? null;
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

function summaryColumnName(column: unknown): string | null {
  if (typeof column === 'string') return column;
  if (!isRecord(column)) return null;
  return typeof column.name === 'string' ? column.name : null;
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
