import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, type Result } from 'ts-results-es';
import { z } from 'zod';

import {
  type BatchApplyOutcome,
  currentEpisodeId,
  emitEpisodeEvent,
  episodeSessionIdFromArgs,
} from '../../../../desktop/episode-events.js';
import type { ExecuteCommandError } from '../../../../desktop/externalApi/executorTypes.js';
import {
  deleteDashboard,
  listWorkbookDashboards,
} from '../../../../desktop/metadata/dashboards.js';
import { findAllWorksheets, parseXML } from '../../../../desktop/metadata/parser.js';
import {
  extractSheetXml,
  upsertWorksheetAndWindowIntoWorkbook,
} from '../../../../desktop/metadata/sheets.js';
import { compareTargetWorksheetState } from '../../../../desktop/metadata/targetWorksheetState.js';
import { resolveSession } from '../../../../desktop/session/sessionResolution.js';
import {
  getTemplateArtifactStore,
  type TemplateArtifactReserveResult,
  type TemplateArtifactStore,
} from '../../../../desktop/templates/templateArtifactStore.js';
import {
  formatReadbackVerificationError,
  formatReadbackVerificationWarnings,
  isReadbackUnsettled,
  type ReadbackVerificationResult,
  verifyWorksheetReadback,
} from '../../../../desktop/validation/readback-verify.js';
import {
  blockingValidationIssues,
  introducedBlockingValidationIssues,
  runValidation,
} from '../../../../desktop/validation/registry.js';
import { targetDashboardInvariantIssues } from '../../../../desktop/validation/targetDashboardInvariant.js';
import { activateSheetWithValidatedGoto } from '../../../../desktop/wrappers/activateSheet.js';
import { hideStartPage } from '../../../../desktop/wrappers/applyFocus.js';
import { getWorkbookXml } from '../../../../desktop/wrappers/getWorkbookXml.js';
import {
  describeLoadWorkbookXmlError,
  loadWorkbookXml,
  type LoadWorkbookXmlError,
} from '../../../../desktop/wrappers/loadWorkbookXml.js';
import { resolveCanonicalWorksheetName } from '../../../../desktop/wrappers/loadWorksheetXml.js';
import { pollReadback } from '../../../../desktop/wrappers/pollReadback.js';
import { xmlNamesEqual } from '../../../../desktop/xmlElement.js';
import {
  DesktopCommandExecutionError,
  IncompleteOperationError,
} from '../../../../errors/mcpToolError.desktop.js';
import { type McpToolError } from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import { getExceptionMessage } from '../../../../utils/getExceptionMessage.js';
import { templateArtifactUnavailableError } from '../../api/applyWorksheetArtifact.js';
import { sessionParam } from '../../params.js';
import { jsonToolResult, type StructuredResult } from '../../structuredContent.js';
import { DesktopTool, resolveEpisodeKey } from '../../tool.js';
import {
  type FilterAction,
  filterActionMatches,
  getAttr,
  nextActionName,
  renderFilterAction,
  spliceActionIntoWorkbook,
  unescapeXml,
} from '../datasource/authorAction.js';
import {
  buildDashboardCandidateXml,
  dashboardCandidateReadbackIssues,
  emptyWorksheetWarning,
  findBlankWorksheetNames,
  resolveLiveWorksheetNames,
  validateComposeDashboardInput,
} from './composeDashboardCore.js';

const paramsSchema = {
  session: sessionParam({ max: 64 }),
  artifactIds: z.array(z.string().trim().min(1).max(255)).max(7).optional(),
  dashboardName: z.string().trim().min(1).max(255),
  existingWorksheetNames: z
    .array(z.string().trim().min(1).max(255))
    .max(7)
    .optional()
    .describe('Live non-KPI sheets in order.'),
  title: z.string().trim().min(1).max(255).optional(),
  layoutType: z
    .enum(['auto-grid', 'rows', 'columns', 'executive-summary'])
    .optional()
    .describe('executive-summary: KPI + chart roles.'),
  gridColumns: z.number().int().min(1).max(6).optional(),
  kpiWorksheetNames: z
    .array(z.string().trim().min(1).max(255))
    .min(1)
    .max(5)
    .optional()
    .describe('Live KPI sheet names, left to right.'),
  replaceExisting: z.boolean().optional(),
  crossFilter: z.boolean().optional().describe('Filter on click; default true.'),
};

type AppliedState = true | false | 'unknown';

type StepReceipt =
  | {
      index: number;
      operation: 'worksheet';
      artifactId: string;
      state: 'applied';
      retrySafe: false;
      title: string;
      verification: ReadbackVerificationResult;
    }
  | {
      index: number;
      operation: 'worksheet';
      artifactId: string;
      state: 'failed' | 'unknown';
      retrySafe: boolean;
      error?: string;
      title?: string;
      verification?: ReadbackVerificationResult;
    }
  | {
      index: number;
      operation: 'dashboard';
      dashboardName: string;
      state: 'applied';
      retrySafe: false;
      worksheets: string[];
      replaced: boolean;
      verification: { status: 'passed'; issues: [] };
      warnings?: string[];
      filterActions?: Array<{ name?: string; caption: string; sourceWorksheet?: string }>;
    }
  | {
      index: number;
      operation: 'dashboard';
      dashboardName: string;
      state: 'failed' | 'unknown';
      retrySafe: boolean;
      stage: string;
      error: string;
    }
  | {
      index: number;
      operation: 'worksheet' | 'dashboard';
      state: 'aborted' | 'skipped';
      retrySafe: true;
      artifactId?: string;
      dashboardName?: string;
      reason: string;
    };

