import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import * as metadataModule from '../../../../desktop/metadata/index.js';
import * as sessionResolution from '../../../../desktop/session/sessionResolution.js';
import * as getWorkbookXmlModule from '../../../../desktop/wrappers/getWorkbookXml.js';
import { DesktopCommandExecutionError } from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { getSearchWorkbookFieldsTool } from './searchWorkbookFields.js';

vi.mock('../../../../desktop/metadata/index.js');
vi.mock('../../../../desktop/session/sessionResolution.js');
vi.mock('../../../../desktop/wrappers/getWorkbookXml.js');

const EMPTY_RESULT = {
  query: 'missing',
  totalMatches: 0,
  truncated: false,
  matches: [],
  usageScope: 'worksheet shelves and mark encodings only' as const,
};

describe('searchWorkbookFieldsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('4242'));
    vi.mocked(getWorkbookXmlModule.getWorkbookXml).mockResolvedValue(Ok('<workbook />'));
    vi.mocked(metadataModule.searchWorkbookFields).mockReturnValue(EMPTY_RESULT);
  });

  it('defines the bounded trimmed query contract and read-only annotations', async () => {
    const tool = getSearchWorkbookFieldsTool(new DesktopMcpServer());
    const schema = z.object(await Provider.from(tool.paramsSchema));

    expect(tool.name).toBe('search-workbook-fields');
    expect(tool.description).toContain('live open workbook');
    expect(tool.description).toContain('Rows, Columns, and Marks placements');
    expect(tool.description).toContain('no cached files or published content');
    expect(schema.parse({ query: '  Profit  ' })).toEqual({ query: 'Profit' });
    expect(() => schema.parse({ query: '   ' })).toThrow();
    expect(() => schema.parse({ query: 'Profit', limit: 101 })).toThrow();
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it('resolves the session, reads the workbook once with the abort signal, and defaults limit', async () => {
    const controller = new AbortController();
    const extra = {
      ...getMockRequestHandlerExtra(),
      signal: controller.signal,
      getExecutor: vi.fn().mockResolvedValue({}),
    };

    const result = await getResult({ session: 'desktop-2', query: 'missing' }, extra);

    expect(sessionResolution.resolveSession).toHaveBeenCalledWith('desktop-2');
    expect(extra.getExecutor).toHaveBeenCalledWith('4242');
    expect(getWorkbookXmlModule.getWorkbookXml).toHaveBeenCalledTimes(1);
    expect(getWorkbookXmlModule.getWorkbookXml).toHaveBeenCalledWith({
      executor: {},
      signal: controller.signal,
    });
    expect(metadataModule.searchWorkbookFields).toHaveBeenCalledWith('<workbook />', 'missing', 20);
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text)).toEqual(EMPTY_RESULT);
  });

  it('passes an explicit limit to the analyzer', async () => {
    await getResult({ query: 'profit', limit: 3 });

    expect(metadataModule.searchWorkbookFields).toHaveBeenCalledWith('<workbook />', 'profit', 3);
  });

  it('converts workbook read failures to DesktopCommandExecutionError', async () => {
    const error = {
      type: 'command-failed' as const,
      error: { code: 'read-failed', message: 'workbook read failed', recoverable: false },
    };
    vi.mocked(getWorkbookXmlModule.getWorkbookXml).mockResolvedValue(Err(error));

    const result = await getResult({ query: 'profit' });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new DesktopCommandExecutionError(error).message);
    expect(metadataModule.searchWorkbookFields).not.toHaveBeenCalled();
  });
});

async function getResult(
  args: { session?: string; query: string; limit?: number },
  extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: vi.fn().mockResolvedValue({}),
  },
): Promise<CallToolResult> {
  const tool = getSearchWorkbookFieldsTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  const paramsSchema = await Provider.from(tool.paramsSchema);
  const parsedArgs = z.object(paramsSchema).parse(args);
  return await callback(
    {
      session: parsedArgs.session,
      query: parsedArgs.query,
      limit: parsedArgs.limit,
    },
    extra,
  );
}
