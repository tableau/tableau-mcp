import { DesktopToolName } from '../tools/desktop/toolName.js';

// WHY: product routing used to live as free prose in DESKTOP_INSTRUCTIONS and drifted
// silently (the A1 dashboard-row incident); routes are data here so tests can pin each
// route's tool sequence and stop conditions and any edit shows up as a reviewable diff.
export type DesktopInstructionRoute = {
  readonly kind: 'route';
  readonly id: string;
  readonly trigger: string;
  readonly action: string;
  readonly toolSequence: readonly DesktopToolName[];
  readonly stopConditions: readonly string[];
  readonly requiredEvidence: readonly string[];
  readonly forbiddenTools?: readonly DesktopToolName[];
};

export type DesktopInstructionProse = {
  readonly kind: 'prose';
  readonly id: string;
  readonly text: string;
};

export type DesktopInstructionEntry = DesktopInstructionRoute | DesktopInstructionProse;

// The session-resolution prose points the agent at list-instances. The pin is a default,
// not an invariant, so the pinned variant still names list-instances (the tool stays
// registered) and tells the agent it may target another open Desktop.
export const SESSION_RESOLUTION_ID = 'session-resolution';

export const SESSION_RESOLUTION_TEXT_UNPINNED =
  'Omit session for one Desktop; use list-instances when multiple are open.';

export const SESSION_RESOLUTION_TEXT_PINNED =
  'Session defaults to the current Tableau Desktop; use list-instances to see all open Desktops and pass session to target another.';

