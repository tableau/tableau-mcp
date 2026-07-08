import {
  DESKTOP_ROUTE_TABLE,
  DesktopInstructionRoute,
  generateDesktopInstructions,
  renderInstructionEntry,
} from './routeTable.js';

const routes = DESKTOP_ROUTE_TABLE.filter(
  (entry): entry is DesktopInstructionRoute => entry.kind === 'route',
);

describe('DESKTOP_ROUTE_TABLE', () => {
  it('entry ids are unique', () => {
    const ids = DESKTOP_ROUTE_TABLE.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('contains the plain-chart and dashboard routes', () => {
    expect(routes.map((route) => route.id)).toEqual(
      expect.arrayContaining(['plain-chart', 'dashboard']),
    );
  });

  it.each(routes)('route "$id" declares a tool sequence and stop conditions', (route) => {
    expect(route.toolSequence.length).toBeGreaterThan(0);
    expect(route.stopConditions.length).toBeGreaterThan(0);
  });

  it.each(routes)('route "$id" renders as "For <trigger>, <action>"', (route) => {
    expect(renderInstructionEntry(route)).toBe(`For ${route.trigger}, ${route.action}`);
  });

  it.each(routes)('route "$id" rendered block names every tool in its sequence', (route) => {
    const rendered = renderInstructionEntry(route);
    for (const tool of route.toolSequence) {
      expect(rendered).toContain(tool);
    }
  });

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
