import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import { makeExecutorMock } from '../../../desktop/externalApi/executor.mock.js';
import type { ExecuteCommandError } from '../../../desktop/externalApi/executorTypes.js';
import type { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import type {
  ShowMeOptionsQuery,
  ShowMeOptionsResult,
  WorksheetItem,
} from '../../../desktop/externalApi/types.js';
import * as sessionResolution from '../../../desktop/session/sessionResolution.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import type { TableauDesktopToolContext } from '../toolContext.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getShowMeOptionsTool } from './getShowMeOptions.js';

vi.mock('../../../desktop/session/sessionResolution.js');

const defaultOptions: ShowMeOptionsResult = {
  worksheet: { id: 'sheet-sales', name: 'Sales by Region' },
  options: [
    {
      showMeType: 'future-native-viz',
      isApplicable: false,
      vizHasRequiredFields: true,
      dataSourceHasRequiredFields: false,
      helpUrl: 'https://help.tableau.com/show-me/future-native-viz',
    },
    {
      showMeType: 'scatter-plot',
      isApplicable: true,
      vizHasRequiredFields: true,
      dataSourceHasRequiredFields: true,
      helpUrl: 'https://help.tableau.com/show-me/scatter-plot',
    },
  ],
};

type ToolArgs = {
  session?: string;
  worksheet: string;
  dataSource?: string;
  fieldsSelectedInSchemaViewer?: string[];
};

describe('getShowMeOptionsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('resolved-session'));
  });

  it('publishes a read-only discovery contract that forbids guessing', async () => {
    const tool = getShowMeOptionsTool(new DesktopMcpServer());
    const paramsSchema = await Provider.from(tool.paramsSchema);

    expect(tool.name).toBe('get-show-me-options');
    expect(tool.title).toBe('Get Show Me Options');
    expect(tool.minApiVersion).toBe('0.2.15');
    expect(tool.paramsSchema).toMatchObject({
      session: expect.any(Object),
      worksheet: expect.any(Object),
      dataSource: expect.any(Object),
      fieldsSelectedInSchemaViewer: expect.any(Object),
    });
    expect(paramsSchema.worksheet.safeParse('').success).toBe(false);
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(tool.description).toContain('Call this before applying Show Me');
    expect(tool.description).toContain('only a returned showMeType');
    expect(tool.description).toContain('isApplicable value is true');
    expect(tool.description).toContain('never invent or infer');
    expect(tool.description).toContain('ask the user to choose');
    expect(tool.description).not.toContain('`show-me`');
  });

  it.each([
    {
      label: 'stable id',
      requested: 'shared',
      worksheets: [worksheet('shared', 'Resolved by id'), worksheet('other', 'shared')],
      expectedId: 'shared',
    },
    {
      label: 'unambiguous name',
      requested: 'Profit by Category',
      worksheets: [
        worksheet('sheet-sales', 'Sales by Region'),
        worksheet('sheet-profit', 'Profit by Category'),
      ],
      expectedId: 'sheet-profit',
    },
  ])(
    'resolves a worksheet by $label before discovery',
    async ({ requested, worksheets, expectedId }) => {
      const { result, executor } = await invoke({ args: { worksheet: requested }, worksheets });

      expect(result.isError).toBe(false);
      expect(executor.listWorksheets).toHaveBeenCalledOnce();
      expect(executor.getWorksheetShowMeOptions).toHaveBeenCalledWith(
        expectedId,
        {},
        expect.any(AbortSignal),
      );
    },
  );

  it('returns native order, applicability, help links, and future tokens unchanged', async () => {
    const response = {
      ...defaultOptions,
      producerExtension: 'preserve-me',
      options: defaultOptions.options.map((option, index) => ({
        ...option,
        nativeOrdinal: index,
      })),
    } as ShowMeOptionsResult;

    const { result } = await invoke({ args: { worksheet: 'Sales by Region' }, response });

    expect(result.isError).toBe(false);
    expect(resultBody(result)).toEqual(response);
  });

  it.each([
    {
      label: 'ambient selection',
      args: { worksheet: 'Sales by Region' },
      expectedQuery: {},
    },
    {
      label: 'ambient selection with a datasource',
      args: { worksheet: 'Sales by Region', dataSource: 'federated.sales' },
      expectedQuery: { dataSource: 'federated.sales' },
    },
    {
      label: 'explicit empty selection',
      args: { worksheet: 'Sales by Region', fieldsSelectedInSchemaViewer: [] },
      expectedQuery: { fieldsSelectedInSchemaViewer: [] },
    },
    {
      label: 'ordered explicit fields',
      args: {
        worksheet: 'Sales by Region',
        dataSource: 'federated.sales',
        fieldsSelectedInSchemaViewer: ['[federated.sales].[Profit]', '[federated.sales].[Sales]'],
      },
      expectedQuery: {
        dataSource: 'federated.sales',
        fieldsSelectedInSchemaViewer: ['[federated.sales].[Profit]', '[federated.sales].[Sales]'],
      },
    },
  ])('preserves $label in the API query contract', async ({ args, expectedQuery }) => {
    const { executor } = await invoke({ args });

    expect(executor.getWorksheetShowMeOptions).toHaveBeenCalledWith(
      'sheet-sales',
      expectedQuery,
      expect.any(AbortSignal),
    );
  });

  it.each([
    {
      requested: 'Missing Sheet',
      worksheets: [worksheet('sheet-sales', 'Sales by Region')],
      expected: 'was not found',
    },
    {
      requested: 'Duplicate',
      worksheets: [worksheet('sheet-a', 'Duplicate'), worksheet('sheet-b', 'Duplicate')],
      expected: 'matched multiple worksheets',
    },
  ])(
    'fails unresolved worksheet "$requested" before calling discovery',
    async ({ requested, worksheets, expected }) => {
      const { result, executor } = await invoke({ args: { worksheet: requested }, worksheets });

      expect(result.isError).toBe(true);
      expect(resultText(result)).toContain(expected);
      expect(executor.getWorksheetShowMeOptions).not.toHaveBeenCalled();
    },
  );

  it('gives upgrade guidance and forbids retry when the discovery route is missing', async () => {
    const routeMissing: ExecuteCommandError = {
      type: 'command-failed',
      error: {
        code: 'not-found',
        message: 'No route matches GET /v0/workbook/worksheets/sheet-sales/showMe',
        recoverable: false,
      },
    };

    const { result } = await invoke({
      args: { worksheet: 'Sales by Region' },
      discoveryError: routeMissing,
    });

    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('Desktop build is too old');
    expect(resultText(result)).toContain('Desktop update enables it');
    expect(resultText(result)).toContain('Do not retry');
  });

  it('passes the request abort signal to inventory and discovery', async () => {
    const signal = new AbortController().signal;
    const { executor } = await invoke({ args: { worksheet: 'Sales by Region' }, signal });

    expect(executor.listWorksheets).toHaveBeenCalledWith(signal);
    expect(executor.getWorksheetShowMeOptions).toHaveBeenCalledWith('sheet-sales', {}, signal);
  });
});

