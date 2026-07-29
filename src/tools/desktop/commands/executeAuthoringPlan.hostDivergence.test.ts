import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import {
  MockExternalApiServer,
  startMockExternalApiServer,
} from '../../../desktop/externalApi/mockExternalApiServer.js';
import { ExternalApiInstance } from '../../../desktop/externalApi/types.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getExecuteAuthoringPlanTool } from './executeAuthoringPlan.js';

const SESSION = 'session-1';
const FIELD = '[Sample].[none:Region:nk]';
const WORKSHEET_DOCUMENT_ROUTE = '/v0/workbook/worksheets/sheet-sales/document';
const SUMMARY_DATA_ROUTE = '/v0/workbook/worksheets/sheet-sales/summaryData';
const INVOKE_ROUTE = '/v0/app:invokeCommand';
const MATCHING_WORKSHEET_XML = `<workbook><worksheets>
  <worksheet name="Sales by Region"><table><panes><pane>
    <filter class="categorical" column="${FIELD}" user:ui-enumeration="inclusive">
      <groupfilter function="member" member="East"/>
      <groupfilter function="member" member="West"/>
    </filter>
  </pane></panes></table></worksheet>
</worksheets></workbook>`;

type PlanArgs = {
  steps: Array<{
    command: string;
    expect?: {
      kind: 'filter-signature';
      worksheet: string;
      column: string;
      members: string[];
      mode: 'include' | 'exclude';
      function?: string;
    };
  }>;
  summary_worksheet?: string;
};

type PlanPayload = {
  message: string;
  steps: Array<{ step: number; command: string; status: string }>;
  readback?: {
    postconditions?: Array<{ status: string; observed: string }>;
    summary_data?: { rows: unknown[][] };
  };
};

// These fake-Desktop tests prove only our detectors; they prove no real Desktop contracts.
describe('execute-authoring-plan host divergence', () => {
  let server: MockExternalApiServer;

  beforeEach(async () => {
    server = await startMockExternalApiServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it('reports done after a clean exchange', async () => {
    overrideWorksheetDocument(MATCHING_WORKSHEET_XML);

    const result = await executePlan(filterPlan(), await makeExecutor());

    expect(result.isError).toBe(false);
    const payload = payloadOf(result);
    expect(payload.message).toBe('Plan done: all 1 declared postcondition(s) passed.');
    expect(payload.readback?.postconditions).toEqual([
      expect.objectContaining({ status: 'passed' }),
    ]);
  });

  it('fails closed when the host drops a declared filter', async () => {
    overrideWorksheetDocument(
      '<workbook><worksheets><worksheet name="Sales by Region"><table><panes><pane/></panes></table></worksheet></worksheets></workbook>',
    );

    const result = await executePlan(filterPlan(), await makeExecutor());

    expectFailure(result, 'Postcondition mismatch at step 1 (filter-signature)');
    expect(payloadOf(result).readback?.postconditions).toEqual([
      expect.objectContaining({ status: 'mismatch', observed: '[]' }),
    ]);
  });

  it('fails closed when the host mutates declared filter members', async () => {
    overrideWorksheetDocument(MATCHING_WORKSHEET_XML.replace('member="West"', 'member="Central"'));

    const result = await executePlan(filterPlan(), await makeExecutor());

    expectFailure(result, 'Postcondition mismatch at step 1 (filter-signature)');
    expect(payloadOf(result).readback?.postconditions?.[0]?.observed).toContain('Central');
  });

  it.skip('TODO: fails closed when the host ignores requested activation', () => {
    // Missing observable: admitted plan readback exposes no active-sheet identity to compare after activation.
  });

  it('reports the poisoned next command after an earlier completed effect', async () => {
    let invokeCount = 0;
    const fetchFn: typeof fetch = async (input, init) => {
      const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
      if (init?.method === 'POST' && path === INVOKE_ROUTE) {
        invokeCount += 1;
        if (invokeCount === 2) {
          server.setOverride(`POST ${INVOKE_ROUTE}`, {
            status: 409,
            contentType: 'application/problem+json',
            body: JSON.stringify({
              type: 'problem',
              title: 'Modal dialog blocked command',
              status: 409,
              instance: '/v0/mock',
              detail: 'Poisoned next call: a modal dialog is open.',
              code: 'operation-failed',
            }),
          });
        }
      }
      return await fetch(input, init);
    };
    const executor = await makeExecutor(fetchFn);

    const result = await executePlan(
      { steps: [{ command: 'tabdoc:save' }, { command: 'tabdoc:save' }] },
      executor,
    );

    expectFailure(result, 'Step 2 (tabdoc:save) failed');
    const payload = payloadOf(result);
    expect(payload.message).toContain('Poisoned next call: a modal dialog is open.');
    expect(payload.message).toContain('Executed before failure: 1 (tabdoc:save)');
    expect(payload.message).toContain('No later step ran');
    expect(payload.steps).toEqual([{ step: 1, command: 'tabdoc:save', status: 'completed' }]);
    expect(
      server.requests.filter(({ method, path }) => method === 'POST' && path === INVOKE_ROUTE),
    ).toHaveLength(2);
  });

  it('fails closed when matching document readback has zero summary rows', async () => {
    overrideWorksheetDocument(MATCHING_WORKSHEET_XML);
    server.setOverride(`GET ${SUMMARY_DATA_ROUTE}`, {
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        columns: [{ name: 'Region', dataType: 'string' }],
        rows: [],
      }),
    });

    const result = await executePlan(
      { ...filterPlan(), summary_worksheet: 'Sales by Region' },
      await makeExecutor(),
    );

    expectFailure(result, 'Summary readback returned no rows; values are unverified');
    expect(payloadOf(result).readback?.summary_data?.rows).toEqual([]);
  });

  function overrideWorksheetDocument(xml: string): void {
    server.setOverride(`GET ${WORKSHEET_DOCUMENT_ROUTE}`, {
      status: 200,
      contentType: 'application/xml',
      body: xml,
    });
  }

  async function makeExecutor(fetchFn?: typeof fetch): Promise<ExternalApiToolExecutor> {
    const instance: ExternalApiInstance = {
      baseUrl: server.baseUrl,
      token: 'valid-token',
      pid: 999,
      instanceId: 'host-divergence',
      apiVersion: '0.1.1',
    };
    const executor = new ExternalApiToolExecutor({
      discover: () => [instance],
      desktopLogDirs: [],
      ...(fetchFn ? { clientOptions: { fetchFn } } : {}),
    });
    await executor.start();
    return executor;
  }
});

function filterPlan(): PlanArgs {
  return {
    steps: [
      {
        command: 'tabdoc:save',
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
  };
}

async function executePlan(
  args: PlanArgs,
  executor: ExternalApiToolExecutor,
): Promise<CallToolResult> {
  const extra = getMockRequestHandlerExtra();
  extra.getExecutor = vi.fn().mockResolvedValue(executor);
  const tool = getExecuteAuthoringPlanTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    {
      session: SESSION,
      mode: 'execute',
      steps: args.steps,
      verify: undefined,
      summary_worksheet: args.summary_worksheet,
    },
    extra,
  );
}

function payloadOf(result: CallToolResult): PlanPayload {
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text) as PlanPayload;
}

function expectFailure(result: CallToolResult, message: string): void {
  expect(result.isError).toBe(true);
  const payload = payloadOf(result);
  expect(payload.message).toContain(message);
  expect(payload.message).not.toContain('Plan done');
}
