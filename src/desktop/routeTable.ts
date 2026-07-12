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
    text: 'You are controlling Tableau Desktop.',
  },
  {
    kind: 'route',
    id: 'plain-chart',
    trigger:
      'a plain chart ask (bar, column, line, treemap, waterfall, scatter, filled map, KPI, funnel, box plot)',
    action:
      "FIRST call bind-template with the user's ask and auto_apply: true — a confident bind renders the chart in ONE call (~2s server-side, no further tool calls). On propose/escalate, fall back to the general authoring tools (get-workbook-xml -> edit -> apply-workbook, or inject-template for a known template).",
    toolSequence: ['bind-template', 'get-workbook-xml', 'apply-workbook', 'inject-template'],
    stopConditions: [
      'a confident bind renders the chart in ONE call (~2s server-side, no further tool calls)',
      'On propose/escalate, fall back to the general authoring tools',
    ],
    requiredEvidence: [
      "bind-template success: { status: 'bound', applied: true, sheet_name, phase_ms }",
    ],
  },
  {
    kind: 'route',
    id: 'dashboard',
    trigger:
      'a dashboard ask with 2-6 charts (e.g. "a dashboard with sales by region and profit by category")',
    action:
      "FIRST call dashboard-auto-apply with one { ask, title? } per chart and a dashboardName — it binds and composes every chart into one dashboard in ONE call. If any ask fails to deterministically bind, nothing is applied and each ask's outcome is returned; fall back to bind-template per chart, or build-and-apply-dashboard for KPI strips / custom zone layouts.",
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
      'do NOT answer with a number — this server cannot read data values. Say so, then offer the chart that would show it (a plain chart ask via bind-template) instead.',
    toolSequence: ['bind-template'],
    stopConditions: ['do NOT answer with a number — this server cannot read data values'],
    requiredEvidence: [],
  },
  {
    kind: 'prose',
    id: SESSION_RESOLUTION_ID,
    text: 'Every session-scoped tool call needs the session id from list-instances — except bind-template and dashboard-auto-apply, which auto-resolve the session when exactly one Desktop instance is running.',
  },
  {
    kind: 'prose',
    id: 'preflight-rejection',
    text: 'If an apply is rejected by preflight validation, fix the XML per the FIX lines in the error and re-apply. Prefer file mode for large workbooks.',
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
