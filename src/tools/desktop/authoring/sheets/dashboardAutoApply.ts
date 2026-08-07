// W60 single-pass dashboard-auto-apply: collapses the proven 5-call / 6-Desktop-apply
// dashboard composition (bind-template x N + batch-create-and-cache-sheets +
// build-and-apply-dashboard) into ONE MCP call with one content-creation apply plus
// one cheap follow-up activation apply on success. See the W60 dashboard single-pass
// design (§2 architecture, §4 the five design questions, §7 test plan).
//
// Every mutation stays IN-MEMORY over one pristine workbook read until the single
// creating loadWorkbookXml dispatch (§4-Q3): a bind failure, inject failure, batch-preflight
// refusal, events-dirty re-check, or preflight validation failure all short-circuit
// BEFORE Desktop is touched. Nothing here is partially applied on the primary path.

import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'crypto';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { type BinderResult, bindTemplate } from '../../../../desktop/binder/binder.js';
import { ExecuteCommandError } from '../../../../desktop/externalApi/executorTypes.js';
import {
  deleteDashboard,
  listWorkbookDashboards,
} from '../../../../desktop/metadata/dashboards.js';
import { resolveSession } from '../../../../desktop/session/sessionResolution.js';
import { injectTemplate } from '../../../../desktop/templates/injectTemplate.js';
import {
  buildInjectedWorkbookXml,
  escapeXml,
} from '../../../../desktop/templates/injectTemplateCore.js';
import { loadRuntimeTemplateCatalogSnapshots } from '../../../../desktop/templates/runtimeTemplateCatalog.js';
import {
  type TargetDashboardInvariantIssue,
  targetDashboardInvariantIssues,
} from '../../../../desktop/validation/targetDashboardInvariant.js';
import { getWorkbookXml } from '../../../../desktop/wrappers/getWorkbookXml.js';
import { injectViewpoints } from '../../../../desktop/wrappers/injectViewpoints.js';
import { loadDashboardXml } from '../../../../desktop/wrappers/loadDashboardXml.js';
import {
  loadWorkbookXml,
  type LoadWorkbookXmlError,
} from '../../../../desktop/wrappers/loadWorkbookXml.js';
import { normalizeXmlName, xmlNamesEqual } from '../../../../desktop/xmlElement.js';
import {
  DesktopCommandExecutionError,
  IncompleteOperationError,
} from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import { getExceptionMessage } from '../../../../utils/getExceptionMessage.js';
import { sessionParam } from '../../params.js';
import {
  jsonToolResult,
  type NextAction,
  prefillNextAction,
  type StructuredResult,
  withNextAction,
} from '../../structuredContent.js';
import { DesktopTool } from '../../tool.js';
import { buildDashboardXml, computeZones, type Zone } from './dashboardZones.js';

/**
 * Whether a fully zone-populated `<dashboard>` node injected as part of a single
 * workbook-level document apply renders correctly on readback (the
 * spec's "one live unknown", §2). Set from the W60 live probe (2026-07-08, session
 * 18055): a 2-worksheet auto-grid dashboard was injected into one workbook-level apply
 * and `tableau-get-dashboard` readback showed the exact zone tree (worksheet refs,
 * w/h/x/y tiling) intact — NOT stripped to a basic empty layout. PASS → primary mode.
 * One `if` at the content dispatch step flips this to fallback mode (a second
 * `loadDashboardXml` content dispatch, §2 "Probe fails") without touching the rest — never a
 * user-facing flag.
 */
export const DASHBOARD_ZONES_VIA_WORKBOOK = true;

const MIN_ASKS = 2;
const MAX_ASKS = 6;
const MAX_PROPOSAL_CANDIDATES = 3;
const MAX_PROPOSAL_FIELDS = 20;

const askSchema = z.object({
  ask: z.string().min(1),
  title: z.string().min(1).max(80).optional(),
});

