import { desktopToolNames } from '../tools/desktop/toolName.js';
import {
  buildDesktopInstructions,
  DESKTOP_ROUTE_TABLE,
  DesktopInstructionRoute,
  generateDesktopInstructions,
  renderInstructionEntry,
  SESSION_RESOLUTION_ID,
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
    expect(rendered).toContain('tabdoc:goto-sheet');
    expect(rendered).toContain('Use search-commands ONLY for unlisted commands.');
  });

  it('routes calc-derived-field asks through the dynamic-authoring verbs', () => {
    const rendered = generateDesktopInstructions(DESKTOP_ROUTE_TABLE);
    expect(rendered).toContain(
      'or a calc/derived field the data lacks (ratio, running total, LOD)',
    );
    expect(rendered).toContain('author-calc');
    expect(rendered).not.toMatch(/tabui:.*document/i);
  });

  it('directs the agent to load the authoring skill before building', () => {
    const rendered = generateDesktopInstructions(DESKTOP_ROUTE_TABLE);
    expect(rendered).toContain('tableau-desktop-authoring');
  });

  it('caps targeted knowledge consultation at one read before authoring proceeds', () => {
    const knowledge = routes.find((route) => route.id === 'knowledge-consult');

    expect(knowledge).toMatchObject({
      trigger:
        'an unfamiliar or non-trivial authoring ask (calc-heavy, uncertain which chart fits, formatting/design) — never a plain chart ask the plain-chart route already handles',
      toolSequence: ['search-knowledge', 'read-knowledge-resource'],
      stopConditions: ['read the top hit once, then proceed'],
    });
  });

  it('teaches plain-chart proposals may carry sort and top_n', () => {
    const plainChart = routes.find((route) => route.id === 'plain-chart');
    expect(plainChart?.action).toContain('proposals may carry sort and top_n.');
  });

  it('requires a populated worksheet and makes no-data summary outcomes terminal', () => {
    const dataValueQuestion = routes.find((route) => route.id === 'data-value-question');

    expect(dataValueQuestion).toMatchObject({
      action:
        'on a populated worksheet, call get-summary-data once; answer only from returned rows. Any terminal/no-data result means stop; say so and offer to build a viz.',
      stopConditions: ['Any terminal/no-data result means stop'],
      requiredEvidence: ['get-summary-data returned rows or a terminal reason'],
    });
  });

  it('names the debug skill by its exact slug so recovery does not rely on description-matching', () => {
    const rendered = generateDesktopInstructions(DESKTOP_ROUTE_TABLE);
    expect(rendered).toContain('tableau-agent-debug');
  });

  it('states a plan-before-build gate with the MAGNITUDE/MEMBERSHIP classification', () => {
    const rendered = generateDesktopInstructions(DESKTOP_ROUTE_TABLE);
    expect(rendered).toContain('MAGNITUDE');
    expect(rendered).toContain('MEMBERSHIP');
  });

  it('routes dashboard composition through visible dashboard tools before command search', () => {
    const dashboard = routes.find((route) => route.id === 'dashboard');
    expect(dashboard?.action).toBe(
      'build sheets with bind-template (author calcs/params/sets first), then compose with dashboard-auto-apply (2-6 plain charts, one call) or plan-dashboard-creation -> build-and-apply-dashboard; search-commands only for commands the census does not list.',
    );
    expect(dashboard?.toolSequence).toEqual([
      'bind-template',
      'dashboard-auto-apply',
      'plan-dashboard-creation',
      'build-and-apply-dashboard',
      'search-commands',
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
  const sessionResolutionText = DESKTOP_ROUTE_TABLE.find(
    (entry) => entry.id === SESSION_RESOLUTION_ID && entry.kind === 'prose',
  );

  it('keeps the session-resolution guidance when no session is pinned', () => {
    const unpinned = buildDesktopInstructions({ sessionPinned: false });
    expect(unpinned).toBe(generateDesktopInstructions(DESKTOP_ROUTE_TABLE));
    expect(unpinned).toContain('list-instances');
  });

  it('drops the session-resolution guidance when a session is pinned', () => {
    const pinned = buildDesktopInstructions({ sessionPinned: true });
    expect(sessionResolutionText?.kind).toBe('prose');
    if (sessionResolutionText?.kind === 'prose') {
      expect(pinned).not.toContain(sessionResolutionText.text);
    }
    expect(pinned).not.toContain('list-instances');
    // The other routes must survive the filter untouched.
    expect(pinned).toContain('You control Tableau Desktop.');
  });
});
