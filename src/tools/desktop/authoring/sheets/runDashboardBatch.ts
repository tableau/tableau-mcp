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
import { isRouteMissing } from '../../../../desktop/externalApi/toolUtils.js';
import {
  deleteDashboard,
  listDashboardRefs,
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
import { deleteDashboardGuarded } from '../../../../desktop/wrappers/deleteDashboardGuarded.js';
import { getWorkbookXml } from '../../../../desktop/wrappers/getWorkbookXml.js';
import {
  describeLoadWorkbookXmlError,
  loadWorkbookXml,
  type LoadWorkbookXmlError,
} from '../../../../desktop/wrappers/loadWorkbookXml.js';
import { resolveCanonicalWorksheetName } from '../../../../desktop/wrappers/loadWorksheetXml.js';
import { pollReadback } from '../../../../desktop/wrappers/pollReadback.js';
import { decodeXmlEntities, xmlNamesEqual } from '../../../../desktop/xmlElement.js';
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
import { readWorkbookActions } from '../datasource/authorActionLifecycle.js';
import {
  type CarriedActions,
  carriedFrom,
  insertCarriedActions,
  type ReadActions,
  readVerbatimWorkbookActions,
  restoreTabPosition,
} from './carryWorkbookActions.js';
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
    .describe('Live non-KPI chart worksheet names in dashboard order.'),
  title: z.string().trim().min(1).max(255).optional(),
  layoutType: z
    .enum(['auto-grid', 'rows', 'columns', 'executive-summary'])
    .optional()
    .describe('Dashboard layout; executive-summary uses KPI and chart roles.'),
  gridColumns: z.number().int().min(1).max(6).optional(),
  kpiWorksheetNames: z
    .array(z.string().trim().min(1).max(255))
    .min(1)
    .max(5)
    .optional()
    .describe('Live KPI worksheet names in display order from left to right.'),
  replaceExisting: z.boolean().optional(),
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
      retrySafe: boolean;
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
    description: 'Apply staged worksheets and compose live KPI/chart sheets into one dashboard.',
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

          // sentNote is set when the delete dispatches; removedNote replaces it once removal is confirmed.
          let sentNote: string | undefined;
          let removedNote: string | undefined;
          let removalWarnings: string[] = [];
          const failBatch = (
            stage: string,
            cause: string,
            options: {
              verification?: BatchReadbackVerification;
              applied?: boolean;
              withoutNote?: boolean;
            } = {},
          ): ReturnType<typeof unknownBatch> => {
            const note = options.withoutNote ? undefined : (removedNote ?? sentNote);
            return unknownBatch({
              artifactIds: orderedArtifactIds,
              reservations,
              dashboardName,
              stage,
              error: [
                ...(note ? [note, `Cause: ${boundedText(cause)}`] : [boundedText(cause)]),
                ...removalWarnings,
              ].join(' '),
              verification: options.verification,
              unapplied: options.applied === false,
            });
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
            // Rebuild under the existing name's exact case so action sources and story points still match.
            if (existingDashboardName) dashboardName = existingDashboardName;
            if (existingDashboardName && isStoryboard(workbookXml, existingDashboardName)) {
              return preflightInputFailure(
                steps,
                orderedArtifactIds,
                dashboardName,
                `"${dashboardName}" is a story, not a dashboard. Nothing was changed.`,
                'storyboard',
              );
            }
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

            const assembleCandidate = (
              baseXml: string,
              dashboardToDelete: string | undefined,
            ):
              | { ok: true; xml: string }
              | { ok: false; artifactIndex?: number; message: string } => {
              let xml = baseXml;
              for (const [index, reservation] of reservations.entries()) {
                try {
                  xml = upsertWorksheetAndWindowIntoWorkbook(
                    xml,
                    canonicalArtifactNames[index]!,
                    reservation.artifact.worksheetXml,
                    reservation.artifact.windowXml,
                  );
                } catch (error) {
                  return {
                    ok: false,
                    artifactIndex: index,
                    message: `Could not add the artifact to the workbook candidate: ${getExceptionMessage(error)}`,
                  };
                }
              }
              try {
                if (dashboardToDelete) xml = deleteDashboard(xml, dashboardToDelete);
                xml = buildDashboardCandidateXml({
                  baselineXml: xml,
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
                return {
                  ok: false,
                  message: `Could not compose dashboard candidate: ${getExceptionMessage(error)}`,
                };
              }
              return { ok: true, xml };
            };
            const candidateValidationError = (
              baseXml: string,
              candidate: string,
            ): string | undefined => {
              const blockingIssues = introducedBlockingValidationIssues(
                runValidation(baseXml, 'workbook').issues,
                runValidation(candidate, 'workbook').issues,
              );
              const dashboardIssues = targetDashboardInvariantIssues(
                candidate,
                dashboardName,
                worksheetNames,
              );
              if (blockingIssues.length === 0 && dashboardIssues.length === 0) return undefined;
              return [
                ...blockingIssues.map((issue) => `${issue.ruleId}: ${issue.message}`),
                ...dashboardIssues.map((issue) => issue.message),
              ].join('; ');
            };

            const replaced = existingDashboardName !== undefined;
            const assembled = assembleCandidate(workbookXml, existingDashboardName);
            if (!assembled.ok) {
              if (assembled.artifactIndex !== undefined) {
                appendPreflightArtifactFailure(
                  steps,
                  orderedArtifactIds,
                  assembled.artifactIndex,
                  dashboardName,
                  assembled.message,
                );
                return incomplete({ applied: false, retrySafe: true, steps });
              }
              return preflightInputFailure(
                steps,
                orderedArtifactIds,
                dashboardName,
                assembled.message,
                'candidateBuild',
              );
            }
            let candidateXml = assembled.xml;
            const preflightError = candidateValidationError(workbookXml, candidateXml);
            if (preflightError) {
              return preflightInputFailure(
                steps,
                orderedArtifactIds,
                dashboardName,
                preflightError,
                'candidateValidation',
              );
            }
            let originalActions: ReadActions | undefined;
            if (existingDashboardName) {
              const read = readVerbatimWorkbookActions(workbookXml);
              if (read.isErr()) {
                return preflightInputFailure(
                  steps,
                  orderedArtifactIds,
                  dashboardName,
                  `Could not read the workbook actions that must survive the rebuild: ${read.error}`,
                  'actionCarry',
                );
              }
              originalActions = read.value;
            }
            const existingDashboardId = existingDashboardName
              ? listDashboardRefs(workbookXml).find((ref) => xmlNamesEqual(ref.name, dashboardName))
                  ?.id
              : undefined;
            if (existingDashboardName && existingDashboardId === undefined) {
              return preflightInputFailure(
                steps,
                orderedArtifactIds,
                dashboardName,
                `Dashboard "${dashboardName}" has no id in the workbook, so it cannot be removed safely. Nothing was changed.`,
                'existingDashboardId',
              );
            }

            if (extra.signal.aborted) {
              appendAbortedBatch(steps, orderedArtifactIds, dashboardName);
              return incomplete({ applied: false, retrySafe: true, steps });
            }

            let baseXml = workbookXml;
            let notAppliedNote: string | undefined;
            let carried: CarriedActions | undefined;
            if (existingDashboardName && originalActions && existingDashboardId) {
              // A same-name apply edits zones in place and a story point survives a workbook removal, so delete natively.
              const deleted = await deleteDashboardGuarded({
                executor,
                signal: extra.signal,
                dashboardId: existingDashboardId,
                expectedWorkbookXml: workbookXml,
                expectedInstanceId: liveInstanceId,
                onDispatch: () => {
                  executionStarted = true;
                  sentNote = `The delete of the old dashboard "${dashboardName}" was sent, but Desktop did not confirm it. It may be gone, with the actions tied to it. Check the workbook; undo-workbook restores them.`;
                },
              });
              if (deleted.kind === 'drift') {
                return preflightInputFailure(
                  steps,
                  orderedArtifactIds,
                  dashboardName,
                  describeLoadError({
                    type: 'load-workbook-xml-error',
                    error: { type: 'workbook-drift' },
                  }),
                  'workbookDrift',
                );
              }
              if (deleted.kind === 'failed') {
                // The real applyDocument dispatches before the HTTP call, so a 404 arrives dispatched.
                const routeMissing = isRouteMissing(deleted.error);
                if (deleted.dispatched && !routeMissing) {
                  return failBatch('removeExisting', describeDesktopError(deleted.error), {
                    applied: false,
                  });
                }
                return preflightInputFailure(
                  steps,
                  orderedArtifactIds,
                  dashboardName,
                  routeMissing
                    ? 'This Desktop build cannot delete a dashboard natively, so the dashboard cannot be replaced. Nothing was changed.'
                    : describeDesktopError(deleted.error),
                  routeMissing ? 'deleteRouteMissing' : 'preDispatchRemoval',
                );
              }
              removalWarnings = [
                ...deleted.warnings
                  .slice(0, 3)
                  .map(({ code, message }) =>
                    boundedText(
                      `Desktop reported a warning while removing the old dashboard - ${code}: ${message}`,
                    ),
                  ),
                ...(deleted.warnings.length > 3
                  ? [
                      `Desktop reported ${deleted.warnings.length - 3} more warning${deleted.warnings.length === 4 ? '' : 's'} while removing the old dashboard.`,
                    ]
                  : []),
              ];

              const couldNotConfirm = (reason: string): ReturnType<typeof unknownBatch> =>
                failBatch('removeExisting', `Could not confirm the removal: ${reason}.`, {
                  applied: false,
                });
              let thrown: unknown;
              const gone = await pollReadback({
                read: () => getWorkbookXml({ executor, signal: extra.signal }),
                settled: (xml) => !dashboardPresent(xml, dashboardName),
                signal: extra.signal,
              }).catch((error: unknown) => {
                thrown = error;
                return undefined;
              });
              if (gone === undefined) return couldNotConfirm(boundedUnexpectedError(thrown));
              if (!gone.ok) return couldNotConfirm(describeDesktopError(gone.error));
              if (!gone.settled) {
                return failBatch(
                  'removeExisting',
                  `Desktop did not remove "${dashboardName}"; it may now be hidden. Nothing was rebuilt. Run undo-workbook to restore it.`,
                  { applied: false, withoutNote: true },
                );
              }
              const notApplied = (count: number | undefined): string =>
                `The old dashboard "${dashboardName}" was removed${
                  count === undefined
                    ? ', with the actions tied to it, and the new one was not applied. Run undo-workbook to restore them.'
                    : count > 0
                      ? `, with the ${count} action${count === 1 ? '' : 's'} tied to it, and the new one was not applied. Run undo-workbook to restore them.`
                      : ' and the new one was not applied. Run undo-workbook to restore it.'
                }`;
              removedNote = notApplied(undefined);
              baseXml = gone.value;
              const rebuilt = assembleCandidate(baseXml, undefined);
              if (!rebuilt.ok)
                return failBatch('rebuildCandidate', rebuilt.message, { applied: false });
              const carriedResult = carriedFrom(originalActions, baseXml);
              if (carriedResult.isErr()) {
                return failBatch('rebuildRead', carriedResult.error, { applied: false });
              }
              carried = carriedResult.value;
              removedNote = notApplied(carried.actions.length);
              const withActions = insertCarriedActions(rebuilt.xml, carried);
              if (withActions.isErr()) {
                return failBatch('rebuildCandidate', withActions.error, { applied: false });
              }
              candidateXml = restoreTabPosition(workbookXml, withActions.value, dashboardName);
              const rebuildError = candidateValidationError(baseXml, candidateXml);
              if (rebuildError)
                return failBatch('rebuildValidation', rebuildError, { applied: false });
              removedNote = `The old dashboard "${dashboardName}" was removed and the new one may not have been applied. Check the workbook; undo-workbook restores the old dashboard and its actions.`;
              notAppliedNote = notApplied(carried.actions.length);
            }

            let dispatchAttempted = false;
            const applyResult = await loadWorkbookXml({
              xml: candidateXml,
              baselineXml: baseXml,
              expectedWorkbookXml: baseXml,
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
              const error = describeLoadError(applyResult.error);
              if (dispatchAttempted) return failBatch('apply', error);
              if (replaced) {
                removedNote = notAppliedNote ?? removedNote;
                return failBatch('rebuildApply', error, { applied: false });
              }
              return preflightInputFailure(
                steps,
                orderedArtifactIds,
                dashboardName,
                error,
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
              return failBatch(
                'postApplyRead',
                new DesktopCommandExecutionError(polled.error).getErrorText(),
              );
            }

            const verification = verifyBatchReadback(
              polled.value,
              candidateXml,
              reservations,
              dashboardName,
              worksheetNames,
            );
            if (!verification.ok) {
              return failBatch(
                'readbackVerification',
                [...verification.worksheets]
                  .filter(({ verification: item }) => !item.ok)
                  .map(({ title, verification: item }) => `${title}: ${item.message ?? 'mismatch'}`)
                  .concat(verification.dashboardIssues)
                  .join('; ') || 'Post-apply verification did not settle.',
                { verification },
              );
            }

            const emptyWorksheetNames = findBlankWorksheetNames(polled.value, worksheetNames);
            const carriedActions = carried?.actions ?? [];
            const survivingActions =
              carriedActions.length > 0
                ? new Set(
                    readWorkbookActions(polled.value)
                      .unwrapOr([])
                      .map((action) => action.name),
                  )
                : new Set<string>();
            const lostActions = carriedActions.filter(
              (action) => !survivingActions.has(action.name),
            );
            const warnings = [
              ...removalWarnings,
              ...(emptyWorksheetNames.length > 0
                ? [emptyWorksheetWarning(emptyWorksheetNames)]
                : []),
              ...lostActions.map(
                (action) =>
                  `Action "${action.caption || action.name}" (${action.name}) was carried over but is missing after the rebuild; recreate it with author-action.`,
              ),
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
              ...(warnings.length > 0 ? { warnings } : {}),
            });
            return Ok({ applied: true, retrySafe: false, steps: successSteps });
          } catch (error) {
            if (executionStarted) {
              return failBatch('unexpected-error', boundedUnexpectedError(error));
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
  unapplied = false,
}: {
  artifactIds: string[];
  reservations: Reservation[];
  dashboardName: string;
  stage: string;
  error: string;
  verification?: BatchReadbackVerification;
  /** True while no worksheet was applied yet (the failure came before the rebuild dispatched). */
  unapplied?: boolean;
}): ReturnType<IncompleteOperationError<RunDashboardBatchPayload>['toErr']> {
  const steps: StepReceipt[] = artifactIds.map((artifactId, index) => {
    if (unapplied) {
      return {
        index,
        operation: 'worksheet',
        artifactId,
        state: 'skipped',
        retrySafe: false,
        reason: 'Not applied: the batch stopped before the rebuild was sent.',
      };
    }
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
    error,
  });
  return incomplete({ applied: 'unknown', retrySafe: false, steps });
}

function boundedVerification(verification: ReadbackVerificationResult): ReadbackVerificationResult {
  return verification.message
    ? { ...verification, message: boundedText(verification.message) }
    : verification;
}

function describeDesktopError(error: ExecuteCommandError): string {
  return new DesktopCommandExecutionError(error).getErrorText();
}

function isStoryboard(workbookXml: string, name: string): boolean {
  return [...workbookXml.matchAll(/<dashboard\b[^>]*>/g)].some(
    ([open]) =>
      /\btype=(['"])storyboard\1/.test(open) &&
      xmlNamesEqual(decodeXmlEntities(/\bname=(['"])(.*?)\1/.exec(open)?.[2] ?? ''), name),
  );
}

function dashboardPresent(workbookXml: string, name: string): boolean {
  return (
    listWorkbookDashboards(workbookXml).some((existing) => xmlNamesEqual(existing, name)) ||
    [...workbookXml.matchAll(/<window\b[^>]*>/g)].some(
      ([open]) =>
        /\bclass=(['"])dashboard\1/.test(open) &&
        xmlNamesEqual(decodeXmlEntities(/\bname=(['"])(.*?)\1/.exec(open)?.[2] ?? ''), name),
    )
  );
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