const layoutSchema = z.object({
  layoutType: z.enum(['auto-grid', 'rows', 'columns']).optional().default('auto-grid'),
  gridColumns: z.number().optional(),
});

const paramsSchema = {
  session: sessionParam(),
  asks: z.array(askSchema).min(MIN_ASKS).max(MAX_ASKS).describe(`2-${MAX_ASKS} asks.`),
  dashboardName: z.string().min(1),
  title: z.string().optional(),
  layout: layoutSchema.optional(),
};

/** One ask's outcome, tagged with its position and original ask text for diagnostics. */
type AskOutcome = { index: number; ask: string; result: BinderResult };
type ProposalResult = Extract<BinderResult, { status: 'propose' }>;
type ProposalSummary = Omit<ProposalResult, 'llm_input' | 'output_schema'> & {
  llm_input: Pick<ProposalResult['llm_input'], 'ask' | 'candidate_templates' | 'fields'>;
};
type RefusalAskOutcome = Omit<AskOutcome, 'result'> & {
  result: Exclude<BinderResult, ProposalResult> | ProposalSummary;
};

type DashboardAutoApplyRefusalResult = {
  applied: false;
  results: RefusalAskOutcome[];
  guidance: string;
  apply_error?: string;
};

type DashboardAutoApplyDriftResult = {
  applied: false;
  retrySafe: true;
  results: AskOutcome[];
  guidance: string;
  apply_error: string;
};

type Replaced = { dashboard?: string; sheets: string[] };

type DashboardAutoApplySuccessResult = {
  applied: true;
  retrySafe: false;
  dashboard: string;
  sheets: Array<{ title: string; template_name: string }>;
  verification: DashboardAutoApplyVerification & { state: 'verified' };
  phase_ms: { read: number; bind: number; inject: number; apply: number };
  guidance: string;
  replaced?: Replaced;
};

type DashboardAutoApplyPartialResult = {
  applied: 'partial';
  retrySafe: false;
  dashboard: string;
  sheets: Array<{ title: string; template_name: string }>;
  zones:
    | { state: 'unknown'; attempted: Zone[] }
    | { state: 'failed'; attempted: Zone[]; landed: []; failed: Zone[] };
  apply_error: string;
  verification: DashboardAutoApplyVerification;
  guidance: string;
  replaced?: Replaced;
};

type DashboardAutoApplyVerification =
  | {
      state: 'verified';
      dashboard: string;
      worksheetZones: string[];
      worksheetWindows: string[];
      dashboardWindow: true;
      directViewpoints: string[];
    }
  | { state: 'failed'; issues: TargetDashboardInvariantIssue[] }
  | { state: 'unknown'; read_error: string };

type DashboardAutoApplyUnknownResult = {
  applied: 'unknown';
  retrySafe: false;
  dashboard: string;
  sheets: Array<{ title: string; template_name: string }>;
  results: AskOutcome[];
  apply_error: string;
  verification: DashboardAutoApplyVerification;
  guidance: string;
  replaced?: Replaced;
};

type DashboardAutoApplyToolResult =
  | DashboardAutoApplyRefusalResult
  | DashboardAutoApplyDriftResult
  | DashboardAutoApplySuccessResult
  | DashboardAutoApplyPartialResult
  | DashboardAutoApplyUnknownResult;
type StructuredDashboardAutoApplyToolResult = StructuredResult<DashboardAutoApplyToolResult>;

/** Human-readable detail for a loadWorkbookXml failure (mirrors bindTemplate.ts). */
function describeApplyError(
  error:
    | { type: 'execute-command-error'; error: ExecuteCommandError }
    | { type: 'load-workbook-xml-error'; error: LoadWorkbookXmlError },
): string {
  if (error.type === 'load-workbook-xml-error') {
    const inner = error.error;
    if (inner.type === 'validation-failed') {
      return `preflight validation failed: ${inner.issues.map((i) => i.message).join('; ')}`;
    }
    if (inner.type === 'load-rejected') {
      return `Tableau rejected the load: ${inner.message}`;
    }
    if (inner.type === 'workbook-drift') {
      return 'the workbook changed while the dashboard was being prepared';
    }
    return 'invalid workbook content';
  }
  return `workbook load command failed: ${JSON.stringify(error.error)}`;
}