type RunDashboardBatchPayload = {
  applied: AppliedState;
  retrySafe: boolean;
  steps: StepReceipt[];
};

type RunDashboardBatchResult = StructuredResult<RunDashboardBatchPayload>;
type Reservation = Extract<TemplateArtifactReserveResult, { ok: true }>;
type LoadWorkbookXmlFailure =
  | { type: 'execute-command-error'; error: ExecuteCommandError }
  | { type: 'load-workbook-xml-error'; error: LoadWorkbookXmlError };

type WorksheetVerification = {
  artifactId: string;
  title: string;
  verification: ReadbackVerificationResult;
};

type BatchReadbackVerification = {
  ok: boolean;
  /** True while a finding may still be a pre-apply read: any error, or a shelf warning. */
  pending: boolean;
  worksheets: WorksheetVerification[];
  dashboardIssues: string[];
};

const MAX_DYNAMIC_TEXT_LENGTH = 384;
const MAX_BATCH_WORKSHEETS = 7;

export const getRunDashboardBatchTool = (
  server: DesktopMcpServer,
  dependencies: { store?: TemplateArtifactStore } = {},
): DesktopTool<typeof paramsSchema> => {
  const artifactStore = dependencies.store ?? getTemplateArtifactStore(server);
  const tool = new DesktopTool({
    server,
    name: 'run-dashboard-batch',
    title: 'Dashboard',
    description: 'Apply staged sheets; compose live KPI/chart sheets as a dashboard.',
    paramsSchema,
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
    callback: async (
      {
        session,
        artifactIds,
        dashboardName,
        existingWorksheetNames,
        title: dashboardTitle,
        layoutType,
        gridColumns,
        kpiWorksheetNames,
        replaceExisting = false,
        crossFilter,
      },
      extra,
    ): Promise<CallToolResult> => {
      const startedAt = performance.now();
      const sessionId = resolveEpisodeKey(
        extra.config,
        { session },
        episodeSessionIdFromArgs(extra.config, { session }),
      );
      let executionStarted = false;
      const result = await tool.logAndExecute<RunDashboardBatchResult>({
        extra,
        args: {
          session,
          artifactIds,
          dashboardName,
          existingWorksheetNames,
          title: dashboardTitle,
          layoutType,
          gridColumns,
          kpiWorksheetNames,
          replaceExisting,
          crossFilter,
        },
        callback: async (): Promise<Result<RunDashboardBatchResult, McpToolError>> => {
          const orderedArtifactIds = artifactIds ?? [];
          const requestedExistingNames = existingWorksheetNames ?? [];
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) return sessionResult.error.toErr();
          const resolvedSession = sessionResult.value;
          const executor = await extra.getExecutor(resolvedSession);
          const steps: StepReceipt[] = [];
          const reservations: Reservation[] = [];
          let leasesFinalized = false;
          const releaseReservations = (): void => {
            if (leasesFinalized) return;
            leasesFinalized = true;
            for (const reservation of reservations) artifactStore.release(reservation.lease);
          };
          const consumeReservations = (): void => {
            if (leasesFinalized) return;
            leasesFinalized = true;
            for (const reservation of reservations) artifactStore.consume(reservation.lease);
          };

          try {
            const duplicateArtifactId = firstDuplicate(orderedArtifactIds);
            if (duplicateArtifactId) {
              return preflightInputFailure(
                steps,
                orderedArtifactIds,
                dashboardName,
                `Duplicate artifact ID: "${duplicateArtifactId}".`,
              );
            }

            for (const [index, artifactId] of orderedArtifactIds.entries()) {
              const reservation = artifactStore.reserve(artifactId, resolvedSession);
              if (!reservation.ok) {
                appendPreflightArtifactFailure(
                  steps,
                  orderedArtifactIds,
                  index,
                  dashboardName,
                  templateArtifactUnavailableError(artifactId, reservation.reason).getErrorText(),
                );
                return incomplete({ applied: false, retrySafe: true, steps });
              }
              reservations.push(reservation);
            }

            const explicitlyPlannedNames = [
              ...requestedExistingNames,
              ...reservations.map((reservation) => reservation.artifact.title),
            ];
            const duplicateName = firstCanonicalDuplicate(explicitlyPlannedNames);
            if (duplicateName) {
              return preflightInputFailure(
                steps,
                orderedArtifactIds,
                dashboardName,
                `Duplicate worksheet name: "${duplicateName}".`,
              );
            }
            const implicitKpiRoleNames =
              layoutType === 'executive-summary'
                ? canonicalDifference(kpiWorksheetNames ?? [], explicitlyPlannedNames)
                : [];
            const plannedNames = [...explicitlyPlannedNames, ...implicitKpiRoleNames];
            if (plannedNames.length < 1 || plannedNames.length > MAX_BATCH_WORKSHEETS) {
              return preflightInputFailure(
                steps,
                orderedArtifactIds,
                dashboardName,
                'A dashboard batch requires 1-7 combined worksheets, including KPI roles.',
              );
            }

            const workbookResult = await executor.getWorkbookDocument(extra.signal);
            if (workbookResult.isErr()) {
              return preflightInputFailure(
                steps,
                orderedArtifactIds,
                dashboardName,
                new DesktopCommandExecutionError(workbookResult.error).getErrorText(),
                'workbookRead',
              );
            }
            const workbookXml = workbookResult.value.xml;
            const liveInstanceId = workbookResult.value.instanceId;
            const existingDashboardName = listWorkbookDashboards(workbookXml).find((name) =>
              xmlNamesEqual(name, dashboardName),
            );
            if (existingDashboardName && !replaceExisting) {
              return preflightInputFailure(
                steps,
                orderedArtifactIds,
                dashboardName,
                `Dashboard "${dashboardName}" already exists and will not be rebuilt. replaceExisting is only for an explicit user request to rebuild or replace this dashboard.`,
                'existingDashboard',
              );
            }
            const conflictingWorksheetName = [
              ...findAllWorksheets(parseXML(workbookXml)).map((worksheet) => worksheet['@_name']),
              ...reservations.map((reservation) => reservation.artifact.title),
            ].find(
              (worksheetName): worksheetName is string =>
                typeof worksheetName === 'string' && xmlNamesEqual(worksheetName, dashboardName),
            );
            if (conflictingWorksheetName) {
              return preflightInputFailure(
                steps,
                orderedArtifactIds,
                dashboardName,
                `Dashboard name "${dashboardName}" conflicts with worksheet "${conflictingWorksheetName}". Use a unique dashboard name.`,
              );
            }

            const canonicalArtifactNames: string[] = [];
            for (const [index, reservation] of reservations.entries()) {
              const blockingIssues = blockingValidationIssues(
                runValidation(reservation.artifact.worksheetXml, 'worksheet').issues,
              );
              if (blockingIssues.length > 0) {
                appendPreflightArtifactFailure(
                  steps,
                  orderedArtifactIds,
                  index,
                  dashboardName,
                  `Artifact worksheet failed validation: ${blockingIssues
                    .map((issue) => `${issue.ruleId}: ${issue.message}`)
                    .join('; ')}.`,
                );
                return incomplete({ applied: false, retrySafe: true, steps });
              }
              const canonicalName = resolveCanonicalWorksheetName(
                reservation.artifact.title,
                reservation.artifact.worksheetXml,
              );
              if (canonicalName.isErr()) {
                appendPreflightArtifactFailure(
                  steps,
                  orderedArtifactIds,
                  index,
                  dashboardName,
                  canonicalName.error.message,
                );
                return incomplete({ applied: false, retrySafe: true, steps });
              }
              canonicalArtifactNames.push(canonicalName.value);
              if (!liveInstanceId || reservation.artifact.instanceId !== liveInstanceId) {
                appendPreflightArtifactFailure(
                  steps,
                  orderedArtifactIds,
                  index,
                  dashboardName,
                  'The artifact belongs to a different Desktop instance.',
                );
                return incomplete({ applied: false, retrySafe: true, steps });
              }
              const comparison = compareTargetWorksheetState(
                reservation.artifact.targetState,
                workbookXml,
                reservation.artifact.worksheetXml,
              );
              if (!comparison.ok) {
                appendPreflightArtifactFailure(
                  steps,
                  orderedArtifactIds,
                  index,
                  dashboardName,
                  `The workbook changed after this artifact was built: ${comparison.reasons.join(', ')}.`,
                );
                return incomplete({ applied: false, retrySafe: true, steps });
              }
            }

            const resolvedExistingNames = resolveLiveWorksheetNames(
              workbookXml,
              requestedExistingNames,
            );
            const missingExistingNames = requestedExistingNames.filter(
              (_, index) => !resolvedExistingNames[index],
            );
            if (missingExistingNames.length > 0) {
              return preflightInputFailure(
                steps,
                orderedArtifactIds,
                dashboardName,
                `Missing live worksheet name(s): ${missingExistingNames
                  .map((name) => `"${name}"`)
                  .join(', ')}.`,
                'existingWorksheet',
              );
            }
            const explicitlyResolvedNames = [
              ...(resolvedExistingNames as string[]),
              ...canonicalArtifactNames,
            ];
            const unresolvedKpiRoleNames =
              layoutType === 'executive-summary'
                ? canonicalDifference(kpiWorksheetNames ?? [], explicitlyResolvedNames)
                : [];
            const resolvedImplicitKpiNames = resolveLiveWorksheetNames(
              workbookXml,
              unresolvedKpiRoleNames,
            );
            const missingKpiNames = unresolvedKpiRoleNames.filter(
              (_, index) => !resolvedImplicitKpiNames[index],
            );
            if (missingKpiNames.length > 0) {
              return preflightInputFailure(
                steps,
                orderedArtifactIds,
                dashboardName,
                `Missing live KPI worksheet name(s): ${missingKpiNames
                  .map((name) => `"${name}"`)
                  .join(
                    ', ',
                  )}. Create or render each KPI worksheet, or correct kpiWorksheetNames; then retry with the same executive-summary layout.`,
                'kpiWorksheet',
              );
            }
            const worksheetNames = [
              ...explicitlyResolvedNames,
              ...(resolvedImplicitKpiNames as string[]),
            ];
            const canonicalKpiWorksheetNames =
              layoutType === 'executive-summary' && kpiWorksheetNames
                ? kpiWorksheetNames.flatMap((requestedName) => {
                    const canonicalName = worksheetNames.find((worksheetName) =>
                      xmlNamesEqual(worksheetName, requestedName),
                    );
                    return canonicalName ? [canonicalName] : [];
                  })
                : kpiWorksheetNames;
            const layoutError = validateComposeDashboardInput(worksheetNames, {
              layoutType,
              gridColumns,
              kpiWorksheetNames: canonicalKpiWorksheetNames,
            });
            if (layoutError) {
              return preflightInputFailure(
                steps,
                orderedArtifactIds,
                dashboardName,
                layoutError.getErrorText(),
              );
            }

            let candidateXml = workbookXml;
            for (const [index, reservation] of reservations.entries()) {
              try {
                candidateXml = upsertWorksheetAndWindowIntoWorkbook(
                  candidateXml,
                  canonicalArtifactNames[index]!,
                  reservation.artifact.worksheetXml,
                  reservation.artifact.windowXml,
                );
              } catch (error) {
                appendPreflightArtifactFailure(
                  steps,
                  orderedArtifactIds,
                  index,
                  dashboardName,
                  `Could not add the artifact to the workbook candidate: ${getExceptionMessage(error)}`,
                );
                return incomplete({ applied: false, retrySafe: true, steps });
              }
            }

            const replaced = existingDashboardName !== undefined;
            try {
              if (existingDashboardName) {
                candidateXml = deleteDashboard(candidateXml, existingDashboardName);
              }
              candidateXml = buildDashboardCandidateXml({
                baselineXml: candidateXml,
                dashboardName,
                canonicalWorksheetNames: worksheetNames,
                title: dashboardTitle,
                layout: {
                  layoutType: layoutType ?? 'auto-grid',
                  ...(gridColumns ? { gridColumns } : {}),
                  ...(canonicalKpiWorksheetNames
                    ? { kpiWorksheetNames: canonicalKpiWorksheetNames }
                    : {}),
                },
              });
            } catch (error) {
              return preflightInputFailure(
                steps,
                orderedArtifactIds,
                dashboardName,
                `Could not compose dashboard candidate: ${getExceptionMessage(error)}`,
                'candidateBuild',
              );
            }

            const chartSheets = worksheetNames.filter(
              (name) => !(canonicalKpiWorksheetNames ?? []).some((kpi) => xmlNamesEqual(kpi, name)),
            );
            const wantsCrossFilter = crossFilter !== false && worksheetNames.length >= 2;
            const roundedSheets = wantsCrossFilter
              ? worksheetNames.filter((name) => hasRoundedBarHelpers(candidateXml, name))
              : [];
            const crossFilterExpected: FilterAction[] =
              wantsCrossFilter && roundedSheets.length === 0
                ? chartSheets
                    .filter(
                      (sheet) => !hasUserTargetedFilterAction(candidateXml, dashboardName, sheet),
                    )
                    .map((sheet) => crossFilterAction(dashboardName, sheet))
                : [];
            const roundedWarnings =
              roundedSheets.length > 0
                ? [
                    `Skipped filter actions on '${clip(dashboardName)}': rounded bars on '${roundedSheets
                      .slice(0, 3)
                      .map(clip)
                      .join("', '")}' disappear when other sheets filter them.`,
                  ]
                : [];
            let staleSources: string[] = [];
            const reservedXml = candidateXml;
            try {
              if (replaced) {
                const pruned = removeStaleFilterActions(
                  candidateXml,
                  dashboardName,
                  crossFilterExpected,
                );
                candidateXml = pruned.xml;
                staleSources = pruned.sources;
              }
              candidateXml = addCrossFilterActions(candidateXml, crossFilterExpected, reservedXml);
            } catch (error) {
              return preflightInputFailure(
                steps,
                orderedArtifactIds,
                dashboardName,
                `Could not add dashboard filter actions: ${getExceptionMessage(error)}`,
                'candidateBuild',
              );
            }

            const candidateBlockingIssues = introducedBlockingValidationIssues(
              runValidation(workbookXml, 'workbook').issues,
              runValidation(candidateXml, 'workbook').issues,
            );
            const candidateDashboardIssues = targetDashboardInvariantIssues(
              candidateXml,
              dashboardName,
              worksheetNames,
            );
            if (candidateBlockingIssues.length > 0 || candidateDashboardIssues.length > 0) {
              return preflightInputFailure(
                steps,
                orderedArtifactIds,
                dashboardName,
                [
                  ...candidateBlockingIssues.map((issue) => `${issue.ruleId}: ${issue.message}`),
                  ...candidateDashboardIssues.map((issue) => issue.message),
                ].join('; '),
                'candidateValidation',
              );
            }

            if (extra.signal.aborted) {
              appendAbortedBatch(steps, orderedArtifactIds, dashboardName);
              return incomplete({ applied: false, retrySafe: true, steps });
            }

            let dispatchAttempted = false;
            const applyResult = await loadWorkbookXml({
              xml: candidateXml,
              baselineXml: workbookXml,
              expectedWorkbookXml: workbookXml,
              focus: { navigate: 'none', reason: 'intermediate-leg' },
              executor,
              signal: extra.signal,
              applyOptions: {
                expectedInstanceId: liveInstanceId,
                onDispatch: () => {
                  dispatchAttempted = true;
                  executionStarted = true;
                  consumeReservations();
                },
              },
            });
            if (applyResult.isErr()) {
              if (dispatchAttempted) {
                return unknownBatch({
                  artifactIds: orderedArtifactIds,
                  reservations,
                  dashboardName,
                  stage: 'apply',
                  error: describeLoadError(applyResult.error),
                });
              }
              return preflightInputFailure(
                steps,
                orderedArtifactIds,
                dashboardName,
                describeLoadError(applyResult.error),
                loadFailureStage(applyResult.error),
              );
            }

            const polled = await pollReadback({
              read: () => getWorkbookXml({ executor, signal: extra.signal }),
              settled: (xml) => {
                const attempt = verifyBatchReadback(
                  xml,
                  candidateXml,
                  reservations,
                  dashboardName,
                  worksheetNames,
                );
                return attempt.ok && !attempt.pending;
              },
              signal: extra.signal,
            });
            if (!polled.ok) {
              return unknownBatch({
                artifactIds: orderedArtifactIds,
                reservations,
                dashboardName,
                stage: 'postApplyRead',
                error: new DesktopCommandExecutionError(polled.error).getErrorText(),
              });
            }

            const verification = verifyBatchReadback(
              polled.value,
              candidateXml,
              reservations,
              dashboardName,
              worksheetNames,
            );
            if (!verification.ok) {
              return unknownBatch({
                artifactIds: orderedArtifactIds,
                reservations,
                dashboardName,
                stage: 'readbackVerification',
                error: boundedText(
                  [...verification.worksheets]
                    .filter(({ verification: item }) => !item.ok)
                    .map(
                      ({ title, verification: item }) => `${title}: ${item.message ?? 'mismatch'}`,
                    )
                    .concat(verification.dashboardIssues)
                    .join('; ') || 'Post-apply verification did not settle.',
                ),
                verification,
              });
            }

            const emptyWorksheetNames = findBlankWorksheetNames(polled.value, worksheetNames);
            const filterReceipt = crossFilterReceipt(
              polled.value,
              candidateXml,
              crossFilterExpected,
              dashboardName,
              staleSources,
            );
            const dashboardWarnings = [
              ...(emptyWorksheetNames.length > 0
                ? [emptyWorksheetWarning(emptyWorksheetNames)]
                : []),
              ...roundedWarnings,
              ...filterReceipt.warnings,
            ];

            await hideStartPage({ executor, signal: extra.signal });
            await activateSheetWithValidatedGoto({
              sheetName: dashboardName,
              executor,
              signal: extra.signal,
            });
            const successSteps: StepReceipt[] = verification.worksheets.map(
              (
                { artifactId, title: worksheetTitle, verification: worksheetVerification },
                index,
              ) => ({
                index,
                operation: 'worksheet',
                artifactId,
                state: 'applied',
                retrySafe: false,
                title: worksheetTitle,
                verification: worksheetVerification,
              }),
            );
            successSteps.push({
              index: orderedArtifactIds.length,
              operation: 'dashboard',
              dashboardName,
              state: 'applied',
              retrySafe: false,
              worksheets: worksheetNames,
              replaced,
              verification: { status: 'passed', issues: [] },
              ...(dashboardWarnings.length > 0 ? { warnings: dashboardWarnings } : {}),
              ...(filterReceipt.applied.length > 0 ? { filterActions: filterReceipt.applied } : {}),
            });
            return Ok({ applied: true, retrySafe: false, steps: successSteps });
          } catch (error) {
            if (executionStarted) {
              return unknownBatch({
                artifactIds: orderedArtifactIds,
                reservations,
                dashboardName,
                stage: 'unexpected-error',
                error: boundedUnexpectedError(error),
              });
            }
            return preflightInputFailure(
              steps,
              orderedArtifactIds,
              dashboardName,
              boundedUnexpectedError(error),
              'unexpectedPreDispatchError',
            );
          } finally {
            releaseReservations();
          }
        },
        getSuccessResult: (result) => jsonToolResult(result, { isError: false }),
      });
      void emitEpisodeEvent(extra.config, {
        type: 'batch_apply',
        session_id: sessionId,
        episode_id: currentEpisodeId(sessionId),
        artifact_count: artifactIds?.length ?? 0,
        existing_worksheet_count: existingWorksheetNames?.length ?? 0,
        duration_ms: performance.now() - startedAt,
        outcome: batchApplyOutcome(result, executionStarted),
      });
      return result;
    },
  });

  return tool;
};

