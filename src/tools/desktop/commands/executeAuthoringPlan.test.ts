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
});

type MockExecutor = {
  executeCommand: ReturnType<typeof vi.fn>;
  getWorkbook: ReturnType<typeof vi.fn>;
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
    steps: Array<{ command: string; args?: Record<string, unknown> }>;
    verify?: string[];
    summary_worksheet?: string;
  },
  extra: ReturnType<typeof getMockRequestHandlerExtra>,
): Promise<CallToolResult> {
  const tool = getExecuteAuthoringPlanTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback({ verify: undefined, summary_worksheet: undefined, ...args }, extra);
}
