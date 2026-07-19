import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { ExecuteCommandArgs } from '../../../desktop/toolExecutor/toolExecutor.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getAuthorParameterTool } from './authorParameter.js';

const XML_WITH_PARAMS_DS = [
  "<?xml version='1.0' encoding='utf-8'?>",
  "<workbook version='18.1'>",
  '<datasources>',
  "<datasource hasconnection='false' inline='true' name='Parameters' version='18.1'>",
  '<aliases enabled="yes" />',
  "<column caption='p.Top N' datatype='integer' name='[Parameter 1]' param-domain-type='any' role='measure' type='quantitative' value='5'><calculation class='tableau' formula='5' /></column>",
  '</datasource>',
  "<datasource name='Sample - Superstore'></datasource>",
  '</datasources>',
  '<worksheets><worksheet name="Sheet 1" /></worksheets>',
  '</workbook>',
].join('');

const XML_NO_PARAMS_DS = [
  "<?xml version='1.0' encoding='utf-8'?>",
  "<workbook version='18.1'>",
  '<datasources>',
  "<datasource name='Sample - Superstore'></datasource>",
  '</datasources>',
  '<worksheets><worksheet name="Sheet 1" /></worksheets>',
  '</workbook>',
].join('');

let tmp: string;
beforeEach(() => {
  vi.clearAllMocks();
  tmp = mkdtempSync(join(tmpdir(), 'coda-param-'));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('authorParameterTool', () => {
  it('seeds a list parameter into the existing Parameters ds and writes a reopen-ready stage', async () => {
    const stagePath = join(tmp, 'stage.twb');
    const { result } = await getToolResult({
      args: {
        caption: 'p.Period',
        datatype: 'string',
        value: 'Month',
        members: ['Month', 'Quarter', 'Year'],
        stagePath,
      },
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.parameterName).toBe('[Parameter 2]'); // [Parameter 1] taken
    expect(parsed.caption).toBe('p.Period');
    expect(parsed.reopenRequired).toBe(true);
    expect(parsed.stagePath).toBe(stagePath);

    const written = readFileSync(stagePath, 'utf-8');
    expect(written).toContain("caption='p.Period'");
    expect(written).toContain("param-domain-type='list'");
    expect(written).toContain("value='&quot;Month&quot;'");
    expect(written).toContain("<member value='&quot;Quarter&quot;' />");
    // The prior parameter is preserved.
    expect(written).toContain("name='[Parameter 1]'");
  });

  it('creates the Parameters datasource when the document has none', async () => {
    const stagePath = join(tmp, 'stage2.twb');
    const { result } = await getToolResult({
      args: { caption: 'p.Top N', datatype: 'integer', value: '10', stagePath },
      initialXml: XML_NO_PARAMS_DS,
    });

    expect(result.isError).toBe(false);
    const written = readFileSync(stagePath, 'utf-8');
    expect(written).toContain("name='Parameters'");
    expect(written).toContain("caption='p.Top N'");
    expect(written).toContain("value='10'");
    expect(written).toContain("datatype-customized='true'");
    // Parameters ds is spliced right after <datasources> open, before Superstore.
    expect(written.indexOf("name='Parameters'")).toBeLessThan(
      written.indexOf("name='Sample - Superstore'"),
    );
  });

  it('rejects a caption collision (parameter already exists)', async () => {
    const stagePath = join(tmp, 'nope.twb');
    const { result } = await getToolResult({
      args: { caption: 'p.Top N', datatype: 'integer', value: '5', stagePath },
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('caption collision');
  });

  it('rejects empty caption', async () => {
    const { result } = await getToolResult({
      args: { caption: '', datatype: 'integer', value: '5', stagePath: join(tmp, 'x.twb') },
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('caption empty');
  });
});

type AuthorParameterArgs = {
  session?: string;
  caption: string;
  datatype?: 'integer' | 'real' | 'string' | 'boolean' | 'date';
  value: string;
  members?: string[];
  stagePath: string;
};

async function getToolResult({
  args,
  initialXml = XML_WITH_PARAMS_DS,
}: {
  args: AuthorParameterArgs;
  initialXml?: string;
}): Promise<{ result: CallToolResult; executeCommand: ReturnType<typeof vi.fn> }> {
  const executeCommand = vi.fn(async (params: ExecuteCommandArgs<undefined>) => {
    if (params.command === 'save-underlying-metadata') {
      return new Ok({ command_id: 'save-0', status: 'completed', parsedResult: { text: initialXml } });
    }
    return new Ok({ command_id: 'load-1', status: 'completed', result: null });
  });
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: vi.fn().mockResolvedValue({ executeCommand }),
  };
  const tool = getAuthorParameterTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);

  const result = await callback(
    { session: '12345', ...args, datatype: args.datatype ?? 'integer' } as never,
    extra,
  );

  return { result, executeCommand };
}