// Tableau's own "Use as Filter": one on-select, all-fields filter action per chart sheet.
function crossFilterAction(dashboardName: string, sourceWorksheet: string): FilterAction {
  return {
    target: dashboardName,
    sourceWorksheet,
    sourceDashboard: dashboardName,
    sourceExcludeSheets: [],
    activation: 'on-select',
    autoClear: true,
    onEmpty: false,
    singleSelect: false,
  };
}

const ACTION_BLOCK = /<action\b[^>]*>[\s\S]*?<\/action>/g;

function findFilterActionBlock(xml: string, expected: FilterAction): string | undefined {
  return [...xml.matchAll(ACTION_BLOCK)]
    .map((match) => match[0])
    .find((block) => filterActionMatches(block, expected));
}

// WHY: reservedXml still holds pruned stale actions, which stay live on Desktop and keep their names.
function addCrossFilterActions(xml: string, expected: FilterAction[], reservedXml: string): string {
  let result = xml;
  for (const action of expected) {
    if (findFilterActionBlock(result, action) !== undefined) continue;
    const captions = new Set(
      [...result.matchAll(ACTION_BLOCK), ...reservedXml.matchAll(ACTION_BLOCK)].map((match) =>
        unescapeXml(getAttr(match[0].match(/^<action\b[^>]*>/)?.[0] ?? '', 'caption') ?? ''),
      ),
    );
    let n = 1;
    while (captions.has(`Filter ${n} (generated)`)) n += 1;
    const spliced = spliceActionIntoWorkbook(
      result,
      renderFilterAction(
        `Filter ${n} (generated)`,
        nextActionName(`${result}${reservedXml}`),
        action,
      ),
    );
    if (spliced.isErr()) throw new Error(spliced.error.message);
    result = spliced.value;
  }
  return result;
}