async function invoke({
  args,
  worksheets = [worksheet('sheet-sales', 'Sales by Region')],
  response = defaultOptions,
  discoveryError,
  signal,
}: {
  args: ToolArgs;
  worksheets?: Array<ReturnType<typeof worksheet>>;
  response?: ShowMeOptionsResult;
  discoveryError?: ExecuteCommandError;
  signal?: AbortSignal;
}): Promise<{ result: CallToolResult; executor: ExternalApiToolExecutor }> {
  const listWorksheets = vi
    .fn<ExternalApiToolExecutor['listWorksheets']>()
    .mockResolvedValue(Ok({ worksheets }));
  const getWorksheetShowMeOptions = vi
    .fn<ExternalApiToolExecutor['getWorksheetShowMeOptions']>()
    .mockImplementation(async (_worksheetId, _query: ShowMeOptionsQuery) =>
      discoveryError ? Err(discoveryError) : Ok(response),
    );
  const executor = makeExecutorMock({ listWorksheets, getWorksheetShowMeOptions });
  const tool = getShowMeOptionsTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  const base = getMockRequestHandlerExtra();
  const extra = {
    ...base,
    getExecutor: vi
      .fn()
      .mockResolvedValue(executor) as unknown as TableauDesktopToolContext['getExecutor'],
    ...(signal === undefined ? {} : { signal }),
  };

  return {
    result: await callback(
      {
        session: args.session,
        worksheet: args.worksheet,
        dataSource: args.dataSource,
        fieldsSelectedInSchemaViewer: args.fieldsSelectedInSchemaViewer,
      },
      extra,
    ),
    executor,
  };
}

function worksheet(id: string, name: string): WorksheetItem {
  return { id, name, hidden: false, isActiveSheet: false };
}

function resultText(result: CallToolResult): string {
  invariant(result.content[0].type === 'text');
  return result.content[0].text;
}

function resultBody(result: CallToolResult): unknown {
  return JSON.parse(resultText(result));
}
