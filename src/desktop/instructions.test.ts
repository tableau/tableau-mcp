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

    expect(plainChart?.action).toContain('put named channels in requiredChannels');
    expect(plainChart?.action).toContain('No fit: use manual worksheet path');
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
      'list-templates',
      'list-available-fields',
      'build-worksheets-from-templates',
    ]);
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
    expect(plainChart?.action).toContain('in parallel');
    expect(plainChart?.action).toContain('templatePlan');
    expect(plainChart?.action).toContain('an explicit view');
    expect(plainChart?.action).toContain('Direct asks may choose/build/apply.');
    expect(plainChart?.action).toContain('Open intent: build several distinct worksheets.');
    expect(plainChart?.action).toContain('Preview/no-change');
    expect(plainChart?.action).toContain('stop before apply-worksheet');
  });

  it('does not impose a bind-first or confirmation ceremony', () => {
    const plainChart = routes.find((route) => route.id === 'plain-chart');
    expect(plainChart?.action).not.toContain('bind-template');
    expect(plainChart?.action).not.toMatch(/confirm|expire|same.session|re-list/i);
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

  it('routes dashboard composition through one bounded batch', () => {
    const dashboard = routes.find((route) => route.id === 'dashboard');
    expect(dashboard?.toolSequence).toEqual(['run-dashboard-batch']);
    expect(dashboard?.action).toContain('build focused worksheet artifacts first');
    expect(dashboard?.action).toContain('place them and compose once');
    expect(dashboard?.action).toContain('existing worksheets');
    expect(dashboard?.action).toContain('omit artifactIds');
    expect(dashboard?.action).not.toContain('zero worksheet apply tasks');
    expect(dashboard?.action).toContain('Never replay a partial or unknown batch');
    expect(dashboard?.action).toContain('inspect live workbook state first');
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

  it('uses the caller-neutral template artifact flow for the default profile', () => {
    const instructions = buildDesktopInstructions({ sessionPinned: false, profile: '' });

    expect(instructions).toContain(
      'list-templates -> list-available-fields -> build-worksheets-from-templates -> apply-worksheet',
    );
    expect(instructions).toContain('Direct asks may choose/build/apply.');
    expect(instructions).toContain('artifacts coexist');
    expect(instructions).toContain('Open intent: build several distinct worksheets.');
    expect(instructions).toContain('stop before apply-worksheet');
    expect(instructions).toContain('Apply sequentially');
    expect(instructions).toContain('never replay uncertain apply');
    expect(instructions).not.toContain('bind-template');
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
    'prefers the modern template flow for profile %s',
    (profile) => {
      const instructions = buildDesktopInstructions({ sessionPinned: false, profile });
      expect(instructions).toContain('build-worksheets-from-templates');
      expect(instructions).not.toContain('bind-template');
    },
  );
});