function refusal(
  results: AskOutcome[],
  guidance: string,
  apply_error?: string,
  nextAction?: NextAction,
): ReturnType<IncompleteOperationError<DashboardAutoApplyRefusalResult>['toErr']> {
  const result: DashboardAutoApplyRefusalResult = {
    applied: false,
    results: results.map((outcome): RefusalAskOutcome => {
      if (outcome.result.status !== 'propose') return outcome;
      const proposal = outcome.result;
      return {
        ...outcome,
        result: {
          status: proposal.status,
          decline_reason: proposal.decline_reason,
          llm_input: {
            ask: proposal.llm_input.ask,
            candidate_templates: proposal.llm_input.candidate_templates.slice(
              0,
              MAX_PROPOSAL_CANDIDATES,
            ),
            fields: proposal.llm_input.fields.slice(0, MAX_PROPOSAL_FIELDS),
          },
        },
      };
    }),
    guidance,
    ...(apply_error ? { apply_error } : {}),
  };
  return new IncompleteOperationError(
    nextAction ? withNextAction(result, nextAction) : result,
  ).toErr();
}

/** Quote-agnostic (matches injectTemplateCore.ts's own conventions): true when `title`
 * already names a `<worksheet>` element in `workbookXml`. */
function hasWorksheetNamed(workbookXml: string, title: string): boolean {
  const nameAttr = escapeXml(title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`<worksheet name=['"]${nameAttr}['"]>`).test(workbookXml);
}

/** True when `title` is referenced by a `<zone name="...">` in ANY dashboard already in
 * `workbookXml` — mirrors injectTemplateCore.ts's own zoneRe (injectTemplateCore.ts:89),
 * duplicated here (not imported — that file is off-limits, in-flight in another lane). */
function isReferencedByDashboardZone(workbookXml: string, title: string): boolean {
  const nameAttr = escapeXml(title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`<zone [^>]*name=['"]${nameAttr}['"]`).test(workbookXml);
}

const title = 'Assembling dashboard';

