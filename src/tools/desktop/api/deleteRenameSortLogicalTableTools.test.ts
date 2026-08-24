import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import {
  MockExternalApiServer,
  startMockExternalApiServer,
} from '../../../desktop/externalApi/mockExternalApiServer.js';
import { ExternalApiInstance } from '../../../desktop/externalApi/types.js';
import * as sessionResolution from '../../../desktop/session/sessionResolution.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { DesktopTool } from '../tool.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getDeleteSheetTool } from './deleteSheet.js';
import { getWorksheetUnderlyingDataTool } from './getWorksheetUnderlyingData.js';
import { getListWorksheetLogicalTablesTool } from './listWorksheetLogicalTables.js';
import { getRenameSheetTool } from './renameSheet.js';
import { getSortWorksheetTool } from './sortWorksheet.js';

vi.mock('../../../desktop/session/sessionResolution.js');

// Seeded by mockExternalApiServer.
const WORKSHEET_ID = 'sheet-sales';
const WORKSHEET_NAME = 'Sales by Region';
const DASHBOARD_NAME = 'Executive Dashboard';
const DASHBOARD_ID = 'dash-exec';
const LOGICAL_TABLE_ID = 'lt-orders';
const WORKSHEET_DOCUMENT_XML = `<?xml version="1.0"?>
<worksheet name="Sales by Region">
  <table>
    <view>
      <datasources><datasource name="Sample - Superstore" /></datasources>
      <datasource-dependencies datasource="Sample - Superstore">
        <column-instance column="[Region]" derivation="None" name="[none:Region:nk]" pivot="key" type="nominal" />
        <column-instance column="[Sales]" derivation="Sum" name="[sum:Sales:qk]" pivot="key" type="quantitative" />
      </datasource-dependencies>
    </view>
    <rows>[Sample - Superstore].[none:Region:nk]</rows>
    <cols>[Sample - Superstore].[sum:Sales:qk]</cols>
  </table>
  <simple-id uuid="sheet-sales" />
</worksheet>`;