// A filter action from this sheet that the exact generated one would clash with: the user edited it or made their own.
function hasUserTargetedFilterAction(xml: string, dashboardName: string, sheet: string): boolean {
  const exact = crossFilterAction(dashboardName, sheet);
  const fromSheet = [...xml.matchAll(ACTION_BLOCK)]
    .map((match) => match[0])
    .filter((block) => {
      const source = block.match(/<source\b[^>]*>/)?.[0] ?? '';
      const target = [...block.matchAll(/<param\b[^>]*>/g)]
        .map((param) => param[0])
        .find((param) => getAttr(param, 'name') === 'target');
      return (
        getAttr(block.match(/<command\b[^>]*>/)?.[0] ?? '', 'command') === 'tsc:tsl-filter' &&
        unescapeXml(getAttr(source, 'dashboard') ?? '') === dashboardName &&
        unescapeXml(getAttr(source, 'worksheet') ?? '') === sheet &&
        target !== undefined &&
        unescapeXml(getAttr(target, 'value') ?? '') === dashboardName
      );
    });
  return fromSheet.length > 0 && !fromSheet.some((block) => filterActionMatches(block, exact));
}

// WHY: Desktop keeps a replaced dashboard's old generated actions; drop only generated-caption ones.
const GENERATED_CAPTION = /^Filter [1-9]\d* \(generated\)$/;

