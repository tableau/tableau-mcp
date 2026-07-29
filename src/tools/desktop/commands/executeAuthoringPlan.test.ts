import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getExecuteAuthoringPlanTool } from './executeAuthoringPlan.js';

const SESSION = 'session-1';
const COMPLETED = {
  command_id: 'command-1',
  status: 'completed' as const,
  submitted_at: '',
  result: null,
};
const STEPS = [
  { command: 'tabdoc:new-worksheet' },
  {
    command: 'tabdoc:generate-viz-from-notional-spec',
    args: {
      NotionalSpecJson:
        '{"version":"0.2.0","chart":"bar","fields":[{"caption":"Region","data":"string","type":"discrete","role":"dimension","encoding":"x"},{"caption":"Sales","data":"number","type":"continuous","role":"measure","aggregation":"sum","encoding":"y"}]}',
      ClearSheet: true,
    },
  },
  { command: 'tabdoc:save' },
];
const FIELD = '[Sample].[none:Region:nk]';
const WORKSHEET_XML = `<worksheet name="Sales by Region"><table><panes><pane>
  <mark class="Bar"/>
  <encodings><color column="${FIELD}"/></encodings>
  <filter class="categorical" column="${FIELD}" user:ui-enumeration="inclusive">
    <groupfilter function="member" member="East"/>
    <groupfilter function="member" member="West"/>
  </filter>
</pane></panes></table></worksheet>`;
const DASHBOARD_XML =
  '<dashboard name="Executive Overview"><zones><zone name="Sales by Region"/></zones></dashboard>';