export const DESKTOP_ROUTE_TABLE: readonly DesktopInstructionEntry[] = [
  {
    kind: 'prose',
    id: 'preamble',
    text: 'You control Tableau Desktop. Use Tableau terms: workbook/viz/sheet/field, Columns/Rows.',
  },
  {
    kind: 'prose',
    id: 'plan-before-build',
    text: 'Before dashboards, plan MAGNITUDE vs MEMBERSHIP; MEMBERSHIP uses buckets, not gradients. State plan, build.',
  },
  {
    kind: 'route',
    id: 'plain-chart',
    trigger:
      'a single-view visualization request with enough analytic intent or field cues to recognize, including explicit chart names and common semantic asks',
    action:
      "route precedence: Preview/no-change or open multi-chart asks skip bind-template and use the artifact flow. An explicitly named existing blank worksheet is a chart-creation target, not an edit: call bind-template with target_worksheet set to that sheet. Existing-sheet edits on populated worksheets stay on the edit-in-place route. Unnamed derived metrics stay on the derived-metric route. Otherwise call bind-template with the user's exact ask and auto_apply:true first; an explicit chart name may bind immediately, while a semantic ask may return one bounded proposal. If call 1 proposes, make one second bind-template call with one exact call_2_contract proposal. Terminal only with applied:true plus clean host verification, or a verified fallback apply receipt (passed or warnings); Never rephrase or resubmit the bare ask. If that second call still proposes, or any result escalates or blocks, use the guarded artifact fallback: list-templates -> list-available-fields -> build-worksheets-from-templates -> apply-worksheet. Put named channels in requiredChannels. Preview artifacts stop before apply-worksheet; artifacts coexist. Open intent builds several distinct worksheets. Apply exact templatePlan sequentially; never replay uncertain apply.",
    toolSequence: [
      'bind-template',
      'list-templates',
      'list-available-fields',
      'build-worksheets-from-templates',
      'apply-worksheet',
    ],
    stopConditions: [
      'Terminal only with applied:true plus clean host verification, or a verified fallback apply receipt (passed or warnings)',
      'Never rephrase or resubmit the bare ask',
      'stop before apply-worksheet',
      'Apply exact templatePlan sequentially',
      'never replay uncertain apply',
    ],
    requiredEvidence: ['each applied worksheet returns a success receipt'],
  },
  {
    kind: 'route',
    id: 'derived-metric',
    trigger:
      'a clear derived-metric ask with no named chart type (margin %, ratio/rate/per, growth/change %)',
    action:
      'author the conventional calculation with author-calc, then use list-templates -> list-available-fields -> build-worksheets-from-templates -> apply-worksheet.',
    toolSequence: [
      'author-calc',
      'list-templates',
      'list-available-fields',
      'build-worksheets-from-templates',
      'apply-worksheet',
    ],
    stopConditions: ['author the conventional calculation with author-calc'],
    requiredEvidence: ['calculation readback and worksheet apply receipt'],
  },
  {
    kind: 'route',
    id: 'knowledge-consult',
    trigger:
      'an unfamiliar or non-trivial authoring ask (calc-heavy, uncertain which chart fits, formatting/design)',
    action:
      'FIRST search-knowledge; use read-knowledge-resource to read the top hit once, then proceed.',
    toolSequence: ['search-knowledge', 'read-knowledge-resource'],
    stopConditions: ['read the top hit once, then proceed'],
    requiredEvidence: ['one targeted knowledge module or no search hit'],
  },
  {
    kind: 'route',
    id: 'dashboard',
    trigger: 'a dashboard ask',
    action:
      'For a dashboard, use the normal bind-template proposal protocol with auto_apply:true on every call; finish one applied sheet per analytical view. For an overview, executive, leadership, performance, or summary dashboard, or one with explicit KPIs, also finish one applied kpi-text sheet per KPI metric, at most three KPIs by default, in user order; otherwise Sales, Profit, then Quantity/Orders. Give every KPI worksheet and display title a metric name such as Total Sales; never pass a generic starter name such as Sheet 1 or this-one. Pass only live non-KPI chart names in existingWorksheetNames and ordered live KPI names in kpiWorksheetNames to run-dashboard-batch with layoutType executive-summary. For a plain four-view dashboard without KPIs, pass its live chart names with layoutType auto-grid and gridColumns 2. Omit artifactIds unless using the separate guarded artifact fallback; use rows or columns only when explicitly asked. For an executive first draft, limit a top/best products view to the Top 10 before composition unless the user gives another N: pass top_n:10 to bind-template or topN:10 in the guarded artifact fallback. Keep the computed descending sort authored by the template/refinement; never add a native sort call. On a retry-safe name preflight, correct it once and retry with the same layout; never downgrade executive-summary. Never replay a partial or unknown batch; inspect live workbook state first.',
    toolSequence: ['bind-template', 'run-dashboard-batch'],
    forbiddenTools: ['sort-worksheet'],
    stopConditions: [
      'use the normal bind-template proposal protocol with auto_apply:true on every call',
      'finish one applied sheet per analytical view',
      'finish one applied kpi-text sheet per KPI metric',
      'never downgrade executive-summary',
      'Never replay a partial or unknown batch',
      'inspect live workbook state first',
    ],
    requiredEvidence: [
      'one applied worksheet receipt per requested KPI metric and analytical view',
      'one batch receipt with the requested layout',
    ],
  },
  {
    kind: 'route',
    id: 'dashboard-edit-fallback',
    trigger: 'an existing dashboard edit the bounded batch cannot express',
    action:
      'use get-dashboard-xml -> read-cached-xml -> write-cached-xml -> apply-dashboard; stay on the scoped dashboard path.',
    toolSequence: ['get-dashboard-xml', 'read-cached-xml', 'write-cached-xml', 'apply-dashboard'],
    stopConditions: ['stay on the scoped dashboard path'],
    requiredEvidence: ['dashboard apply receipt'],
  },
  {
    kind: 'route',
    id: 'story-edit-fallback',
    trigger: 'an existing story edit',
    action:
      'use get-storyboard-xml -> read-cached-xml -> write-cached-xml -> apply-storyboard; stay on the scoped story path.',
    toolSequence: ['get-storyboard-xml', 'read-cached-xml', 'write-cached-xml', 'apply-storyboard'],
    stopConditions: ['stay on the scoped story path'],
    requiredEvidence: ['story apply receipt'],
  },
  {
    kind: 'route',
    id: 'whole-workbook-fallback',
    trigger: 'a datasource-definition or cross-artifact change no scoped apply can express',
    action:
      'use get-workbook-xml -> read-cached-xml -> write-cached-xml -> apply-workbook; use only for datasource definitions or cross-artifact changes, and prefer a scoped apply whenever possible.',
    toolSequence: ['get-workbook-xml', 'read-cached-xml', 'write-cached-xml', 'apply-workbook'],
    stopConditions: [
      'use only for datasource definitions or cross-artifact changes',
      'prefer a scoped apply whenever possible',
    ],
    requiredEvidence: ['workbook apply receipt'],
  },
  {
    kind: 'route',
    id: 'data-value-question',
    trigger: 'a data-value question',
    action: 'on a populated worksheet, call get-summary-data; answer only from returned rows.',
    toolSequence: ['get-summary-data'],
    stopConditions: ['answer only from returned rows'],
    requiredEvidence: ['get-summary-data returned rows'],
  },
  {
    kind: 'route',
    id: 'dynamic-authoring',
    trigger:
      'a dynamic ask or a calc/derived field the data lacks WITHOUT a conventional name (examples include running total and LOD)',
    action:
      'use author-parameter first, then author-set, author-calc, author-action, and format-labels as needed; then list-templates -> list-available-fields -> build-worksheets-from-templates -> apply-worksheet.',
    toolSequence: [
      'author-parameter',
      'author-set',
      'author-calc',
      'author-action',
      'format-labels',
      'list-templates',
      'list-available-fields',
      'build-worksheets-from-templates',
      'apply-worksheet',
    ],
    stopConditions: ['use author-parameter first'],
    requiredEvidence: ["each author-* verb's readback-verified result object"],
  },
  {
    kind: 'prose',
    id: 'ask-user-ambiguity',
    text: 'If ambiguity changes workbook content, call ask-user with urgency=blocking; stop.',
  },
  {
    kind: 'route',
    id: 'edit-in-place',
    trigger: 'an edit to a populated current/existing sheet/chart/view',
    action:
      'use existing-sheet tools only: resolve target with list-worksheets -> list-dashboards -> ask-user when ambiguous, then use refine-worksheet or add-field -> apply-worksheet for color, size, detail, Rows, or Columns. Never create new sheets unless asked.',
    toolSequence: [
      'list-worksheets',
      'list-dashboards',
      'ask-user',
      'refine-worksheet',
      'add-field',
      'apply-worksheet',
    ],
    stopConditions: ['Never create new sheets unless asked'],
    requiredEvidence: ['resolved worksheet/dashboard target before applying'],
  },
  {
    kind: 'prose',
    id: 'command-census',
    text: 'Command census: activate-sheet switches sheets; author-* tools author semantics; refine-worksheet edits top-N/sort; add-field + apply-worksheet change encodings. Use search-commands ONLY for unlisted commands.',
  },
  {
    kind: 'prose',
    id: SESSION_RESOLUTION_ID,
    text: SESSION_RESOLUTION_TEXT_UNPINNED,
  },
  {
    kind: 'prose',
    id: 'preflight-rejection',
    text: 'If preflight rejects apply, fix per FIX lines. Prefer file mode',
  },
  {
    kind: 'prose',
    id: 'no-native-tool-escape',
    text: 'If no native or sanctioned cached-file route covers the ask, say so plainly; never invent an unsupported path.',
  },
];

