const { reopenFromStageMock, deriveStageSiblingPathMock } = vi.hoisted(() => ({
  reopenFromStageMock: vi.fn(),
  deriveStageSiblingPathMock: vi.fn(),
}));

vi.mock('../../../desktop/stageReopen.js', () => ({
  reopenFromStage: reopenFromStageMock,
  deriveStageSiblingPath: deriveStageSiblingPathMock,
}));

import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import { ExecuteCommandArgs, ToolExecutor } from '../../../desktop/toolExecutor/toolExecutor.js';
import { ArgsValidationError } from '../../../errors/mcpToolError.js';
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
let originalDesktopSessionId: string | undefined;
let originalExternalApiDiscoveryDir: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  originalDesktopSessionId = process.env.TABLEAU_DESKTOP_SESSION_ID;
  originalExternalApiDiscoveryDir = process.env.TABLEAU_EXTERNAL_API_DISCOVERY_DIR;
  delete process.env.TABLEAU_DESKTOP_SESSION_ID;
  tmp = mkdtempSync(join(tmpdir(), 'coda-param-'));
  reopenFromStageMock.mockResolvedValue(new Err(new ArgsValidationError('reopen not available')));
  deriveStageSiblingPathMock.mockResolvedValue(
    new Err(new ArgsValidationError('no derivable stage path')),
  );
});
afterEach(() => {
  restoreEnv('TABLEAU_DESKTOP_SESSION_ID', originalDesktopSessionId);
  restoreEnv('TABLEAU_EXTERNAL_API_DISCOVERY_DIR', originalExternalApiDiscoveryDir);
  vi.restoreAllMocks();
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

  it('returns reopened success, re-pins an existing session pin, and kills the old pid after readback verify', async () => {
    process.env.TABLEAU_DESKTOP_SESSION_ID = '12345';
    const stagePath = join(tmp, 'stage-reopened.twb');
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    reopenFromStageMock.mockResolvedValue(
      new Ok({ newPid: '67890', baseUrl: 'http://127.0.0.1:67890' }),
    );

    const { result, readbackExecuteCommand, getExecutor } = await getToolResult({
      args: { caption: 'p.Period', datatype: 'string', value: 'Month', stagePath },
      readbackXml: xmlWithParameterCaption('p.Period'),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toMatchObject({
      parameterName: '[Parameter 2]',
      caption: 'p.Period',
      stagePath,
      reopened: true,
      oldSession: '12345',
      newSession: '67890',
    });
    expect(parsed.reopenRequired).toBeUndefined();
    expect(process.env.TABLEAU_DESKTOP_SESSION_ID).toBe('67890');
    expect(reopenFromStageMock).toHaveBeenCalledWith({
      stagePath,
      oldPid: '12345',
      discoveryDir: join(tmp, 'discovery'),
    });
    expect(getExecutor).toHaveBeenCalledWith('67890');
    expect(kill).toHaveBeenCalledWith(12345, 'SIGTERM');
    expect(readbackExecuteCommand.mock.invocationCallOrder[0]).toBeLessThan(
      kill.mock.invocationCallOrder[0],
    );
  });

  it('derives a stage sibling path from the live workbook when stagePath is omitted', async () => {
    process.env.TABLEAU_DESKTOP_SESSION_ID = '12345';
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const derived = join(tmp, 'solfa-stage.param-stage-1.twb');
    deriveStageSiblingPathMock.mockResolvedValue(new Ok(derived));
    reopenFromStageMock.mockResolvedValue(
      new Ok({ newPid: '67890', baseUrl: 'http://127.0.0.1:67890' }),
    );

    const { result } = await getToolResult({
      args: { caption: 'p.Period', datatype: 'string', value: 'Month' },
      readbackXml: xmlWithParameterCaption('p.Period'),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toMatchObject({ reopened: true, stagePath: derived });
    expect(deriveStageSiblingPathMock).toHaveBeenCalledWith({ oldPid: '12345' });
    expect(readFileSync(derived, 'utf-8')).toContain("caption='p.Period'");
  });

  it('does not invent a session pin in unpinned mode after verified reopen', async () => {
    const stagePath = join(tmp, 'stage-unpinned.twb');
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    reopenFromStageMock.mockResolvedValue(
      new Ok({ newPid: '67890', baseUrl: 'http://127.0.0.1:67890' }),
    );

    const { result } = await getToolResult({
      args: { caption: 'p.Period', datatype: 'string', value: 'Month', stagePath },
      readbackXml: xmlWithParameterCaption('p.Period'),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.reopened).toBe(true);
    expect(process.env.TABLEAU_DESKTOP_SESSION_ID).toBeUndefined();
  });

  it('degrades to reopenRequired when reopen fails without changing env or killing the old pid', async () => {
    process.env.TABLEAU_DESKTOP_SESSION_ID = '12345';
    const stagePath = join(tmp, 'stage-reopen-failed.twb');
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    reopenFromStageMock.mockResolvedValue(new Err(new ArgsValidationError('launch timed out')));

    const { result } = await getToolResult({
      args: { caption: 'p.Period', datatype: 'string', value: 'Month', stagePath },
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toMatchObject({
      parameterName: '[Parameter 2]',
      caption: 'p.Period',
      stagePath,
      reopenRequired: true,
      reopenError: 'launch timed out',
    });
    expect(parsed.reopened).toBeUndefined();
    expect(process.env.TABLEAU_DESKTOP_SESSION_ID).toBe('12345');
    expect(kill).not.toHaveBeenCalled();
  });

  it('degrades to reopenRequired when readback lacks the new parameter caption', async () => {
    process.env.TABLEAU_DESKTOP_SESSION_ID = '12345';
    const stagePath = join(tmp, 'stage-readback-missing.twb');
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    reopenFromStageMock.mockResolvedValue(
      new Ok({ newPid: '67890', baseUrl: 'http://127.0.0.1:67890' }),
    );

    const { result } = await getToolResult({
      args: { caption: 'p.Period', datatype: 'string', value: 'Month', stagePath },
      readbackXml: XML_WITH_PARAMS_DS,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toMatchObject({
      parameterName: '[Parameter 2]',
      caption: 'p.Period',
      stagePath,
      reopenRequired: true,
      reopenError: 'reopened workbook did not contain parameter caption p.Period',
    });
    expect(parsed.reopened).toBeUndefined();
    expect(process.env.TABLEAU_DESKTOP_SESSION_ID).toBe('12345');
    expect(kill).not.toHaveBeenCalled();
  });
});

type AuthorParameterArgs = {
  session?: string;
  caption: string;
  datatype?: 'integer' | 'real' | 'string' | 'boolean' | 'date';
  value: string;
  members?: string[];
  stagePath?: string;
};

async function getToolResult({
  args,
  initialXml = XML_WITH_PARAMS_DS,
  readbackXml = XML_WITH_PARAMS_DS,
}: {
  args: AuthorParameterArgs;
  initialXml?: string;
  readbackXml?: string;
}): Promise<{
  result: CallToolResult;
  executeCommand: ReturnType<typeof vi.fn>;
  readbackExecuteCommand: ReturnType<typeof vi.fn>;
  getExecutor: ReturnType<typeof vi.fn>;
}> {
  process.env.TABLEAU_EXTERNAL_API_DISCOVERY_DIR = join(tmp, 'discovery');
  const executeCommand = vi.fn(async (params: ExecuteCommandArgs<undefined>) => {
    if (params.command === 'save-underlying-metadata') {
      return new Ok({ command_id: 'save-0', status: 'completed', parsedResult: { text: initialXml } });
    }
    return new Ok({ command_id: 'load-1', status: 'completed', result: null });
  });
  const readbackExecuteCommand = vi.fn(async (params: ExecuteCommandArgs<undefined>) => {
    if (params.command === 'save-underlying-metadata') {
      return new Ok({
        command_id: 'save-1',
        status: 'completed',
        parsedResult: { text: readbackXml },
      });
    }
    return new Ok({ command_id: 'load-2', status: 'completed', result: null });
  });
  const oldExecutor = mockExecutor(executeCommand);
  const readbackExecutor = mockExecutor(readbackExecuteCommand);
  const getExecutor = vi.fn(async (sessionId: string) =>
    sessionId === '67890' ? readbackExecutor : oldExecutor,
  );
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor,
  };
  const server = new DesktopMcpServer();
  (
    server as unknown as { mcpServer: { server: { notification: ReturnType<typeof vi.fn> } } }
  ).mcpServer = {
    server: { notification: vi.fn() },
  };
  const tool = getAuthorParameterTool(server);
  const callback = await Provider.from(tool.callback);

  const result = await callback(
    { session: '12345', ...args, datatype: args.datatype ?? 'integer' } as never,
    extra,
  );

  return { result, executeCommand, readbackExecuteCommand, getExecutor };
}

function xmlWithParameterCaption(caption: string): string {
  return XML_WITH_PARAMS_DS.replace(
    '</datasource>',
    `<column caption='${caption}' datatype='string' name='[Parameter 2]' param-domain-type='any' role='measure' type='nominal' value='&quot;Month&quot;'><calculation class='tableau' formula='&quot;Month&quot;' /></column></datasource>`,
  );
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

function mockExecutor(executeCommand: ReturnType<typeof vi.fn>): ToolExecutor {
  return {
    start: vi.fn(async () => undefined),
    stop: vi.fn(),
    isAvailable: vi.fn(() => true),
    executeCommand,
    getEvents: vi.fn(),
  } as unknown as ToolExecutor;
}
