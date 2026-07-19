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
      "FIRST try the semantic loop: call execute-tableau-command with tabdoc:generate-viz-from-notional-spec and a NotionalSpec of the ask (see the notional-spec-authoring knowledge) — it renders the viz in one sub-second command, and a refinement is the same call with the full edited spec on the same sheet. For families outside the NotionalSpec vocabulary (waterfall, KPI, funnel) or when the ask needs candidate proposals, call bind-template with the user's ask and auto_apply: true; on propose/escalate, fall back to the general authoring tools (get-workbook-xml -> edit -> apply-workbook, or inject-template for a known template).",
    toolSequence: [
      'execute-tableau-command',
      'bind-template',
      'get-workbook-xml',
      'apply-workbook',
      'inject-template',
    ],
    stopConditions: [
      'it renders the viz in one sub-second command',
      'on propose/escalate, fall back to the general authoring tools',
    ],
    requiredEvidence: ["execute-tableau-command success envelope: { state: 'SUCCEEDED' }"],
  },
  {
    kind: 'route',
    id: 'dashboard',
    trigger:
      'a dashboard ask with 2-6 vizzes (e.g. "a dashboard with sales by region and profit by category")',
    action:
      "FIRST call dashboard-auto-apply with one { ask, title? } per viz and a dashboardName — it binds and composes every viz into one dashboard in ONE call. If any ask fails to deterministically bind, nothing is applied and each ask's outcome is returned; fall back to bind-template per viz, or build-and-apply-dashboard for KPI strips / custom zone layouts.",
    toolSequence: ['dashboard-auto-apply', 'bind-template', 'build-and-apply-dashboard'],
    stopConditions: [
      "If any ask fails to deterministically bind, nothing is applied and each ask's outcome is returned",
    ],
    requiredEvidence: [
      'dashboard-auto-apply success: { applied: true, dashboard, sheets: [{ title, template_name }], phase_ms }',
    ],
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
      'a DYNAMIC ask — a parameter the user drives (pick N, pick a period), computed top/bottom-N membership, click-to-change interaction, or mark labels',
    action:
      "use the author-* verbs, never raw commands or hand-written XML. Author parameters FIRST via author-parameter (it reopens Desktop and re-pins the session itself — when it returns { reopened: true } continue immediately; stagePath is optional). Then author-set for param-linked top/bottom-N membership (count accepts '[Parameters].[Parameter N]' — that binding is what makes it dynamic), author-calc for calculated fields, author-action for click-to-parameter wiring, format-labels for mark labels. Build the sheets and dashboard around them with the notional-spec loop (execute-tableau-command).",
    toolSequence: [
      'author-parameter',
      'author-set',
      'author-calc',
      'author-action',
      'format-labels',
      'execute-tableau-command',
    ],
    stopConditions: ['when it returns { reopened: true } continue immediately'],
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
      'edit in place: resolve the target (exact name, else list-worksheets; ask via ask-user if ambiguous), then refine-worksheet for top-N/sort edits, else get-worksheet-xml -> edit -> apply-worksheet. Never create a new sheet unless explicitly asked.',
    toolSequence: [
      'list-worksheets',
      'ask-user',
      'refine-worksheet',
      'get-worksheet-xml',
      'apply-worksheet',
    ],
    stopConditions: ['Never create a new sheet unless explicitly asked'],
    requiredEvidence: ['resolved worksheet/dashboard target before applying'],
  },
  {
    kind: 'prose',
    id: SESSION_RESOLUTION_ID,
    text: 'Every session-scoped tool call needs the session id from list-instances — except bind-template and dashboard-auto-apply, which auto-resolve the session when exactly one Desktop instance is running.',
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