export function renderInstructionEntry(entry: DesktopInstructionEntry): string {
  return entry.kind === 'prose' ? entry.text : `For ${entry.trigger}, ${entry.action}`;
}

export function generateDesktopInstructions(table: readonly DesktopInstructionEntry[]): string {
  return table.map(renderInstructionEntry).join('\n\n');
}

const DEMO_PROFILE_INSTRUCTIONS = [
  'You control Tableau Desktop. Use Tableau terms: workbook/viz/sheet/field, Columns/Rows.',
  "For a chart request, use bind-template with the user's ask. Use the returned fallback tools when it cannot apply.",
  'For a dashboard, use bind-template to place views, then call run-dashboard-batch compose-only with existingWorksheetNames set to the live worksheet names.',
] as const;

const SPEC_LOOP_PROFILE_INSTRUCTIONS = [
  'You control Tableau Desktop. Use Tableau terms: workbook/viz/sheet/field, Columns/Rows.',
  'Use execute-tableau-command for supported authoring operations and the list tools for discovery and readback.',
] as const;

/**
 * Instructions for a given session-pinning state. When pinned, the session-resolution
 * prose switches to the pinned variant (pin is the default; the agent can still target
 * another open Desktop via list-instances) rather than being dropped.
 */
export function buildDesktopInstructions({
  sessionPinned,
  profile = '',
}: {
  sessionPinned: boolean;
  profile?: string;
}): string {
  const normalizedProfile = profile.trim().toLowerCase();
  if (normalizedProfile === 'demo') {
    return [
      ...DEMO_PROFILE_INSTRUCTIONS,
      sessionPinned ? SESSION_RESOLUTION_TEXT_PINNED : SESSION_RESOLUTION_TEXT_UNPINNED,
    ].join('\n\n');
  }
  if (normalizedProfile === 'spec-loop') {
    return [
      ...SPEC_LOOP_PROFILE_INSTRUCTIONS,
      sessionPinned ? SESSION_RESOLUTION_TEXT_PINNED : SESSION_RESOLUTION_TEXT_UNPINNED,
    ].join('\n\n');
  }

  const table = sessionPinned
    ? DESKTOP_ROUTE_TABLE.map((entry) =>
        entry.id === SESSION_RESOLUTION_ID
          ? { ...entry, text: SESSION_RESOLUTION_TEXT_PINNED }
          : entry,
      )
    : DESKTOP_ROUTE_TABLE;
  return generateDesktopInstructions(table);
}
