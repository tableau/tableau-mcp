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
    text: 'You are controlling Tableau Desktop. Use Tableau vocabulary in your narration: say workbook, viz, sheet, or field rather than implementation formats; shelf names are Columns and Rows. Use product data type names like Number (whole), Number (decimal), Text, and True/False.',
  },
  {
    kind: 'prose',
    id: 'authoring-skill',
    text: 'Load tableau-desktop-authoring before builds/edits; if unresolved failures repeat, switch to tableau-agent-debug, not manual XML.',
  },
  {
    kind: 'prose',
    id: 'plan-before-build',
    text: 'Before multi-viz/dashboard builds, plan: classify requirements as MAGNITUDE=continuous quantity or MEMBERSHIP=discrete group; encode MEMBERSHIP with discrete buckets, never raw-measure color gradients. State the one-line plan, then build.',
  },
  {
    kind: 'route',
    id: 'plain-chart',
    trigger:
      'a plain viz ask (bar, column, line, treemap, waterfall, scatter, filled map, KPI, funnel, box plot)',
    action:
      "FIRST call bind-template with the user's ask and auto_apply: true — deterministic, ~0.3s, no model work. On propose, fill and resubmit the proposal (a validated bound proposal auto-applies). Calcs go inline via calcs[] (one call authors + binds); author-parameter, author-set, author-action author-first. If it escalates, use search-commands.",
    toolSequence: [
      'bind-template',
      'author-parameter',
      'author-set',
      'author-action',
      'search-commands',
    ],
    stopConditions: ['deterministic, ~0.3s, no model work'],
    requiredEvidence: ['bind-template applied result (auto-apply receipt)'],
  },
  {
    kind: 'route',
    id: 'dashboard',
    trigger:
      'a dashboard ask with 2-6 vizzes (e.g. "a dashboard with sales by region and profit by category")',
    action:
      'build each sheet with bind-template (author calcs, parameters, and sets first with the author-* verbs when the sheet needs them), then compose the dashboard — search-commands only for commands the census does not list.',
    toolSequence: ['bind-template', 'search-commands'],
    stopConditions: ['search-commands only for commands the census does not list'],
    requiredEvidence: ['each sheet build returns a success envelope before dashboard composition'],
  },
  {
    kind: 'route',
    id: 'data-value-question',
    trigger: 'a data-value question ("what was revenue in Q3?")',
    action:
      'do NOT answer with a number — this server cannot read data values. Say so, then offer the viz that would show it (a plain viz ask via bind-template) instead.',
    toolSequence: ['bind-template'],
    stopConditions: ['do NOT answer with a number — this server cannot read data values'],
    requiredEvidence: [],
  },
  {
    kind: 'route',
    id: 'dynamic-authoring',
    trigger:
      'a DYNAMIC ask — a parameter the user drives, computed top/bottom-N membership, click-to-change interaction, or mark labels',
    action:
      "use the author-* verbs, never raw commands or XML. Author parameters FIRST via author-parameter (it reopens Desktop and re-pins the session itself; on { reopened: true } continue immediately; stagePath optional). Then author-set for param-linked top/bottom-N membership (count accepts '[Parameters].[Parameter N]'), author-calc for calcs, author-action for click-to-param wiring, format-labels for labels. Build the charts around them with bind-template asks naming the authored captions.",
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
    text: 'If ambiguity changes workbook content, call ask-user with urgency=blocking; stop for answer.',
  },
  {
    kind: 'route',
    id: 'edit-in-place',
    trigger: 'current/this/that/existing sheet, chart, view, or dashboard',
    action:
      'edit in place: resolve the target (exact name, else list-worksheets or list-dashboards; ask via ask-user if ambiguous), then refine-worksheet for top-N/sort edits or the relevant author-* tool. Never create a new sheet unless explicitly asked.',
    toolSequence: ['list-worksheets', 'list-dashboards', 'ask-user', 'refine-worksheet'],
    stopConditions: ['Never create a new sheet unless explicitly asked'],
    requiredEvidence: ['resolved worksheet/dashboard target before applying'],
  },
  {
    kind: 'prose',
    id: 'command-census',
    text: 'Command census: tabdoc:goto-sheet switches sheets; tabui:save-underlying-metadata returns workbook metadata/fields; author-calc, author-set, author-parameter, author-action, format-labels author semantic objects; refine-worksheet handles top-N and sort edits on an existing sheet. Use search-commands ONLY for commands not listed here.',
  },
  {
    kind: 'prose',
    id: SESSION_RESOLUTION_ID,
    text: 'Omit session when exactly one Desktop instance runs; use list-instances when multiple are open.',
  },
  {
    kind: 'prose',
    id: 'preflight-rejection',
    text: 'If an apply is rejected by preflight validation, fix the workbook content per the FIX lines in the error and re-apply. Prefer file mode for large workbooks.',
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