function removeStaleFilterActions(
  xml: string,
  dashboardName: string,
  expected: FilterAction[],
): { xml: string; sources: string[] } {
  const sources: string[] = [];
  let result = xml;
  for (const block of [...xml.matchAll(ACTION_BLOCK)].map((match) => match[0])) {
    const source = unescapeXml(
      getAttr(block.match(/<source\b[^>]*>/)?.[0] ?? '', 'worksheet') ?? '',
    );
    const caption = unescapeXml(
      getAttr(block.match(/^<action\b[^>]*>/)?.[0] ?? '', 'caption') ?? '',
    );
    if (
      source === '' ||
      !GENERATED_CAPTION.test(caption) ||
      expected.some((action) => action.sourceWorksheet === source) ||
      !filterActionMatches(block, crossFilterAction(dashboardName, source))
    ) {
      continue;
    }
    result = result.replace(block, () => '');
    sources.push(source);
  }
  result = result.replace(/<actions>\s*<\/actions>/, '');
  return { xml: result, sources };
}

const MAX_LISTED = 5;
const MAX_NAME = 40;

function clip(value: string): string {
  return value.length > MAX_NAME ? `${value.slice(0, MAX_NAME)}...` : value;
}

function boundedList(items: string[]): string {
  const listed = items.slice(0, MAX_LISTED).map(clip).join(', ');
  return items.length > MAX_LISTED ? `${listed}, and ${items.length - MAX_LISTED} more` : listed;
}