describe('delete-sheet / rename-sheet / sort-worksheet + logical-table read tools', () => {
  it('describes discrete member ordering separately from measure ranking', async () => {
    const tool = getSortWorksheetTool(new DesktopMcpServer());
    const paramsSchema = await Provider.from(tool.paramsSchema);
    expect(tool.description).toBe(
      'Order members of a discrete field. For measure ranking, use refine-worksheet with operation sort_by_field.',
    );
    expect(paramsSchema.fieldName.description).toBe(
      'On-shelf discrete field to order (for example, "Region").',
    );
    expect(paramsSchema.direction.description).toBe('Member order direction; default asc.');
    expect(tool.description).not.toContain('Sales');
    expect(paramsSchema.direction.description).not.toContain('Numeric desc');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('delete-sheet POSTs the worksheet :delete route body-less', async () => {
    const harness = await startHarness(getDeleteSheetTool);
    try {
      const { result } = await run(harness, { sheet: WORKSHEET_NAME });
      expect(result.isError).toBeFalsy();
      const posted = harness.server.requests.filter(
        (r) => r.method === 'POST' && r.path === `/v0/workbook/worksheets/${WORKSHEET_ID}:delete`,
      );
      expect(posted).toHaveLength(1);
      expect(posted[0].body).toBe('');
    } finally {
      await harness.close();
    }
  });

  it('delete-sheet routes a dashboard target to the dashboards :delete path', async () => {
    const harness = await startHarness(getDeleteSheetTool);
    try {
      const { result } = await run(harness, { sheet: DASHBOARD_NAME });
      expect(result.isError).toBeFalsy();
      const posted = harness.server.requests.filter(
        (r) => r.method === 'POST' && r.path === `/v0/workbook/dashboards/${DASHBOARD_ID}:delete`,
      );
      expect(posted).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });

  it('rename-sheet POSTs the worksheet :rename route with the new name', async () => {
    const harness = await startHarness(getRenameSheetTool);
    try {
      const { result } = await run(harness, { sheet: WORKSHEET_NAME, name: 'Regional Sales' });
      expect(result.isError).toBeFalsy();
      const posted = harness.server.requests.filter(
        (r) => r.method === 'POST' && r.path === `/v0/workbook/worksheets/${WORKSHEET_ID}:rename`,
      );
      expect(posted).toHaveLength(1);
      expect(JSON.parse(posted[0].body)).toEqual({ name: 'Regional Sales' });
    } finally {
      await harness.close();
    }
  });

  it('sort-worksheet rejects a measure field and directs measure ranking without POSTing', async () => {
    const harness = await startHarness(getSortWorksheetTool);
    try {
      const { result } = await run(harness, {
        worksheet: WORKSHEET_NAME,
        fieldName: 'Sales',
        direction: 'desc',
      });
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toBe(
        'Field "Sales" resolves to a quantitative/continuous shelf field, but sort-worksheet only orders members of a discrete shelf field. To rank a dimension by a measure, use refine-worksheet with operation sort_by_field.',
      );
      expect(harness.server.requests.filter((request) => request.method === 'POST')).toHaveLength(
        0,
      );
    } finally {
      await harness.close();
    }
  });

  it('sort-worksheet resolves a discrete shelf field and POSTs its member order', async () => {
    const harness = await startHarness(getSortWorksheetTool);
    try {
      const { result } = await run(harness, {
        worksheet: WORKSHEET_NAME,
        fieldName: 'Region',
        direction: 'desc',
        sortType: 'alpha',
      });
      expect(result.isError).toBe(false);
      const posted = harness.server.requests.filter((request) => request.method === 'POST');
      expect(posted).toHaveLength(1);
      expect(posted[0].path).toBe(`/v0/workbook/worksheets/${WORKSHEET_ID}:sort`);
      expect(JSON.parse(posted[0].body)).toEqual({
        fieldName: '[Sample - Superstore].[none:Region:nk]',
        direction: 'desc',
        sortType: 'alpha',
      });
    } finally {
      await harness.close();
    }
  });

  it('sort-worksheet resolves a calculated shelf field by caption and POSTs its member order', async () => {
    const harness = await startHarness(getSortWorksheetTool);
    harness.server.setOverride(`GET /v0/workbook/worksheets/${WORKSHEET_ID}/document`, {
      status: 200,
      contentType: 'application/xml',
      body: WORKSHEET_DOCUMENT_XML.replace(
        '<rows>[Sample - Superstore].[none:Region:nk]</rows>',
        '<rows>[Sample - Superstore].[usr:Calc_ProfitTier:nk]</rows>',
      ).replace(
        '</datasource-dependencies>',
        '<column caption="Profit Tier" datatype="string" name="[Calc_ProfitTier]" role="dimension" type="nominal" />\n        <column-instance column="[Calc_ProfitTier]" derivation="User" name="[usr:Calc_ProfitTier:nk]" pivot="key" type="nominal" />\n      </datasource-dependencies>',
      ),
    });
    try {
      const { result } = await run(harness, {
        worksheet: WORKSHEET_NAME,
        fieldName: 'Profit Tier',
        direction: 'asc',
      });
      expect(result.isError).toBe(false);
      const posted = harness.server.requests.filter((request) => request.method === 'POST');
      expect(posted).toHaveLength(1);
      expect(JSON.parse(posted[0].body)).toEqual({
        fieldName: '[Sample - Superstore].[usr:Calc_ProfitTier:nk]',
        direction: 'asc',
      });
    } finally {
      await harness.close();
    }
  });

  it('sort-worksheet rejects clearSort on a quantitative shelf field without POSTing', async () => {
    const harness = await startHarness(getSortWorksheetTool);
    try {
      const { result } = await run(harness, {
        worksheet: WORKSHEET_NAME,
        fieldName: 'Sales',
        clearSort: true,
      });
      expect(result.isError).toBe(true);
      expect(harness.server.requests.filter((request) => request.method === 'POST')).toHaveLength(
        0,
      );
    } finally {
      await harness.close();
    }
  });

  it('sort-worksheet clears a discrete member sort with exactly one POST', async () => {
    const harness = await startHarness(getSortWorksheetTool);
    try {
      const { result } = await run(harness, {
        worksheet: WORKSHEET_NAME,
        fieldName: 'Region',
        clearSort: true,
      });
      expect(result.isError).toBe(false);
      const posted = harness.server.requests.filter((request) => request.method === 'POST');
      expect(posted).toHaveLength(1);
      expect(JSON.parse(posted[0].body)).toEqual({
        fieldName: '[Sample - Superstore].[none:Region:nk]',
        clearSort: true,
      });
    } finally {
      await harness.close();
    }
  });

  it('sort-worksheet accepts a declared ordinal shelf calculation whose token has an extra colon', async () => {
    const harness = await startHarness(getSortWorksheetTool);
    harness.server.setOverride(`GET /v0/workbook/worksheets/${WORKSHEET_ID}/document`, {
      status: 200,
      contentType: 'application/xml',
      body: WORKSHEET_DOCUMENT_XML.replace(
        '<rows>[Sample - Superstore].[none:Region:nk]</rows>',
        '<rows>[Sample - Superstore].[usr:Calc:ok:20]</rows>',
      ).replace(
        '</datasource-dependencies>',
        '<column-instance column="[Calc]" derivation="User" name="[usr:Calc:ok:20]" pivot="key" type="ordinal" />\n      </datasource-dependencies>',
      ),
    });
    try {
      const { result } = await run(harness, {
        worksheet: WORKSHEET_NAME,
        fieldName: 'Calc',
        direction: 'asc',
      });
      expect(result.isError).toBe(false);
      const posted = harness.server.requests.filter((request) => request.method === 'POST');
      expect(posted).toHaveLength(1);
      expect(posted[0].path).toBe(`/v0/workbook/worksheets/${WORKSHEET_ID}:sort`);
      expect(JSON.parse(posted[0].body)).toEqual({
        fieldName: '[Sample - Superstore].[usr:Calc:ok:20]',
        direction: 'asc',
      });
    } finally {
      await harness.close();
    }
  });

  it('sort-worksheet fails closed when an on-shelf field has no matching type declaration', async () => {
    const harness = await startHarness(getSortWorksheetTool);
    harness.server.setOverride(`GET /v0/workbook/worksheets/${WORKSHEET_ID}/document`, {
      status: 200,
      contentType: 'application/xml',
      body: WORKSHEET_DOCUMENT_XML.replace(
        /<datasource-dependencies[\s\S]*?<\/datasource-dependencies>/,
        '',
      ),
    });
    try {
      const { result } = await run(harness, {
        worksheet: WORKSHEET_NAME,
        fieldName: 'Region',
      });
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toBe(
        'Field "Region" is on the worksheet shelf, but its field type could not be verified. sort-worksheet did not send a request.',
      );
      expect(harness.server.requests.filter((request) => request.method === 'POST')).toHaveLength(
        0,
      );
    } finally {
      await harness.close();
    }
  });

  it('sort-worksheet rejects a field that is not on the worksheet shelves, POSTing nothing', async () => {
    const harness = await startHarness(getSortWorksheetTool);
    try {
      const { result } = await run(harness, { worksheet: WORKSHEET_NAME, fieldName: 'Discount' });
      expect(result.isError).toBeTruthy();
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('not on worksheet');
      const posted = harness.server.requests.filter(
        (r) => r.method === 'POST' && r.path === `/v0/workbook/worksheets/${WORKSHEET_ID}:sort`,
      );
      expect(posted).toHaveLength(0);
    } finally {
      await harness.close();
    }
  });

  it('list-worksheet-logical-tables GETs the logicalTables route and returns the tables', async () => {
    const harness = await startHarness(getListWorksheetLogicalTablesTool);
    try {
      const { result } = await run(harness, { worksheet: WORKSHEET_NAME });
      expect(result.isError).toBeFalsy();
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain(LOGICAL_TABLE_ID);
      const got = harness.server.requests.filter(
        (r) =>
          r.method === 'GET' && r.path === `/v0/workbook/worksheets/${WORKSHEET_ID}/logicalTables`,
      );
      expect(got).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });

  it('get-worksheet-underlying-data GETs the logical-table data route with query params', async () => {
    const harness = await startHarness(getWorksheetUnderlyingDataTool);
    try {
      const { result } = await run(harness, {
        worksheet: WORKSHEET_NAME,
        logicalTable: LOGICAL_TABLE_ID,
        maxRows: 50,
        includeAllColumns: true,
      });
      expect(result.isError).toBeFalsy();
      const got = harness.server.requests.filter(
        (r) =>
          r.method === 'GET' &&
          r.path.startsWith(
            `/v0/workbook/worksheets/${WORKSHEET_ID}/logicalTables/${LOGICAL_TABLE_ID}/data`,
          ),
      );
      expect(got).toHaveLength(1);
      expect(got[0].searchParams).toMatchObject({ maxRows: '50', includeAllColumns: 'true' });
    } finally {
      await harness.close();
    }
  });

  it('get-worksheet-underlying-data resolves a logical table caption to its id', async () => {
    const harness = await startHarness(getWorksheetUnderlyingDataTool);
    try {
      const { result } = await run(harness, {
        worksheet: WORKSHEET_NAME,
        logicalTable: 'Orders',
      });
      expect(result.isError).toBeFalsy();
      const got = harness.server.requests.filter(
        (r) =>
          r.method === 'GET' &&
          r.path.startsWith(
            `/v0/workbook/worksheets/${WORKSHEET_ID}/logicalTables/${LOGICAL_TABLE_ID}/data`,
          ),
      );
      expect(got).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });

  it('get-worksheet-underlying-data qualifies a bare column name with the datasource caption', async () => {
    const harness = await startHarness(getWorksheetUnderlyingDataTool);
    try {
      const { result } = await run(harness, {
        worksheet: WORKSHEET_NAME,
        logicalTable: LOGICAL_TABLE_ID,
        columns: ['Sales'],
      });
      expect(result.isError).toBeFalsy();
      const got = harness.server.requests.filter(
        (r) =>
          r.method === 'GET' &&
          r.path.startsWith(
            `/v0/workbook/worksheets/${WORKSHEET_ID}/logicalTables/${LOGICAL_TABLE_ID}/data`,
          ),
      );
      expect(got).toHaveLength(1);
      expect(got[0].searchParams).toMatchObject({
        columnsToIncludeByFieldName: '[Sample - Superstore].[Sales]',
      });
    } finally {
      await harness.close();
    }
  });

  it('delete-sheet refuses to delete the last remaining worksheet without POSTing', async () => {
    const deleteSheet = vi.fn();
    const executor = {
      listWorksheets: vi
        .fn()
        .mockResolvedValue(Ok({ worksheets: [{ id: WORKSHEET_ID, name: WORKSHEET_NAME }] })),
      listDashboards: vi.fn().mockResolvedValue(Ok({ dashboards: [] })),
      listStoryboards: vi.fn().mockResolvedValue(Ok({ storyboards: [] })),
      deleteSheet,
    };
    const tool = getDeleteSheetTool(new DesktopMcpServer());
    const callback = (await Provider.from(tool.callback)) as (
      args: Record<string, unknown>,
      extra: ReturnType<typeof getMockRequestHandlerExtra>,
    ) => Promise<CallToolResult>;
    const extra = {
      ...getMockRequestHandlerExtra(),
      getExecutor: vi.fn().mockResolvedValue(executor),
    };

    const result = await callback({ sheet: WORKSHEET_NAME }, extra);

    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('"deleted":false');
    expect(deleteSheet).not.toHaveBeenCalled();
  });
});

type Harness = {
  server: MockExternalApiServer;
  callTool: (args: Record<string, unknown>) => Promise<CallToolResult>;
  close: () => Promise<void>;
};

async function run(
  harness: Harness,
  args: Record<string, unknown>,
): Promise<{ result: CallToolResult }> {
  return { result: await harness.callTool(args) };
}

async function startHarness(
  makeTool: (server: DesktopMcpServer) => DesktopTool<any>,
): Promise<Harness> {
  const server = await startMockExternalApiServer();
  server.setOverride(`GET /v0/workbook/worksheets/${WORKSHEET_ID}/document`, {
    status: 200,
    contentType: 'application/xml',
    body: WORKSHEET_DOCUMENT_XML,
  });
  const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
  await executor.start();
  const tool = makeTool(new DesktopMcpServer());
  const callback = (await Provider.from(tool.callback)) as (
    args: Record<string, unknown>,
    extra: ReturnType<typeof getMockRequestHandlerExtra>,
  ) => Promise<CallToolResult>;
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: vi.fn().mockResolvedValue(executor),
  };

  return {
    server,
    callTool: async (args) => await callback(args, extra),
    close: async () => {
      executor.stop();
      await server.close();
    },
  };
}

function instanceFor(server: MockExternalApiServer): ExternalApiInstance {
  return {
    baseUrl: server.baseUrl,
    token: 'valid-token',
    pid: 999,
    instanceId: 'inst-sheet-tools',
    apiVersion: '0.2.4',
  };
}