describe('executeAuthoringPlanTool', () => {
  it('executes three completed steps in order and returns requested readback', async () => {
    const executor = makeExecutor();
    const extra = makeExtra(executor);

    const result = await getResult(
      {
        session: SESSION,
        steps: STEPS,
        verify: ['Sales by Region', 'Executive Overview'],
        summary_worksheet: 'Sales by Region',
      },
      extra,
    );

    expect(result.isError).toBe(false);
    expect(executor.executeCommand).toHaveBeenCalledTimes(3);
    expect(executor.executeCommand.mock.calls.map(([call]) => call.command)).toEqual([
      'new-worksheet',
      'generate-viz-from-notional-spec',
      'save',
    ]);
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);
    expect(payload.steps).toEqual([
      { step: 1, command: 'tabdoc:new-worksheet', status: 'completed' },
      { step: 2, command: 'tabdoc:generate-viz-from-notional-spec', status: 'completed' },
      { step: 3, command: 'tabdoc:save', status: 'completed' },
    ]);
    expect(payload.message).toContain('Readback observed worksheet "Sales by Region"');
    expect(payload.message).toContain('dashboard "Executive Overview"');
    expect(payload.message).not.toContain('success');
    expect(payload.readback).toEqual({
      verified: {
        requested: ['Sales by Region', 'Executive Overview'],
        observed: [
          { id: 'worksheet-1', name: 'Sales by Region', kind: 'worksheet' },
          { id: 'dashboard-1', name: 'Executive Overview', kind: 'dashboard' },
        ],
        missing: [],
      },
      summary_data: {
        worksheet: { id: 'worksheet-1', name: 'Sales by Region' },
        max_rows: 200,
        columns: [{ name: 'Region' }, { name: 'SUM(Sales)' }],
        rows: [['West', 100]],
      },
    });
    expect(result.structuredContent).toMatchObject({
      steps: payload.steps,
      readback: payload.readback,
    });
  });

  it('stops after an execution failure and surfaces its step id and enriched Desktop error', async () => {
    const commandError = {
      type: 'command-failed' as const,
      error: {
        code: 'ERR',
        message: 'Desktop rejected the notional spec',
        recoverable: false,
        'tableau-error-code': '0xBEEF',
      },
    };
    const executor = makeExecutor();
    executor.executeCommand
      .mockResolvedValueOnce(new Ok(COMPLETED))
      .mockResolvedValueOnce(new Err(commandError));
    const extra = makeExtra(executor);

    const result = await getResult({ session: SESSION, steps: STEPS }, extra);

    expect(result.isError).toBe(true);
    expect(executor.executeCommand).toHaveBeenCalledTimes(2);
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);
    expect(payload.steps).toEqual([
      { step: 1, command: 'tabdoc:new-worksheet', status: 'completed' },
    ]);
    expect(payload.message).toContain('Step 2 (tabdoc:generate-viz-from-notional-spec) failed');
    expect(payload.message).toContain('Desktop rejected the notional spec');
    expect(payload.message).toContain('tableau-error-code: 0xBEEF');
    expect(payload.message).toContain('Executed before failure: 1 (tabdoc:new-worksheet)');
    expect(payload.message).toContain('No later step ran');
    expect(payload.message).not.toContain('success');
  });

  it('refuses the whole plan during guard preflight and executes zero steps', async () => {
    const executor = makeExecutor();
    const extra = makeExtra(executor);

    const result = await getResult(
      {
        session: SESSION,
        steps: [STEPS[0], { command: 'tabdoc:show-parameter-controls' }, STEPS[2]],
      },
      extra,
    );

    expect(result.isError).toBe(true);
    expect(extra.getExecutor).not.toHaveBeenCalled();
    expect(executor.executeCommand).not.toHaveBeenCalled();
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);
    expect(payload.steps).toEqual([]);
    expect(payload.message).toContain('step 2 (tabdoc:show-parameter-controls)');
    expect(payload.message).toContain('Refusing to execute crash-prone Tableau command');
    expect(payload.message).toContain('No step ran');
  });

  it('stops at the first non-completed status because completion was not observed', async () => {
    const executor = makeExecutor();
    executor.executeCommand.mockResolvedValueOnce(new Ok(COMPLETED)).mockResolvedValueOnce(
      new Ok({
        ...COMPLETED,
        command_id: 'command-2',
        status: 'running',
      }),
    );
    const extra = makeExtra(executor);

    const result = await getResult({ session: SESSION, steps: STEPS }, extra);

    expect(result.isError).toBe(true);
    expect(executor.executeCommand).toHaveBeenCalledTimes(2);
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);
    expect(payload.steps).toEqual([
      { step: 1, command: 'tabdoc:new-worksheet', status: 'completed' },
      { step: 2, command: 'tabdoc:generate-viz-from-notional-spec', status: 'running' },
    ]);
    expect(payload.message).toContain(
      'Step 2 (tabdoc:generate-viz-from-notional-spec) reports status "running"',
    );
    expect(payload.message).toContain('Completion was not observed');
    expect(payload.message).toContain('No later step ran');
    expect(payload.message).not.toContain('success');
  });

  it('attributes a dropped worksheet postcondition to its declaring step', async () => {
    const executor = makeExecutor();
    executor.getWorkbook.mockResolvedValue(
      new Ok({ title: 'Book', unsavedChanges: true, worksheets: [], dashboards: [] }),
    );

    const result = await getResult(
      {
        session: SESSION,
        steps: [
          STEPS[0],
          {
            ...STEPS[2],
            expect: { kind: 'worksheet-exists', name: 'Dropped Sheet' },
          },
        ],
      },
      makeExtra(executor),
    );

    expectPostconditionFailure(result, 2, 'worksheet-exists', 'mismatch');
  });

  it('fails closed when a filter is dropped from worksheet readback', async () => {
    const executor = makeExecutor();
    executor.getWorksheetDocument.mockResolvedValue(
      new Ok({
        xml: '<worksheet name="Sales by Region"><table><panes><pane/></panes></table></worksheet>',
      }),
    );

    const result = await getResult(
      {
        session: SESSION,
        steps: [
          {
            ...STEPS[0],
            expect: {
              kind: 'filter-signature',
              worksheet: 'Sales by Region',
              column: FIELD,
              members: ['West', 'East'],
              mode: 'include',
              function: 'member',
            },
          },
        ],
      },
      makeExtra(executor),
    );

    expectPostconditionFailure(result, 1, 'filter-signature', 'mismatch');
  });

  it('fails closed when filter members mutate', async () => {
    const executor = makeExecutor();
    executor.getWorksheetDocument.mockResolvedValue(
      new Ok({ xml: WORKSHEET_XML.replace('member="West"', 'member="Central"') }),
    );

    const result = await getResult(
      {
        session: SESSION,
        steps: [
          STEPS[0],
          {
            ...STEPS[2],
            expect: {
              kind: 'filter-signature',
              worksheet: 'Sales by Region',
              column: FIELD,
              members: ['West', 'East'],
              mode: 'include',
              function: 'member',
            },
          },
        ],
      },
      makeExtra(executor),
    );

    expectPostconditionFailure(result, 2, 'filter-signature', 'mismatch');
  });

  it('fails closed when Tableau changes the expected mark type', async () => {
    const executor = makeExecutor();
    executor.getWorksheetDocument.mockResolvedValue(
      new Ok({ xml: WORKSHEET_XML.replace('class="Bar"', 'class="Circle"') }),
    );

    const result = await getResult(
      {
        session: SESSION,
        steps: [
          STEPS[0],
          {
            ...STEPS[2],
            expect: { kind: 'mark-type', worksheet: 'Sales by Region', mark: 'Bar' },
          },
        ],
      },
      makeExtra(executor),
    );

    expectPostconditionFailure(result, 2, 'mark-type', 'mismatch');
  });

  it('fails closed when an expected encoding is dropped', async () => {
    const executor = makeExecutor();
    executor.getWorksheetDocument.mockResolvedValue(
      new Ok({ xml: WORKSHEET_XML.replace(`<color column="${FIELD}"/>`, '') }),
    );

    const result = await getResult(
      {
        session: SESSION,
        steps: [
          {
            ...STEPS[0],
            expect: {
              kind: 'encoding',
              worksheet: 'Sales by Region',
              channel: 'color',
              field: FIELD,
            },
          },
        ],
      },
      makeExtra(executor),
    );

    expectPostconditionFailure(result, 1, 'encoding', 'mismatch');
  });

  it('fails closed when a dashboard contains the wrong worksheet', async () => {
    const executor = makeExecutor();
    executor.getDashboardDocument.mockResolvedValue(
      new Ok({ xml: DASHBOARD_XML.replace('Sales by Region', 'Profit by Segment') }),
    );

    const result = await getResult(
      {
        session: SESSION,
        steps: [
          STEPS[0],
          {
            ...STEPS[2],
            expect: {
              kind: 'dashboard-contains',
              dashboard: 'Executive Overview',
              worksheet: 'Sales by Region',
            },
          },
        ],
      },
      makeExtra(executor),
    );

    expectPostconditionFailure(result, 2, 'dashboard-contains', 'mismatch');
  });

  it('reports done only after every declared postcondition passes', async () => {
    const executor = makeExecutor();
    const result = await getResult(
      {
        session: SESSION,
        steps: [
          {
            ...STEPS[0],
            expect: { kind: 'worksheet-exists', name: 'Sales by Region' },
          },
          {
            ...STEPS[1],
            expect: {
              kind: 'filter-signature',
              worksheet: 'Sales by Region',
              column: FIELD,
              members: ['West', 'East'],
              mode: 'include',
              function: 'member',
            },
          },
          {
            ...STEPS[2],
            expect: { kind: 'mark-type', worksheet: 'Sales by Region', mark: 'Bar' },
          },
          {
            ...STEPS[2],
            expect: {
              kind: 'encoding',
              worksheet: 'Sales by Region',
              channel: 'color',
              field: FIELD,
            },
          },
          {
            ...STEPS[2],
            expect: {
              kind: 'dashboard-contains',
              dashboard: 'Executive Overview',
              worksheet: 'Sales by Region',
            },
          },
        ],
      },
      makeExtra(executor),
    );

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);
    expect(payload.message).toContain('Plan done');
    expect(payload.readback.postconditions).toHaveLength(5);
    expect(
      payload.readback.postconditions.every(
        ({ status }: { status: string }) => status === 'passed',
      ),
    ).toBe(true);
    expect(executor.getWorkbook).toHaveBeenCalledTimes(1);
    expect(executor.getWorksheetDocument).toHaveBeenCalledTimes(1);
    expect(executor.getDashboardDocument).toHaveBeenCalledTimes(1);
  });

  it('attributes an unavailable readback to the first step with an expectation', async () => {
    const executor = makeExecutor();
    executor.getWorkbook.mockResolvedValue(
      new Err({
        type: 'command-failed',
        error: { code: 'READBACK_DOWN', message: 'readback unavailable', recoverable: true },
      }),
    );

    const result = await getResult(
      {
        session: SESSION,
        steps: [
          STEPS[0],
          {
            ...STEPS[2],
            expect: { kind: 'mark-type', worksheet: 'Sales by Region', mark: 'Bar' },
          },
        ],
      },
      makeExtra(executor),
    );

    expectPostconditionFailure(result, 2, 'mark-type', 'could not be observed');
  });
});

