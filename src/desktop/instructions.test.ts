import { desktopToolNames } from '../tools/desktop/toolName.js';
import {
  buildDesktopInstructions,
  DESKTOP_ROUTE_TABLE,
  DesktopInstructionRoute,
  generateDesktopInstructions,
  renderInstructionEntry,
  SESSION_RESOLUTION_ID,
  SESSION_RESOLUTION_TEXT_PINNED,
  SESSION_RESOLUTION_TEXT_UNPINNED,
} from './instructions.js';

const routes = DESKTOP_ROUTE_TABLE.filter(
  (entry): entry is DesktopInstructionRoute => entry.kind === 'route',
);

// WHY: boundary guards keep 'apply-dashboard' from matching inside 'build-and-apply-dashboard'.
const toolMentionsInFirstMentionOrder = (text: string): string[] =>
  desktopToolNames
    .map((tool) => ({
      tool,
      index: text.search(new RegExp(`(?<![a-z0-9-])${tool}(?![a-z0-9-])`)),
    }))
    .filter(({ index }) => index !== -1)
    .sort((a, b) => a.index - b.index)
    .map(({ tool }) => tool);

describe('DESKTOP_ROUTE_TABLE', () => {
  it('entry ids are unique', () => {
    const ids = DESKTOP_ROUTE_TABLE.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('contains the required desktop routes', () => {
    expect(routes.map((route) => route.id)).toEqual(
      expect.arrayContaining(['plain-chart', 'dashboard', 'data-value-question', 'edit-in-place']),
    );
  });

  it('ships a compact command census for the common semantic path', () => {
    const rendered = generateDesktopInstructions(DESKTOP_ROUTE_TABLE);
    expect(rendered).toContain('Command census:');
    expect(rendered).not.toContain('tabdoc:generate-viz-from-notional-spec');
    expect(rendered).not.toContain('tabdoc:goto-sheet');
    expect(rendered).toContain('activate-sheet');
    expect(rendered).toContain('Use search-commands ONLY for unlisted commands.');
  });

  it('requires explicit requested encodings to participate in template discovery', () => {
    const plainChart = routes.find((route) => route.id === 'plain-chart');

    expect(plainChart?.action).toContain('Put named channels in requiredChannels');
    expect(plainChart?.action).toContain('guarded artifact');
  });

  // Live incident (v11 bundle): asked to move "warmer" onto color, the agent had no route
  // for an encoding edit. refine-worksheet does top-N and sort only, so the edit-in-place
  // route has to name the tool pair that can re-encode a sheet.
  it('names add-field then apply-worksheet as the encoding edit path', () => {
    const editInPlace = routes.find((route) => route.id === 'edit-in-place');

    expect(editInPlace?.action).toContain('add-field');
    expect(editInPlace?.action).toContain('apply-worksheet');
    expect(editInPlace?.action).toContain('color');
    expect(editInPlace?.toolSequence).toEqual([
      'list-worksheets',
      'list-dashboards',
      'ask-user',
      'refine-worksheet',
      'add-field',
      'apply-worksheet',
    ]);
    expect(editInPlace?.action).toContain('existing-sheet tools only');
    expect(editInPlace?.action).not.toContain('requested new chart');
  });

  it('census scopes refine-worksheet to top-N/sort and names the encoding pair', () => {
    const rendered = generateDesktopInstructions(DESKTOP_ROUTE_TABLE);

    expect(rendered).toContain('refine-worksheet edits top-N/sort');
    expect(rendered).toContain('add-field + apply-worksheet change encodings.');
  });

  it('routes unnamed derived metrics through semantic authoring before the modern flow', () => {
    const dynamicAuthoring = routes.find((route) => route.id === 'dynamic-authoring');

    expect(dynamicAuthoring?.trigger).toContain('WITHOUT a conventional name');
    expect(dynamicAuthoring?.action).toContain('author-calc');
    expect(dynamicAuthoring?.action).toContain('build-worksheets-from-templates');
  });

  it('authors a conventional derived metric before the modern flow', () => {
    const derivedMetric = routes.find((route) => route.id === 'derived-metric');

    expect(derivedMetric?.trigger).toContain('no named chart type');
    expect(derivedMetric?.toolSequence).toEqual([
      'author-calc',
      'list-templates',
      'list-available-fields',
      'build-worksheets-from-templates',
      'apply-worksheet',
    ]);
    expect(derivedMetric?.action).not.toContain('bind-template');
  });

  it('is self-contained and does not require skill loading', () => {
    const rendered = generateDesktopInstructions(DESKTOP_ROUTE_TABLE);
    expect(rendered).not.toContain('tableau-desktop-authoring');
    expect(rendered).not.toContain('tableau-agent-debug');
  });

  it('caps targeted knowledge consultation at one read before authoring proceeds', () => {
    const knowledge = routes.find((route) => route.id === 'knowledge-consult');

    expect(knowledge).toMatchObject({
      trigger:
        'an unfamiliar or non-trivial authoring ask (calc-heavy, uncertain which chart fits, formatting/design)',
      toolSequence: ['search-knowledge', 'read-knowledge-resource'],
      stopConditions: ['read the top hit once, then proceed'],
    });
  });

  it('places the deterministic plain-chart route before knowledge consultation', () => {
    const routeIds = routes.map((route) => route.id);

    expect(routeIds.indexOf('plain-chart')).toBeLessThan(routeIds.indexOf('knowledge-consult'));
  });

  it('allows direct and open-intent modern template choices', () => {
    const plainChart = routes.find((route) => route.id === 'plain-chart');
    expect(plainChart?.action).toContain('bind-template');
    expect(plainChart?.action).toContain('auto_apply:true');
    expect(plainChart?.action).toContain('one exact call_2_contract proposal');
    expect(plainChart?.action).toContain(
      'Terminal only with applied:true plus clean host verification, or a verified fallback apply receipt (passed or warnings)',
    );
    expect(plainChart?.action).toContain('Never rephrase or resubmit the bare ask');
    expect(plainChart?.action).toContain(
      'If that second call still proposes, or any result escalates or blocks',
    );
    expect(plainChart?.action).toContain('templatePlan');
    expect(plainChart?.action).toContain('Open intent builds several distinct worksheets.');
    expect(plainChart?.action).toContain('Preview/no-change');
    expect(plainChart?.action).toContain('stop before apply-worksheet');
  });

  it.each([
    ['Compare Sales across Categories', 'plain-chart', 'semantic ask', 'bind-template'],
    ['Show Sales over time', 'plain-chart', 'semantic ask', 'bind-template'],
    ['Show relationship between Sales and Profit', 'plain-chart', 'semantic ask', 'bind-template'],
    ['explicit named single chart', 'plain-chart', 'explicit chart name', 'bind-template'],
    ['preview or no-change chart', 'plain-chart', 'artifact flow', 'skip bind-template'],
    ['open multi-chart request', 'plain-chart', 'artifact flow', 'skip bind-template'],
    [
      'existing-sheet edit',
      'edit-in-place',
      'existing-sheet tools only',
      'Never create new sheets',
    ],
    ['unnamed derived metric', 'derived-metric', 'author-calc', 'no named chart type'],
  ])('route precedence: %s uses %s', (_intent, routeId, requiredAction, requiredBoundary) => {
    const route = routes.find((candidate) => candidate.id === routeId);

    expect(`${route?.trigger} ${route?.action}`).toContain(requiredAction);
    expect(`${route?.trigger} ${route?.action}`).toContain(requiredBoundary);
  });

  it('uses bind first for recognizable single-view visualization requests', () => {
    const plainChart = routes.find((route) => route.id === 'plain-chart');
    expect(plainChart?.trigger).toContain('single-view visualization request');
    expect(plainChart?.trigger).toContain('common semantic asks');
    expect(plainChart?.action).toContain('semantic ask may return one bounded proposal');
    expect(plainChart?.toolSequence).toEqual([
      'bind-template',
      'list-templates',
      'list-available-fields',
      'build-worksheets-from-templates',
      'apply-worksheet',
    ]);
    expect(plainChart?.action).not.toMatch(/confirm|expire|same.session|re-list/i);
  });

  it('uses template binding for a chart requested on an explicitly named blank worksheet', () => {
    const plainChart = routes.find((route) => route.id === 'plain-chart');

    expect(plainChart?.action).toContain('explicitly named existing blank worksheet');
    expect(plainChart?.action).toContain('chart-creation target, not an edit');
    expect(plainChart?.action).toContain('bind-template with target_worksheet');
  });

  it('keeps populated existing-sheet edits on the manual edit-in-place route', () => {
    const plainChart = routes.find((route) => route.id === 'plain-chart');
    const editInPlace = routes.find((route) => route.id === 'edit-in-place');

    expect(plainChart?.action).toContain(
      'Existing-sheet edits on populated worksheets stay on the edit-in-place route',
    );
    expect(editInPlace?.trigger).toContain('populated');
    expect(editInPlace?.action).toContain('add-field');
    expect(editInPlace?.action).toContain('apply-worksheet');
    expect(editInPlace?.action).not.toContain('bind-template');
  });

  it('asks only when ambiguity changes written workbook content', () => {
    const ambiguity = DESKTOP_ROUTE_TABLE.find((entry) => entry.id === 'ask-user-ambiguity');

    expect(ambiguity).toMatchObject({
      kind: 'prose',
      text: expect.stringContaining('If ambiguity changes workbook content'),
    });
    expect(ambiguity?.kind === 'prose' ? ambiguity.text : '').toContain(
      'call ask-user with urgency=blocking; stop.',
    );
  });

  it('answers only from the rows get-summary-data returns', () => {
    const dataValueQuestion = routes.find((route) => route.id === 'data-value-question');

    expect(dataValueQuestion).toMatchObject({
      action: 'on a populated worksheet, call get-summary-data; answer only from returned rows.',
      stopConditions: ['answer only from returned rows'],
      requiredEvidence: ['get-summary-data returned rows'],
    });
  });

  it('states a plan-before-build gate with the MAGNITUDE/MEMBERSHIP classification', () => {
    const rendered = generateDesktopInstructions(DESKTOP_ROUTE_TABLE);
    expect(rendered).toContain('MAGNITUDE');
    expect(rendered).toContain('MEMBERSHIP');
  });

  it('routes dashboard composition through one bounded batch', () => {
    const dashboard = routes.find((route) => route.id === 'dashboard');
    expect(dashboard).toMatchObject({
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
    });
    expect(dashboard?.action).toContain('auto_apply:true');
    expect(dashboard?.action).toContain('only live non-KPI chart names');
    expect(dashboard?.action).toContain('ordered live KPI names');
    expect(dashboard?.action).toContain('KPI worksheet and display title');
    expect(dashboard?.action).toContain('never pass a generic starter name');
    expect(dashboard?.action).toContain('separate guarded artifact fallback');
    expect(dashboard?.action).toContain('Top 10 before composition');
    expect(dashboard?.action).toContain('topN:10');
    expect(dashboard?.action).toContain('never add a native sort call');
    expect(dashboard?.action).not.toContain('zero worksheet apply tasks');
    expect(dashboard?.action).not.toContain('dashboard-auto-apply');
  });

  it('does not send dashboard edits through worksheet-only tools', () => {
    const editInPlace = routes.find((route) => route.id === 'edit-in-place');

    expect(editInPlace?.trigger).not.toContain('dashboard');
  });

  it('routes unsupported dashboard edits through the scoped dashboard fallback', () => {
    const dashboardEdit = routes.find((route) => route.id === 'dashboard-edit-fallback');

    expect(dashboardEdit).toMatchObject({
      trigger: 'an existing dashboard edit the bounded batch cannot express',
      toolSequence: ['get-dashboard-xml', 'read-cached-xml', 'write-cached-xml', 'apply-dashboard'],
      stopConditions: ['stay on the scoped dashboard path'],
    });
  });

  it('routes story edits through the scoped story fallback', () => {
    const storyEdit = routes.find((route) => route.id === 'story-edit-fallback');

    expect(storyEdit).toMatchObject({
      trigger: 'an existing story edit',
      toolSequence: [
        'get-storyboard-xml',
        'read-cached-xml',
        'write-cached-xml',
        'apply-storyboard',
      ],
      stopConditions: ['stay on the scoped story path'],
    });
  });

  it('reserves whole-workbook apply for datasource definitions or cross-artifact changes', () => {
    const workbookFallback = routes.find((route) => route.id === 'whole-workbook-fallback');

    expect(workbookFallback).toMatchObject({
      trigger: 'a datasource-definition or cross-artifact change no scoped apply can express',
      toolSequence: ['get-workbook-xml', 'read-cached-xml', 'write-cached-xml', 'apply-workbook'],
      stopConditions: [
        'use only for datasource definitions or cross-artifact changes',
        'prefer a scoped apply whenever possible',
      ],
    });
  });

  it.each(routes)('route "$id" declares a tool sequence and stop conditions', (route) => {
    expect(route.toolSequence.length).toBeGreaterThan(0);
    expect(route.stopConditions.length).toBeGreaterThan(0);
  });

  it.each(routes)('route "$id" renders as "For <trigger>, <action>"', (route) => {
    expect(renderInstructionEntry(route)).toBe(`For ${route.trigger}, ${route.action}`);
  });

  it.each(routes)(
    'route "$id" toolSequence lists exactly the tools its rendered block names, in first-mention order',
    (route) => {
      expect(toolMentionsInFirstMentionOrder(renderInstructionEntry(route))).toEqual([
        ...route.toolSequence,
      ]);
    },
  );

  it.each(routes)('route "$id" rendered block states each stop condition verbatim', (route) => {
    const rendered = renderInstructionEntry(route);
    for (const stopCondition of route.stopConditions) {
      expect(rendered).toContain(stopCondition);
    }
  });
});

describe('generateDesktopInstructions', () => {
  it('renders every entry in table order, one paragraph each, separated by blank lines', () => {
    const generated = generateDesktopInstructions(DESKTOP_ROUTE_TABLE);
    expect(generated.split('\n\n')).toEqual(DESKTOP_ROUTE_TABLE.map(renderInstructionEntry));
  });
});

describe('buildDesktopInstructions', () => {
  const sessionResolutionEntry = DESKTOP_ROUTE_TABLE.find(
    (entry) => entry.id === SESSION_RESOLUTION_ID && entry.kind === 'prose',
  );

  it('keeps the unpinned session-resolution guidance when no session is pinned', () => {
    const unpinned = buildDesktopInstructions({ sessionPinned: false });
    expect(unpinned).toBe(generateDesktopInstructions(DESKTOP_ROUTE_TABLE));
    expect(unpinned).toContain(SESSION_RESOLUTION_TEXT_UNPINNED);
    expect(unpinned).toContain('list-instances');
  });

  it('swaps in pin-aware session guidance when a session is pinned', () => {
    const pinned = buildDesktopInstructions({ sessionPinned: true });
    expect(sessionResolutionEntry?.kind).toBe('prose');
    expect(pinned).toContain(SESSION_RESOLUTION_TEXT_PINNED);
    // Still names list-instances — the pin is a default, and the agent may target another Desktop.
    expect(pinned).toContain('list-instances');
    expect(pinned).not.toContain(SESSION_RESOLUTION_TEXT_UNPINNED);
    // The other routes must survive untouched.
    expect(pinned).toContain('You control Tableau Desktop.');
  });

  it('uses binder-first explicit charts with a guarded artifact fallback for the default profile', () => {
    const instructions = buildDesktopInstructions({ sessionPinned: false, profile: '' });

    expect(instructions).toContain(
      'list-templates -> list-available-fields -> build-worksheets-from-templates -> apply-worksheet',
    );
    expect(instructions).toContain('artifacts coexist');
    expect(instructions).toContain('Open intent builds several distinct worksheets.');
    expect(instructions).toContain('stop before apply-worksheet');
    expect(instructions).toContain('Apply exact templatePlan sequentially');
    expect(instructions).toContain('never replay uncertain apply');
    expect(instructions).toContain('bind-template');
    expect(instructions).toContain('auto_apply:true');
    expect(instructions).toContain('one exact call_2_contract proposal');
    expect(instructions).toContain(
      'Terminal only with applied:true plus clean host verification, or a verified fallback apply receipt (passed or warnings)',
    );
    expect(instructions).toContain('Never rephrase or resubmit the bare ask');
    expect(instructions).not.toMatch(
      /re-list|turn gate|forced confirmation|build-one-then-apply|expiry|same-session invalidation/i,
    );
  });

  it('keeps legacy template guidance only for demo and makes spec-loop no template claims', () => {
    const demo = buildDesktopInstructions({ sessionPinned: false, profile: 'demo' });
    const specLoop = buildDesktopInstructions({ sessionPinned: false, profile: 'spec-loop' });

    expect(demo).toContain('bind-template');
    expect(demo).toContain('run-dashboard-batch');
    expect(demo).toContain('compose-only');
    expect(demo).toContain('live worksheet names');
    expect(demo).not.toContain('build-worksheets-from-templates');
    expect(specLoop).not.toMatch(/template/i);
  });

  it.each(['dynamic-authoring', 'full', 'combined-lean'])(
    'serves binder-first charts with the modern artifact fallback for profile %s',
    (profile) => {
      const instructions = buildDesktopInstructions({ sessionPinned: false, profile });
      expect(instructions).toContain('build-worksheets-from-templates');
      expect(instructions).toContain('bind-template');
    },
  );
});