export const getDashboardAutoApplyTool = (
  server: DesktopMcpServer,
  zonesViaWorkbook = DASHBOARD_ZONES_VIA_WORKBOOK,
): DesktopTool<typeof paramsSchema> => {
  const dashboardAutoApplyTool = new DesktopTool({
    server,
    name: 'dashboard-auto-apply',
    title,
    description: 'Build dashboard from 2-6 asks; all-or-nothing.',
    paramsSchema,
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
    callback: async (
      { session, asks, dashboardName, title: titleText, layout },
      extra,
    ): Promise<CallToolResult> => {
      return await dashboardAutoApplyTool.logAndExecute<StructuredDashboardAutoApplyToolResult>({
        extra,
        args: { session, asks, dashboardName, title: titleText, layout },
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }
          const resolvedSession = sessionResult.value;
          const executor = await extra.getExecutor(resolvedSession);

          const verifyDashboardReadback = async (
            expectedWorksheetNames: string[],
          ): Promise<DashboardAutoApplyVerification> => {
            const readback = await getWorkbookXml({ executor, signal: extra.signal });
            if (readback.isErr()) {
              return {
                state: 'unknown',
                read_error: `workbook readback failed: ${JSON.stringify(readback.error)}`,
              };
            }
            const issues = targetDashboardInvariantIssues(
              readback.value,
              dashboardName,
              expectedWorksheetNames,
            );
            if (issues.length > 0) return { state: 'failed', issues };
            return {
              state: 'verified',
              dashboard: dashboardName,
              worksheetZones: expectedWorksheetNames,
              worksheetWindows: expectedWorksheetNames,
              dashboardWindow: true,
              directViewpoints: expectedWorksheetNames,
            };
          };

          const readStart = Date.now();
          const xmlResult = await getWorkbookXml({ executor, signal: extra.signal });
          if (xmlResult.isErr()) {
            return new DesktopCommandExecutionError(xmlResult.error).toErr();
          }
          const pristineXml = xmlResult.value;
          const readMs = Date.now() - readStart;

          const runtimeCatalog = loadRuntimeTemplateCatalogSnapshots({ automaticOnly: true });
          const manifests = new Map(
            [...runtimeCatalog].map(([template, value]) => [template, value.descriptor]),
          );

          // ── Bind ALL N against the SAME pristine XML (never a bind-mutated copy —
          // this is the unit-level pin for the w60-portability-live.md sequential-
          // degradation finding: every ask sees identical workbookXml).
          const bindStart = Date.now();
          const outcomes: AskOutcome[] = [];
          for (let i = 0; i < asks.length; i++) {
            // Sequential await (not Promise.all): keeps bind ordering deterministic for
            // the pristine-read spy test; costs ~0.1-0.3s total at N<=6 (spec §6).
            const result = await bindTemplate({
              ask: asks[i].ask,
              workbookXml: pristineXml,
              manifests,
            });
            outcomes.push({ index: i, ask: asks[i].ask, result });
          }
          const bindMs = Date.now() - bindStart;

          const notBound = outcomes.filter((o) => o.result.status !== 'bound');
          if (notBound.length > 0) {
            return refusal(
              outcomes,
              'One or more asks did not deterministically bind (Call-1, no-LLM). Nothing was applied to ' +
                'the live workbook. Revise any proposed or failed ask, then retry dashboard-auto-apply; ' +
                'or build each view with list-templates, build-worksheets-from-templates, and apply-worksheet.',
              undefined,
              prefillNextAction('Resolve each ask before retrying'),
            );
          }

          // ── Defense-in-depth gate matrix (mirrors bindTemplate.ts:434-440 verbatim,
          // per-ask): Call-1 only (never passed a proposal here, so used_llm===false is
          // structurally guaranteed by binder.ts, but asserted explicitly — flipping
          // either half of this check must fail a test, same discipline as w60-auto-apply).
          const notFastPath = outcomes.filter((o) => {
            const r = o.result;
            if (r.status !== 'bound') return false;
            const manifest = manifests.get(r.args.template_name);
            return r.used_llm !== false || manifest?.fast_path_eligible !== true;
          });
          if (notFastPath.length > 0) {
            return refusal(
              outcomes,
              'One or more bound asks are not eligible for server-side auto-apply (used_llm or ' +
                'fast_path_eligible gate failed). Nothing was applied. Fall back to the per-viz flow.',
              undefined,
              prefillNextAction('Use the per-viz flow'),
            );
          }

          // ── Resolve titles (per-ask override, else the bind's own escaped title) and
          // refuse in-batch duplicates BEFORE touching the workbook (Q1).
          const resolvedTitles: string[] = outcomes.map((o, i) => {
            const bound = o.result as Extract<BinderResult, { status: 'bound' }>;
            const override = asks[i].title;
            return override !== undefined ? escapeXml(override) : bound.args.title;
          });
          const seen = new Map<string, number[]>();
          resolvedTitles.forEach((title, index) => {
            const key = normalizeXmlName(title);
            seen.set(key, [...(seen.get(key) ?? []), index]);
          });
          const dupes = [...seen.entries()].filter(([, idxs]) => idxs.length > 1);
          if (dupes.length > 0) {
            const detail = dupes
              .map(([t, idxs]) => `"${t}" at indices [${idxs.join(', ')}]`)
              .join('; ');
            return refusal(
              outcomes,
              `Duplicate resolved title(s) within the batch: ${detail}. Give each ask a distinct 'title' ` +
                'and retry — nothing was applied.',
              `duplicate title(s): ${detail}`,
              prefillNextAction('Give each ask a distinct title'),
            );
          }

          // ── Replace semantics for the dashboard itself (Q1): delete first so the
          // zone-reference safety check below never self-collides with the dashboard
          // we are about to regenerate.
          let currentXml = pristineXml;
          const replaced: Replaced = { sheets: [] };
          if (
            listWorkbookDashboards(currentXml).some((name) => xmlNamesEqual(name, dashboardName))
          ) {
            currentXml = deleteDashboard(currentXml, dashboardName);
            replaced.dashboard = dashboardName;
          }

          // ── Batch refusal: a resolved title already referenced by a DIFFERENT
          // existing dashboard's zone (Q1). Silent Desktop dedup-to-"Name (1)" would
          // wire OUR new dashboard's zones/viewpoints to the OLD sheet — loud refusal
          // beats a silently wrong dashboard.
          const zoneCollisions = resolvedTitles.filter((t) =>
            isReferencedByDashboardZone(currentXml, t),
          );
          if (zoneCollisions.length > 0) {
            const detail = zoneCollisions.map((t) => `"${t}"`).join(', ');
            return refusal(
              outcomes,
              `Resolved title(s) ${detail} are already referenced by another existing dashboard's zone. ` +
                'Applying this batch would silently rewire that dashboard to a replaced sheet. Rename the ' +
                "ask's title and retry — nothing was applied.",
              `title referenced by existing dashboard zone: ${detail}`,
              prefillNextAction('Rename the colliding worksheet titles'),
            );
          }

          // ── Sequential in-memory injects (worksheets), each its own applyNonce
          // (mirrors bindTemplate.ts:296-307). Any failure refuses the WHOLE batch —
          // nothing is dispatched (Q3).
          const injectStart = Date.now();
          const sheets: Array<{ title: string; template_name: string }> = [];
          for (let i = 0; i < outcomes.length; i++) {
            const bound = outcomes[i].result as Extract<BinderResult, { status: 'bound' }>;
            const resolvedTitle = resolvedTitles[i];
            if (hasWorksheetNamed(currentXml, resolvedTitle)) {
              replaced.sheets.push(resolvedTitle);
            }
            const selectedTemplate = runtimeCatalog.get(bound.args.template_name);
            if (!selectedTemplate) {
              return refusal(
                outcomes,
                `Could not read template "${bound.args.template_name}" for ask index ${i}. ` +
                  'Nothing was applied.',
                'template read failed',
              );
            }
            const templateXml = selectedTemplate.snapshot.xml;
            const applyNonce = `${resolvedSession}:${Date.now()}:${randomUUID()}`;
            let injected: ReturnType<typeof buildInjectedWorkbookXml>;
            try {
              injected = buildInjectedWorkbookXml({
                workbookXml: currentXml,
                templateXml,
                title: resolvedTitle,
                sheetType: 'worksheet',
                templateParameters: bound.args.template_parameters,
                fieldMapping: bound.args.field_mapping,
                templateSlots: selectedTemplate.snapshot.descriptor.slots,
                applyNonce,
                optionalFieldPrunes: bound.args.optional_field_prunes,
              });
            } catch (err) {
              return refusal(
                outcomes,
                `Inject failed for ask index ${i} ("${resolvedTitle}"): ${getExceptionMessage(err)}. ` +
                  'Nothing was applied to the live workbook.',
                `inject failed: ${getExceptionMessage(err)}`,
              );
            }
            if (!injected.ok) {
              return refusal(
                outcomes,
                `Inject failed for ask index ${i} ("${resolvedTitle}"): ${injected.issues.join('; ')}. ` +
                  'Nothing was applied to the live workbook.',
                `inject failed: ${injected.issues.join('; ')}`,
              );
            }
            currentXml = injected.xml;
            sheets.push({ title: resolvedTitle, template_name: bound.args.template_name });
          }

          // ── Dashboard node injection with zones already populated (primary mode) or
          // a minimal layout-basic placeholder (fallback mode) — the "one live unknown"
          // the probe decided (§2). Either way ONE wrapper inject + ONE viewpoints call.
          const zones = zonesViaWorkbook
            ? computeZones(titleText, {
                kpis: [],
                charts: resolvedTitles,
                layoutType: layout?.layoutType ?? 'auto-grid',
                gridColumns: layout?.gridColumns,
              })
            : [];
          const dashboardXml = buildDashboardXml(dashboardName, zones);
          const wrapperXml = `<workbook><dashboards>${dashboardXml}</dashboards><windows><window class="dashboard" name="${escapeXml(dashboardName)}"/></windows></workbook>`;
          try {
            currentXml = injectTemplate(currentXml, wrapperXml, 'dashboard');
          } catch (err) {
            return refusal(
              outcomes,
              `Dashboard injection failed: ${getExceptionMessage(err)}. Nothing was applied.`,
              `dashboard inject failed: ${getExceptionMessage(err)}`,
            );
          }
          currentXml = injectViewpoints(currentXml, dashboardName, resolvedTitles);
          const injectMs = Date.now() - injectStart;

          // ── ONE content-creation dispatch (primary mode), with the same
          // runValidation workbook preflight guarantee every apply path has.
          const applyStart = Date.now();
          // Primary mode posts the sheets AND the finished dashboard here, so this write is
          // usually the last one in the call; the fallback zones apply below names the same
          // dashboard.
          const applyResult = await loadWorkbookXml({
            xml: currentXml,
            baselineXml: pristineXml,
            expectedWorkbookXml: pristineXml,
            focus: { navigate: 'artifact', sheetName: dashboardName },
            executor,
            signal: extra.signal,
          });
          if (applyResult.isErr()) {
            if (
              applyResult.error.type === 'load-workbook-xml-error' &&
              applyResult.error.error.type === 'workbook-drift'
            ) {
              const applyError = describeApplyError(applyResult.error);
              return new IncompleteOperationError({
                applied: false,
                retrySafe: true,
                results: outcomes,
                apply_error: applyError,
                guidance:
                  'The live workbook changed before dispatch, so nothing was applied. Re-read the workbook and retry dashboard-auto-apply.',
              }).toErr();
            }
            const postDispatchError =
              applyResult.error.type === 'execute-command-error' ||
              (applyResult.error.type === 'load-workbook-xml-error' &&
                applyResult.error.error.type === 'load-rejected');
            if (postDispatchError) {
              const verification = await verifyDashboardReadback(resolvedTitles);
              const applyError = describeApplyError(applyResult.error);
              return new IncompleteOperationError(
                withNextAction(
                  {
                    applied: 'unknown',
                    retrySafe: false,
                    dashboard: dashboardName,
                    sheets,
                    results: outcomes,
                    apply_error: applyError,
                    verification,
                    guidance:
                      `The workbook apply command failed after dispatch (${applyError}), so its outcome is ` +
                      'unknown and it may have reached Desktop. Do not retry blindly. Inspect the live workbook ' +
                      'with list-dashboards and get-workbook-inventory, then use activate-sheet on the target ' +
                      'before deciding whether repair is needed.',
                    ...(replaced.dashboard || replaced.sheets.length > 0 ? { replaced } : {}),
                  },
                  prefillNextAction('Inspect the live workbook before any retry'),
                ),
              ).toErr();
            }
            return refusal(
              outcomes,
              `Server-side auto-apply did not complete (${describeApplyError(applyResult.error)}). Nothing ` +
                'was applied — fall back to the per-viz list-templates, build-worksheets-from-templates, ' +
                "and apply-worksheet flow using each ask's fields.",
              describeApplyError(applyResult.error),
              prefillNextAction('Fall back to per-viz auto-apply'),
            );
          }
          if (!zonesViaWorkbook) {
            // Fallback mode (§2 "Probe fails"): the workbook (worksheets + minimal empty
            // dashboard) is already live; a second dispatch lays in the real zones. A
            // failure here is a REAL partial window (Q3) — the dashboard exists with a
            // valid empty layout and can be replaced by retrying this atomic tool.
            const realZones = computeZones(titleText, {
              kpis: [],
              charts: resolvedTitles,
              layoutType: layout?.layoutType ?? 'auto-grid',
              gridColumns: layout?.gridColumns,
            });
            const zonesXml = buildDashboardXml(dashboardName, realZones);
            const dashboardApply = await loadDashboardXml({
              dashboardName,
              xml: zonesXml,
              focus: { navigate: 'artifact', sheetName: dashboardName },
              executor,
              signal: extra.signal,
            });
            if (dashboardApply.isErr()) {
              const err = dashboardApply.error;
              const message =
                err.type === 'load-dashboard-xml-error'
                  ? JSON.stringify(err.error)
                  : `workbook load command failed: ${JSON.stringify(err.error)}`;
              const zonesState =
                err.type === 'execute-command-error'
                  ? { state: 'unknown' as const, attempted: realZones }
                  : {
                      state: 'failed' as const,
                      attempted: realZones,
                      landed: [],
                      failed: realZones,
                    };
              const verification = await verifyDashboardReadback(resolvedTitles);
              return new IncompleteOperationError(
                withNextAction(
                  {
                    applied: 'partial',
                    retrySafe: false,
                    dashboard: dashboardName,
                    sheets,
                    zones: zonesState,
                    apply_error: message,
                    verification,
                    guidance:
                      `The workbook (sheets + an empty "${dashboardName}" dashboard) was applied, but laying ` +
                      `in the zones failed (${message}). Do not retry blindly. Inspect the live workbook with ` +
                      'list-dashboards and get-workbook-inventory, then use activate-sheet on the target before ' +
                      'deciding whether to rebuild it.',
                    ...(replaced.dashboard || replaced.sheets.length > 0 ? { replaced } : {}),
                  },
                  prefillNextAction('Inspect the dashboard before any retry'),
                ),
              ).toErr();
            }
          }

          const applyMs = Date.now() - applyStart;

          const verification = await verifyDashboardReadback(resolvedTitles);
          if (verification.state !== 'verified') {
            return new IncompleteOperationError(
              withNextAction(
                {
                  applied: 'unknown',
                  retrySafe: false,
                  dashboard: dashboardName,
                  sheets,
                  results: outcomes,
                  apply_error: 'structural verification after apply did not pass',
                  verification,
                  guidance:
                    `Desktop reported the "${dashboardName}" apply complete, but the target dashboard did not ` +
                    'pass structural readback. Do not retry blindly. Inspect with list-dashboards and ' +
                    'get-workbook-inventory, then use activate-sheet on the target before repairing the workbook.',
                  ...(replaced.dashboard || replaced.sheets.length > 0 ? { replaced } : {}),
                },
                prefillNextAction('Inspect the dashboard structure'),
              ),
            ).toErr();
          }

          return new Ok({
            applied: true,
            retrySafe: false,
            dashboard: dashboardName,
            sheets,
            verification,
            phase_ms: { read: readMs, bind: bindMs, inject: injectMs, apply: applyMs },
            guidance: `Applied "${dashboardName}" (${sheets.length} sheet(s)) to the live workbook (read ${readMs}ms, bind ${bindMs}ms, inject ${injectMs}ms, apply ${applyMs}ms).`,
            ...(replaced.dashboard || replaced.sheets.length > 0 ? { replaced } : {}),
          });
        },
        getSuccessResult: (result) => jsonToolResult(result, { isError: false }),
      });
    },
  });

  return dashboardAutoApplyTool;
};