type MockExecutor = {
  executeCommand: ReturnType<typeof vi.fn>;
  getWorkbook: ReturnType<typeof vi.fn>;
  getWorksheetDocument: ReturnType<typeof vi.fn>;
  getDashboardDocument: ReturnType<typeof vi.fn>;
  listWorksheets: ReturnType<typeof vi.fn>;
  getWorksheetSummaryData: ReturnType<typeof vi.fn>;
};

function makeExecutor(): MockExecutor {
  return {
    executeCommand: vi.fn().mockResolvedValue(new Ok(COMPLETED)),
    getWorkbook: vi.fn().mockResolvedValue(
      new Ok({
        title: 'Book',
        unsavedChanges: true,
        worksheets: [
          {
            id: 'worksheet-1',
            name: 'Sales by Region',
            hidden: false,
            datasources: ['Sample - Superstore'],
          },
        ],
        dashboards: [
          {
            id: 'dashboard-1',
            name: 'Executive Overview',
            hidden: false,
          },
        ],
      }),
    ),
    getWorksheetDocument: vi.fn().mockResolvedValue(new Ok({ xml: WORKSHEET_XML })),
    getDashboardDocument: vi.fn().mockResolvedValue(new Ok({ xml: DASHBOARD_XML })),
    listWorksheets: vi.fn().mockResolvedValue(
      new Ok({
        worksheets: [
          {
            id: 'worksheet-1',
            name: 'Sales by Region',
            hidden: false,
            datasources: ['Sample - Superstore'],
          },
        ],
      }),
    ),
    getWorksheetSummaryData: vi.fn().mockResolvedValue(
      new Ok({
        columns: [{ name: 'Region' }, { name: 'SUM(Sales)' }],
        rows: [['West', 100]],
      }),
    ),
  };
}

