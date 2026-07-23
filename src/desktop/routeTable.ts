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
      'on a populated worksheet, call get-summary-data; answer only from returned rows. A terminal/no-data result means stop; one retry on transient failure is allowed, then report the outcome.',
    toolSequence: ['get-summary-data'],
    stopConditions: ['A terminal/no-data result means stop'],
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
    text: 'Command census: activate-sheet switches sheets; author-* tools author semantics; refine-worksheet edits top-N/sort. Use search-commands ONLY for unlisted commands.',
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
