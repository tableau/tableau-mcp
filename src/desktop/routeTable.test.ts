import { desktopToolNames } from '../tools/desktop/toolName.js';
import {
  DESKTOP_ROUTE_TABLE,
  DesktopInstructionRoute,
  generateDesktopInstructions,
  renderInstructionEntry,
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

  it('contains the plain-chart, dashboard, and data-value deflection routes', () => {
    expect(routes.map((route) => route.id)).toEqual(
      expect.arrayContaining(['plain-chart', 'dashboard', 'data-value-question']),
    );
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
