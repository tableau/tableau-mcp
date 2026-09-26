import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import * as sessionResolution from '../../../desktop/session/sessionResolution.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getDiagnosticsTool } from './getDiagnostics.js';

vi.mock('../../../desktop/session/sessionResolution.js');

const diagnostics = {
  worksheets: [
    { worksheetId: 'sheet-1', status: 'complete' as const, invalidFields: [] },
    {
      worksheetId: 'sheet-2',
      status: 'unavailable' as const,
      message: 'This worksheet was not checked.',
    },
  ],
};

describe('get-diagnostics tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('declares an optional worksheet target and explains when an explicit read is useful', async () => {
    const tool = getDiagnosticsTool(new DesktopMcpServer());
    const description = await Provider.from(tool.description);

    expect(tool.name).toBe('get-diagnostics');
    expect(tool.minApiVersion).toBe('0.2.16');
    expect(tool.paramsSchema).toMatchObject({
      session: expect.any(Object),
      worksheetName: expect.any(Object),
    });
    expect(description).toContain('Inspect the existing workbook before editing');
    expect(description).toContain(
      'Use diagnostics returned by supported workbook and worksheet document edits instead of a second read for the same result',
    );
    expect(description.toLowerCase()).not.toContain('screenshot');
    expect(tool.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it('reads whole-workbook diagnostics by default and pins the Desktop instance', async () => {
    const getWorkbookDiagnostics = vi.fn().mockResolvedValue(Ok(diagnostics));
    const controller = new AbortController();
    const extra = {
      ...getMockRequestHandlerExtra(),
      signal: controller.signal,
      getExecutor: vi.fn().mockResolvedValue({
        desktopInstanceId: 'inst-test',
        getWorkbookDiagnostics,
      }),
    };

    const result = await invokeTool({ session: undefined, worksheetName: undefined }, extra);

    expect(parseResult(result)).toEqual(diagnostics);
    expect(getWorkbookDiagnostics).toHaveBeenCalledExactlyOnceWith(controller.signal, 'inst-test');
  });

  it('resolves a worksheet name once, then reads diagnostics by exact stable id on the pinned instance', async () => {
    const listWorksheets = vi.fn().mockResolvedValue(
      Ok({
        worksheets: [
          { id: 'sheet-target', name: 'Sales', hidden: false },
          { id: 'sheet-decoy', name: 'Profit', hidden: false },
        ],
      }),
    );
    const targetDiagnostics = {
      worksheets: [{ worksheetId: 'sheet-target', status: 'complete' as const, invalidFields: [] }],
    };
    const getWorksheetDiagnostics = vi.fn().mockResolvedValue(Ok(targetDiagnostics));
    const controller = new AbortController();
    const extra = {
      ...getMockRequestHandlerExtra(),
      signal: controller.signal,
      getExecutor: vi.fn().mockResolvedValue({
        desktopInstanceId: 'inst-test',
        listWorksheets,
        getWorksheetDiagnostics,
      }),
    };

    const result = await invokeTool({ session: '999', worksheetName: 'Sales' }, extra);

    expect(parseResult(result)).toEqual(targetDiagnostics);
    expect(listWorksheets).toHaveBeenCalledExactlyOnceWith(controller.signal);
    expect(getWorksheetDiagnostics).toHaveBeenCalledExactlyOnceWith(
      'sheet-target',
      controller.signal,
      'inst-test',
    );
  });
});

async function invokeTool(
  args: { session: string | undefined; worksheetName: string | undefined },
  extra: ReturnType<typeof getMockRequestHandlerExtra>,
): Promise<CallToolResult> {
  const tool = getDiagnosticsTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(args, extra);
}

function parseResult(result: CallToolResult): typeof diagnostics {
  expect(result.isError).toBe(false);
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text) as typeof diagnostics;
}
