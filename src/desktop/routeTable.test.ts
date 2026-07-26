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
} from './routeTable.js';

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
      'bind-template',
    ]);
  });

  it('census scopes refine-worksheet to top-N/sort and names the encoding pair', () => {
    const rendered = generateDesktopInstructions(DESKTOP_ROUTE_TABLE);

    expect(rendered).toContain('refine-worksheet edits top-N/sort');
    expect(rendered).toContain('add-field + apply-worksheet change encodings.');
  });

  it('routes calc-derived-field asks through the dynamic-authoring verbs', () => {
    const rendered = generateDesktopInstructions(DESKTOP_ROUTE_TABLE);
    expect(rendered).toContain(
      'or a calc/derived field the data lacks (ratio, running total, LOD)',
    );
    expect(rendered).toContain('author-calc');
    expect(rendered).not.toMatch(/tabui:.*document/i);
  });

  it('passes a noun-less derived metric through bind-template calcs in one call', () => {
    const calcThenBind = routes.find((route) => route.id === 'calc-then-bind');

    expect(calcThenBind?.trigger).toContain('no named chart type');
    expect(calcThenBind?.action).toContain('calcs[]');
    expect(calcThenBind?.action).toContain('ONE call');
    expect(calcThenBind?.action).not.toContain('(SUM(revenue)-SUM(cogs))/SUM(revenue)');
    expect(calcThenBind?.action).not.toContain('opex');
    expect(calcThenBind?.stopConditions).toEqual(['ONE call']);
    expect(calcThenBind?.action).toContain('search-knowledge first when unsure of the formula');
    expect(calcThenBind?.action).toContain('a proposal still resolves via Call 2');
    expect(calcThenBind?.toolSequence).toEqual(['bind-template', 'search-knowledge']);
    expect(calcThenBind?.requiredEvidence).toEqual(['authored_calcs returned by bind-template']);
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
        'an unfamiliar or non-trivial authoring ask (calc-heavy, uncertain which chart fits, formatting/design) only when no plain-chart binding path applies; a named chart type always takes plain-chart first, even with calc/formatting riders; chart-route escalation may still consult',
      toolSequence: ['search-knowledge', 'read-knowledge-resource'],
      stopConditions: ['read the top hit once, then proceed'],
    });
  });

  it('places the deterministic plain-chart route before knowledge consultation', () => {
    const routeIds = routes.map((route) => route.id);

    expect(routeIds.indexOf('plain-chart')).toBeLessThan(routeIds.indexOf('knowledge-consult'));
  });

  it('names the full two-call bind sequence without manual authoring between calls', () => {
    const plainChart = routes.find((route) => route.id === 'plain-chart');
    expect(plainChart?.action).toContain('Call 1');
    expect(plainChart?.action).toContain('Call 2');
    expect(plainChart?.action).toContain('same ask/target');
    expect(plainChart?.action).toContain('auto_apply:true');
    expect(plainChart?.action).toContain(
      'Do not use manual authoring tools between Call 1 and Call 2',
    );
    expect(plainChart?.action).toContain('proposals may carry sort and top_n.');
  });

  it('forbids orientation reads before the first bind attempt', () => {
    const plainChart = routes.find((route) => route.id === 'plain-chart');

    expect(plainChart?.action).toContain(
      'Never call list-available-fields or get-worksheet-xml to orient before bind-template',
    );
    expect(plainChart?.action).toContain('reads schema');
    expect(plainChart?.action).toContain('failed binds propose candidate fields');
    expect(plainChart?.action).toContain(
      'Never call list-available-fields or get-worksheet-xml to orient before bind-template',
    );
    expect(plainChart?.action).toContain('author-parameter/author-set may list fields first');
  });

  it('asks only when ambiguity changes written workbook content', () => {
    const ambiguity = DESKTOP_ROUTE_TABLE.find((entry) => entry.id === 'ask-user-ambiguity');

    expect(ambiguity).toMatchObject({
      kind: 'prose',
      text: expect.stringContaining('no defensible default exists'),
    });
    expect(ambiguity?.kind === 'prose' ? ambiguity.text : '').toContain(
      'build it and state the choice',
    );
  });

  it('answers only from returned rows; terminal/retry policy lives in the tool description', () => {
    const dataValueQuestion = routes.find((route) => route.id === 'data-value-question');

    expect(dataValueQuestion).toMatchObject({
      action: 'on a populated worksheet, call get-summary-data; answer only from returned rows.',
      stopConditions: ['answer only from returned rows'],
      requiredEvidence: ['get-summary-data returned rows or a discriminated status'],
    });
  });

  it('states a plan-before-build gate with the MAGNITUDE/MEMBERSHIP classification', () => {
    const rendered = generateDesktopInstructions(DESKTOP_ROUTE_TABLE);
    expect(rendered).toContain('MAGNITUDE');
    expect(rendered).toContain('MEMBERSHIP');
  });

  it('routes dashboard composition through visible dashboard tools before command search', () => {
    const dashboard = routes.find((route) => route.id === 'dashboard');
    expect(dashboard?.action).toBe(
      'build sheets with bind-template (author calcs/params/sets first), then compose with dashboard-auto-apply (2-6 plain charts, one call) or plan-dashboard-creation -> build-and-apply-dashboard.',
    );
    expect(dashboard?.toolSequence).toEqual([
      'bind-template',
      'dashboard-auto-apply',
      'plan-dashboard-creation',
      'build-and-apply-dashboard',
    ]);
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
});
