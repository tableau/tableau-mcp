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

// The session-resolution prose points the agent at list-instances. When the launching
// Desktop pins a session, that tool is unregistered, so this entry is dropped from the
// instructions to avoid naming a tool the client cannot call.
export const SESSION_RESOLUTION_ID = 'session-resolution';

export const DESKTOP_ROUTE_TABLE: readonly DesktopInstructionEntry[] = [
  {
    kind: 'prose',
    id: 'preamble',
    text: 'You control Tableau Desktop. Use Tableau terms: workbook/viz/sheet/field, Columns/Rows.',
  },
  {
    kind: 'prose',
    id: 'authoring-skill',
    text: 'Load tableau-desktop-authoring; repeat failures -> tableau-agent-debug.',
  },
  {
    kind: 'prose',
    id: 'plan-before-build',
    text: 'Before dashboards, plan MAGNITUDE vs MEMBERSHIP; MEMBERSHIP uses buckets, not gradients. State plan, build.',
  },
  {
    kind: 'route',
    id: 'knowledge-consult',
    trigger:
      'an unfamiliar or non-trivial authoring ask (calc-heavy, uncertain which chart fits, formatting/design) — never a plain chart ask the plain-chart route already handles',
    action:
      'FIRST search-knowledge; use read-knowledge-resource to read the top hit once, then proceed.',
    toolSequence: ['search-knowledge', 'read-knowledge-resource'],
    stopConditions: ['read the top hit once, then proceed'],
    requiredEvidence: ['one targeted knowledge module or no search hit'],
  },
  {
    kind: 'route',
    id: 'plain-chart',
    trigger: 'a plain viz ask (bar/line/map/KPI/etc.)',
    action:
      'FIRST bind-template(auto_apply:true): deterministic, ~0.3s. On propose, resubmit; proposals may carry sort and top_n. author-parameter/author-set/author-action before charts; else search-commands.',
    toolSequence: [
      'bind-template',
      'author-parameter',
      'author-set',
      'author-action',
      'search-commands',
    ],
    stopConditions: ['deterministic, ~0.3s'],
    requiredEvidence: ['bind-template applied result (auto-apply receipt)'],
  },
  {
    kind: 'route',
    id: 'dashboard',
    trigger: 'a dashboard ask with 2-6 vizzes',
    action:
      'build sheets with bind-template (author calcs/params/sets first), then compose with dashboard-auto-apply (2-6 plain charts, one call) or plan-dashboard-creation -> build-and-apply-dashboard; search-commands only for commands the census does not list.',
    toolSequence: [
      'bind-template',
      'dashboard-auto-apply',
      'plan-dashboard-creation',
      'build-and-apply-dashboard',
      'search-commands',
    ],
    stopConditions: ['search-commands only for commands the census does not list'],
    requiredEvidence: ['each sheet build returns a success envelope before dashboard composition'],
  },
  {
    kind: 'route',
    id: 'data-value-question',
    trigger: 'a data-value question',
    action:
      'FIRST get-summary-data; answer only from returned rows. If none, say so and offer a viz.',
    toolSequence: ['get-summary-data'],
    stopConditions: ['answer only from returned rows'],
    requiredEvidence: ['get-summary-data returned rows or a no-suitable-worksheet explanation'],
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
    text: 'If ambiguity changes workbook content, call ask-user with urgency=blocking; stop.',
  },
  {
    kind: 'route',
    id: 'edit-in-place',
    trigger: 'current/existing sheet/chart/view/dashboard',
    action:
      'edit in place: resolve target (exact name else list-worksheets/list-dashboards; ask-user if ambiguous), then refine-worksheet for top-N/sort or author-* tool; a NEW chart on the current sheet = bind-template with target_worksheet. Never create new sheets unless asked.',
    toolSequence: [
      'list-worksheets',
      'list-dashboards',
      'ask-user',
      'refine-worksheet',
      'bind-template',
    ],
    stopConditions: ['Never create new sheets unless asked'],
    requiredEvidence: ['resolved worksheet/dashboard target before applying'],
  },
  {
    kind: 'prose',
    id: 'command-census',
    text: 'Command census: tabdoc:goto-sheet switches sheets; author-* tools author semantics; refine-worksheet edits top-N/sort. Use search-commands ONLY for unlisted commands.',
  },
  {
    kind: 'prose',
    id: SESSION_RESOLUTION_ID,
    text: 'Omit session for one Desktop; use list-instances when multiple are open.',
  },
  {
    kind: 'prose',
    id: 'preflight-rejection',
    text: 'If preflight rejects apply, fix per FIX lines. Prefer file mode',
  },
];

export function renderInstructionEntry(entry: DesktopInstructionEntry): string {
  return entry.kind === 'prose' ? entry.text : `For ${entry.trigger}, ${entry.action}`;
}

export function generateDesktopInstructions(table: readonly DesktopInstructionEntry[]): string {
  return table.map(renderInstructionEntry).join('\n\n');
}

/**
 * Instructions for a given session-pinning state. When a session is pinned the
 * agent never calls list-instances, so the session-resolution guidance is dropped.
 */
export function buildDesktopInstructions({ sessionPinned }: { sessionPinned: boolean }): string {
  const table = sessionPinned
    ? DESKTOP_ROUTE_TABLE.filter((entry) => entry.id !== SESSION_RESOLUTION_ID)
    : DESKTOP_ROUTE_TABLE;
  return generateDesktopInstructions(table);
}