function makeExtra(executor: MockExecutor): ReturnType<typeof getMockRequestHandlerExtra> {
  const extra = getMockRequestHandlerExtra();
  extra.getExecutor = vi.fn().mockResolvedValue(executor);
  return extra;
}

async function getResult(
  args: {
    session: string;
    steps: Array<{
      command: string;
      args?: Record<string, unknown>;
      expect?:
        | { kind: 'worksheet-exists'; name: string }
        | {
            kind: 'filter-signature';
            worksheet: string;
            column: string;
            members: string[];
            mode: 'include' | 'exclude';
            function?: string;
          }
        | { kind: 'mark-type'; worksheet: string; mark: string }
        | { kind: 'encoding'; worksheet: string; channel: string; field: string }
        | { kind: 'dashboard-contains'; dashboard: string; worksheet: string };
    }>;
    verify?: string[];
    summary_worksheet?: string;
  },
  extra: ReturnType<typeof getMockRequestHandlerExtra>,
): Promise<CallToolResult> {
  const tool = getExecuteAuthoringPlanTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback({ verify: undefined, summary_worksheet: undefined, ...args }, extra);
}

function expectPostconditionFailure(
  result: CallToolResult,
  step: number,
  kind: string,
  failure: 'mismatch' | 'could not be observed',
): void {
  expect(result.isError).toBe(true);
  invariant(result.content[0].type === 'text');
  const payload = JSON.parse(result.content[0].text);
  expect(payload.message).toContain(`step ${step}`);
  expect(payload.message).toContain(kind);
  expect(payload.message).toContain(failure);
  expect(payload.message).toContain('Expected');
  expect(payload.message).toContain(failure === 'mismatch' ? 'observed' : 'observed unavailable');
  expect(payload.message).not.toContain('Plan done');
}