// Rounded-bar sheets carry hidden helper columns (see refine/roundStackedBar.ts helperPrefix).
function hasRoundedBarHelpers(xml: string, sheetName: string): boolean {
  const fragment = extractSheetXml(xml, sheetName);
  return fragment !== null && /\bname=["']\[(?:\w+:)?__tmcp_round_/.test(fragment);
}

function crossFilterReceipt(
  polledXml: string,
  candidateXml: string,
  expected: FilterAction[],
  dashboardName: string,
  staleSources: string[],
): {
  applied: Array<{ name?: string; caption: string; sourceWorksheet?: string }>;
  warnings: string[];
} {
  const warnings: string[] = [];
  const staleLive = staleSources.flatMap((source) => {
    const block = findFilterActionBlock(polledXml, crossFilterAction(dashboardName, source));
    if (block === undefined) return [];
    const tag = block.match(/^<action\b[^>]*>/)?.[0] ?? '';
    return [`'${unescapeXml(getAttr(tag, 'caption') ?? '')}'`];
  });
  if (staleLive.length > 0) {
    warnings.push(
      `Old filter actions are still live: ${boundedList(staleLive)}. This Desktop build cannot remove actions; remove them in Dashboard > Actions.`,
    );
  }
  if (expected.length === 0) return { applied: [], warnings };
  const applied: Array<{ name: string; caption: string; sourceWorksheet: string }> = [];
  const missing: string[] = [];
  for (const action of expected) {
    const block = findFilterActionBlock(polledXml, action);
    if (block === undefined) {
      missing.push(action.sourceWorksheet);
      continue;
    }
    const tag = block.match(/^<action\b[^>]*>/)?.[0] ?? '';
    applied.push({
      name: unescapeXml(getAttr(tag, 'name') ?? ''),
      caption: unescapeXml(getAttr(tag, 'caption') ?? ''),
      sourceWorksheet: action.sourceWorksheet.slice(0, 64),
    });
  }
  const extraLive =
    (polledXml.match(/<action\b/g)?.length ?? 0) - (candidateXml.match(/<action\b/g)?.length ?? 0);
  const appended = extraLive > staleLive.length;
  if (missing.length > 0) {
    const dashboard = JSON.stringify(dashboardName);
    warnings.push(
      `Dashboard filter actions did not persist for: ${boundedList(missing)}. The dashboard is applied. Check Dashboard > Actions before retrying, because some Desktop builds rename new actions and author-action can report a miss when one landed. To add one, call author-action mode:'filter' sourceDashboard:${dashboard} sourceWorksheet:'<sheet>' targetSheet:${dashboard} caption:'Filter N (generated)' clearSelection:'show-all', with N unique.`,
    );
  }
  if (appended) {
    warnings.push(
      'This Desktop build adds actions instead of replacing them, so the workbook may hold duplicate actions. Remove the copies in Dashboard > Actions.',
    );
  }
  return { applied: missing.length === 0 ? boundedFilterActions(applied) : [], warnings };
}

// Keeps the receipt under the SDK truncation limit when sheet names are long.
function boundedFilterActions<T extends { name: string; caption: string; sourceWorksheet: string }>(
  actions: T[],
): Array<{ name?: string; caption: string; sourceWorksheet?: string }> {
  if (JSON.stringify(actions).length <= 600) return actions;
  const withoutName = actions.map(({ caption, sourceWorksheet }) => ({ caption, sourceWorksheet }));
  if (JSON.stringify(withoutName).length <= 600) return withoutName;
  return actions.map(({ caption }) => ({ caption }));
}

function verifyBatchReadback(
  workbookXml: string,
  candidateXml: string,
  reservations: Reservation[],
  dashboardName: string,
  worksheetNames: string[],
): BatchReadbackVerification {
  let pending = false;
  const worksheets = reservations.map((reservation): WorksheetVerification => {
    const { id: artifactId, title: worksheetTitle, worksheetXml } = reservation.artifact;
    const fragment = extractSheetXml(workbookXml, worksheetTitle);
    if (fragment === null) {
      return {
        artifactId,
        title: worksheetTitle,
        verification: {
          ok: false,
          status: 'failed',
          message: `Worksheet "${worksheetTitle}" was absent from workbook readback.`,
        },
      };
    }
    const findings = verifyWorksheetReadback(worksheetXml, fragment);
    pending ||= isReadbackUnsettled(findings);
    if (findings.some((finding) => finding.severity === 'error')) {
      return {
        artifactId,
        title: worksheetTitle,
        verification: {
          ok: false,
          status: 'failed',
          message: boundedText(formatReadbackVerificationError(findings)),
        },
      };
    }
    if (findings.some((finding) => finding.severity === 'warning')) {
      return {
        artifactId,
        title: worksheetTitle,
        verification: {
          ok: true,
          status: 'warning',
          message: boundedText(formatReadbackVerificationWarnings(findings).trim()),
        },
      };
    }
    return {
      artifactId,
      title: worksheetTitle,
      verification: { ok: true, status: 'passed' },
    };
  });
  const dashboardIssues = [
    ...composedWorksheetReadbackIssues(workbookXml, candidateXml, worksheetNames),
    ...dashboardCandidateReadbackIssues(workbookXml, candidateXml, dashboardName, worksheetNames),
  ];
  return {
    ok: worksheets.every(({ verification }) => verification.ok) && dashboardIssues.length === 0,
    pending,
    worksheets,
    dashboardIssues,
  };
}

function composedWorksheetReadbackIssues(
  workbookXml: string,
  candidateXml: string,
  worksheetNames: string[],
): string[] {
  return worksheetNames.flatMap((worksheetName) => {
    const intended = extractSheetXml(candidateXml, worksheetName);
    const readback = extractSheetXml(workbookXml, worksheetName);
    if (intended === null) {
      return [`Worksheet "${worksheetName}" was absent from the dashboard candidate.`];
    }
    if (readback === null) {
      return [`Worksheet "${worksheetName}" was absent from workbook readback.`];
    }
    const errors = verifyWorksheetReadback(intended, readback).filter(
      (finding) => finding.severity === 'error',
    );
    return errors.length > 0
      ? [`Worksheet "${worksheetName}": ${boundedText(formatReadbackVerificationError(errors))}`]
      : [];
  });
}

function unknownBatch({
  artifactIds,
  reservations,
  dashboardName,
  stage,
  error,
  verification,
}: {
  artifactIds: string[];
  reservations: Reservation[];
  dashboardName: string;
  stage: string;
  error: string;
  verification?: BatchReadbackVerification;
}): ReturnType<IncompleteOperationError<RunDashboardBatchPayload>['toErr']> {
  const steps: StepReceipt[] = artifactIds.map((artifactId, index) => {
    const item = verification?.worksheets[index];
    return {
      index,
      operation: 'worksheet',
      artifactId,
      state: 'unknown',
      retrySafe: false,
      title: reservations[index]?.artifact.title,
      ...(item ? { verification: boundedVerification(item.verification) } : {}),
    };
  });
  steps.push({
    index: artifactIds.length,
    operation: 'dashboard',
    dashboardName,
    state: 'unknown',
    retrySafe: false,
    stage,
    error: boundedText(error),
  });
  return incomplete({ applied: 'unknown', retrySafe: false, steps });
}

function boundedVerification(verification: ReadbackVerificationResult): ReadbackVerificationResult {
  return verification.message
    ? { ...verification, message: boundedText(verification.message) }
    : verification;
}

function describeLoadError(error: LoadWorkbookXmlFailure): string {
  if (error.type === 'execute-command-error') {
    return new DesktopCommandExecutionError(error.error).getErrorText();
  }
  return describeLoadWorkbookXmlError(error.error);
}

function loadFailureStage(error: LoadWorkbookXmlFailure): string {
  return error.type === 'load-workbook-xml-error' && error.error.type === 'workbook-drift'
    ? 'workbookDrift'
    : 'preDispatchApply';
}

function batchApplyOutcome(result: CallToolResult, executionStarted: boolean): BatchApplyOutcome {
  const content = result.content.find((item) => item.type === 'text');
  if (!content || content.type !== 'text') return 'refused';
  try {
    const payload = JSON.parse(content.text) as {
      applied?: AppliedState;
      steps?: Array<{ state?: string }>;
    };
    if (payload.applied === true) return 'succeeded';
    if (payload.applied === 'unknown') return 'unknown';
    if (payload.steps?.some((step) => step.state === 'aborted')) return 'aborted';
    if (payload.applied === false) return executionStarted ? 'failed' : 'refused';
  } catch {
    // Non-structured failures are refusals before a batch outcome exists.
  }
  return 'refused';
}

function incomplete(
  payload: RunDashboardBatchPayload,
): ReturnType<IncompleteOperationError<RunDashboardBatchPayload>['toErr']> {
  return new IncompleteOperationError(payload).toErr();
}

function boundedUnexpectedError(error: unknown): string {
  return boundedText(getExceptionMessage(error));
}

function boundedText(message: string): string {
  return message.length <= MAX_DYNAMIC_TEXT_LENGTH
    ? message
    : `${message.slice(0, MAX_DYNAMIC_TEXT_LENGTH - 3)}...`;
}

function firstDuplicate(values: readonly string[]): string | undefined {
  return values.find((value, index) => values.indexOf(value) !== index);
}

function firstCanonicalDuplicate(values: readonly string[]): string | undefined {
  return values.find(
    (value, index) => values.findIndex((candidate) => xmlNamesEqual(candidate, value)) !== index,
  );
}

function canonicalDifference(values: readonly string[], represented: readonly string[]): string[] {
  const difference: string[] = [];
  for (const value of values) {
    if (
      represented.some((candidate) => xmlNamesEqual(candidate, value)) ||
      difference.some((candidate) => xmlNamesEqual(candidate, value))
    ) {
      continue;
    }
    difference.push(value);
  }
  return difference;
}

function preflightInputFailure(
  steps: StepReceipt[],
  artifactIds: readonly string[],
  dashboardName: string,
  error: string,
  stage = 'inputValidation',
): ReturnType<IncompleteOperationError<RunDashboardBatchPayload>['toErr']> {
  const reason = 'Preflight failed before any writes.';
  appendSkippedArtifacts(steps, artifactIds, 0, reason);
  steps.push({
    index: artifactIds.length,
    operation: 'dashboard',
    dashboardName,
    state: 'failed',
    retrySafe: true,
    stage,
    error: boundedText(error),
  });
  return incomplete({ applied: false, retrySafe: true, steps });
}

function appendPreflightArtifactFailure(
  steps: StepReceipt[],
  artifactIds: readonly string[],
  failedIndex: number,
  dashboardName: string,
  error: string,
): void {
  const reason = 'Preflight failed before any writes.';
  appendSkippedArtifacts(steps, artifactIds, 0, reason);
  steps[failedIndex] = {
    index: failedIndex,
    operation: 'worksheet',
    artifactId: artifactIds[failedIndex]!,
    state: 'failed',
    retrySafe: true,
    error: boundedText(error),
  };
  appendSkippedCompose(steps, artifactIds.length, dashboardName, reason);
}

function appendAbortedBatch(
  steps: StepReceipt[],
  artifactIds: readonly string[],
  dashboardName: string,
): void {
  for (const [index, artifactId] of artifactIds.entries()) {
    steps.push({
      index,
      operation: 'worksheet',
      artifactId,
      state: 'aborted',
      retrySafe: true,
      reason: 'The request was aborted before the batch write started.',
    });
  }
  steps.push({
    index: artifactIds.length,
    operation: 'dashboard',
    dashboardName,
    state: 'aborted',
    retrySafe: true,
    reason: 'The request was aborted before the batch write started.',
  });
}

function appendSkippedArtifacts(
  steps: StepReceipt[],
  artifactIds: readonly string[],
  startIndex: number,
  reason: string,
): void {
  for (let index = startIndex; index < artifactIds.length; index += 1) {
    steps.push({
      index,
      operation: 'worksheet',
      artifactId: artifactIds[index]!,
      state: 'skipped',
      retrySafe: true,
      reason,
    });
  }
}

function appendSkippedCompose(
  steps: StepReceipt[],
  index: number,
  dashboardName: string,
  reason: string,
): void {
  steps.push({
    index,
    operation: 'dashboard',
    dashboardName,
    state: 'skipped',
    retrySafe: true,
    reason,
  });
}
