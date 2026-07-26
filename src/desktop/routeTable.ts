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
      'any named chart type or common viz ask, including composed charts (waterfall/bridge, funnel, gantt, bullet, box plot, slope/bump, control, dual-axis, etc.)',
    action:
      'FIRST use bind-template\'s two-call sequence. Call 1: bind-template(auto_apply:true), deterministic, ~0.3s; pass the user\'s message verbatim as `ask` (never paraphrase, reword, or expand it). If it proposes, Call 2: bind-template with the same ask/target, selected proposal, auto_apply:true; proposals may carry sort and top_n. Do not use manual authoring tools between Call 1 and Call 2. Never call list-available-fields or get-worksheet-xml to orient before bind-template: it reads schema; failed binds propose candidate fields (author-parameter/author-set may list fields first). Named charts use this first, even calc-heavy or asking "how <X> changes"; do not author template-owned calcs (including waterfall running totals) before binding. author-parameter/author-set/author-action before charts; else search-commands.',
    toolSequence: [
      'bind-template',
      'list-available-fields',
      'get-worksheet-xml',
      'author-parameter',
      'author-set',
      'author-action',
      'search-commands',
    ],
    stopConditions: [
      'deterministic, ~0.3s',
      'Do not use manual authoring tools between Call 1 and Call 2',
    ],
    requiredEvidence: ['bind-template applied result (auto-apply receipt)'],
  },
  {
    kind: 'route',
    id: 'calc-then-bind',
    trigger:
      'a clear derived-metric ask with no named chart type (margin %, ratio/rate/per, growth/change %)',
    action:
      "pass the calc in bind-template's calcs[] and bind its caption in ONE call (a proposal still resolves via Call 2); search-knowledge first when unsure of the formula.",
    toolSequence: ['bind-template', 'search-knowledge'],
    stopConditions: ['ONE call'],
    requiredEvidence: ['authored_calcs returned by bind-template'],
  },
  {
    kind: 'route',
    id: 'knowledge-consult',
    trigger:
      'an unfamiliar or non-trivial authoring ask (calc-heavy, uncertain which chart fits, formatting/design) only when no plain-chart binding path applies; a named chart type always takes plain-chart first, even with calc/formatting riders; chart-route escalation may still consult',
    action:
      'FIRST search-knowledge; use read-knowledge-resource to read the top hit once, then proceed.',
    toolSequence: ['search-knowledge', 'read-knowledge-resource'],
    stopConditions: ['read the top hit once, then proceed'],
    requiredEvidence: ['one targeted knowledge module or no search hit'],
  },
  {
    kind: 'route',
    id: 'dashboard',
    trigger: 'a dashboard ask with 2-6 vizzes',
    action:
      'build sheets with bind-template (author calcs/params/sets first), then compose with dashboard-auto-apply (2-6 plain charts, one call) or plan-dashboard-creation -> build-and-apply-dashboard.',
    toolSequence: [
      'bind-template',
      'dashboard-auto-apply',
      'plan-dashboard-creation',
      'build-and-apply-dashboard',
    ],
    stopConditions: ['2-6 plain charts, one call'],
    requiredEvidence: ['each sheet build returns a success envelope before dashboard composition'],
  },
  {
    kind: 'route',
    id: 'data-value-question',
    trigger: 'a data-value question',
    action: 'on a populated worksheet, call get-summary-data; answer only from returned rows.',
    toolSequence: ['get-summary-data'],
    stopConditions: ['answer only from returned rows'],
    requiredEvidence: ['get-summary-data returned rows or a discriminated status'],
  },
  {
    kind: 'route',
    id: 'dynamic-authoring',
    trigger: 'a dynamic ask or a calc/derived field the data lacks (ratio, running total, LOD)',
    action:
      'use author-* verbs: author-parameter FIRST (on { reopened: true } continue immediately), then author-set, author-calc, author-action, format-labels. Build with bind-template and authored captions.',
    toolSequence: [
      'author-parameter',
      'author-set',
      'author-calc',
      'author-action',
      'format-labels',
      'bind-template',
    ],
    stopConditions: ['on { reopened: true } continue immediately'],
    requiredEvidence: ["each author-* verb's readback-verified result object"],
  },
  {
    kind: 'prose',
    id: 'ask-user-ambiguity',
    text: 'Call ask-user(urgency=blocking) and stop ONLY when the ambiguity is which target to edit, or no defensible default exists. When a canonical default exists (top = highest primary measure, N=10), build it and state the choice — never a bare question. Cosmetic choices never ask.',
  },
  {
    kind: 'route',
    id: 'edit-in-place',
    trigger: 'current/existing sheet/chart/view/dashboard',
    action:
      'edit in place: resolve target (exact name else list-worksheets/list-dashboards; ask-user if ambiguous), then refine-worksheet for top-N/sort ONLY, add-field + apply-worksheet for a color/size/detail or rows/cols field, or an author-* tool; a NEW chart here = bind-template with target_worksheet. Never create new sheets unless asked.',
    toolSequence: [
      'list-worksheets',
      'list-dashboards',
      'ask-user',
      'refine-worksheet',
      'add-field',
      'apply-worksheet',
      'bind-template',
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
    text: 'If NO native tool covers the asked shape, say so plainly — never invent or hand-author XML. get-worksheet-xml -> add-field -> apply-worksheet is sanctioned. Whole-workbook XML surgery is behind TOOL_PROFILE=full, which the user can enable.',
  },
];

export function renderInstructionEntry(entry: DesktopInstructionEntry): string {
  return entry.kind === 'prose' ? entry.text : `For ${entry.trigger}, ${entry.action}`;
}

export function generateDesktopInstructions(table: readonly DesktopInstructionEntry[]): string {
  return table.map(renderInstructionEntry).join('\n\n');
}

/**
 * Instructions for a given session-pinning state. When pinned, the session-resolution
 * prose switches to the pinned variant (pin is the default; the agent can still target
 * another open Desktop via list-instances) rather than being dropped.
 */
export function buildDesktopInstructions({ sessionPinned }: { sessionPinned: boolean }): string {
  const table = sessionPinned
    ? DESKTOP_ROUTE_TABLE.map((entry) =>
        entry.id === SESSION_RESOLUTION_ID
          ? { ...entry, text: SESSION_RESOLUTION_TEXT_PINNED }
          : entry,
      )
    : DESKTOP_ROUTE_TABLE;
  return generateDesktopInstructions(table);
}
