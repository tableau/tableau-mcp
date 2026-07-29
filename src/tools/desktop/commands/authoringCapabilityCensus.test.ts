import { checkAuthoringCapabilityCensus } from './authoringCapabilityCensus.js';

const SAFE_PLAN = { steps: [{ command: 'tabdoc:save' }] };

describe('checkAuthoringCapabilityCensus', () => {
  it.each([
    ['bin-spec', { steps: [{ command: 'tabdoc:save', args: { bin_origin: 0 } }] }],
    [
      'calc-authoring',
      { steps: [{ command: 'tabdoc:save', args: { nested: { formula: 'SUM([Sales])' } } }] },
    ],
    [
      'calc-authoring',
      {
        steps: [
          {
            command: 'tabdoc:save',
            args: { payload: '{"calculationFormula":"SUM([Sales])"}' },
          },
        ],
      },
    ],
    ['multi-summary-readback', { steps: SAFE_PLAN.steps, summaryWorksheet: ['Sales', 'Profit'] }],
    ['fiscal-calendar', { steps: [{ command: 'tabdoc:save', args: { currentPeriod: 'Q3' } }] }],
    [
      'goto-sheet-contract',
      { steps: [{ command: 'tabdoc:goto-sheet', args: { WindowLocator: 'Sheet 1' } }] },
    ],
  ])('detects %s from plan shape', (name, plan) => {
    const result = checkAuthoringCapabilityCensus(plan);

    expect(result.missing).toMatchObject({ name });
    expect(result.capabilitiesUsed).toContain(name);
  });

  it('classifies every known gap without guessing ask-level intent', () => {
    const result = checkAuthoringCapabilityCensus(SAFE_PLAN);

    expect(result.outcomes.map(({ name, detect }) => [name, detect])).toEqual([
      ['bin-spec', 'plan-shape'],
      ['calc-authoring', 'plan-shape'],
      ['worksheet-lifecycle', 'route-prose'],
      ['dashboard-composition', 'route-prose'],
      ['multi-summary-readback', 'plan-shape'],
      ['summary-rows-beyond-200', 'route-prose'],
      ['structural-verify', 'route-prose'],
      ['fiscal-calendar', 'plan-shape'],
      ['relative-date-window', 'route-prose'],
      ['filter-identity-readback', 'route-prose'],
      ['goto-sheet-contract', 'plan-shape'],
    ]);
    expect(result.outcomes.every(({ reason }) => !reason.includes('\n'))).toBe(true);
  });

  it('leaves a fully censused plan admitted', () => {
    const result = checkAuthoringCapabilityCensus(SAFE_PLAN);

    expect(result.missing).toBeUndefined();
    expect(result.capabilitiesUsed).toEqual([]);
  });
});
