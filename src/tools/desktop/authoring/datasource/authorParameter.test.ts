import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import { makeExecutorMock } from '../../../../desktop/externalApi/executor.mock.js';
import { ExternalApiToolExecutor } from '../../../../desktop/externalApi/externalApiToolExecutor.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
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

// A degenerate document that has no data source to host the dependency block.
const XML_ONLY_PARAMS_DS = [
  "<?xml version='1.0' encoding='utf-8'?>",
  "<workbook version='18.1'>",
  '<datasources>',
  "<datasource hasconnection='false' inline='true' name='Parameters' version='18.1'>",
  '<aliases enabled="yes" />',
  "<column caption='p.Top N' datatype='integer' name='[Parameter 1]' param-domain-type='any' role='measure' type='quantitative' value='5'><calculation class='tableau' formula='5' /></column>",
  '</datasource>',
  '</datasources>',
  '<worksheets><worksheet name="Sheet 1" /></worksheets>',
  '</workbook>',
].join('');

// A self-closing host datasource — the injector must reopen it around the dependency block.
const XML_SELF_CLOSING_HOST = [
  "<?xml version='1.0' encoding='utf-8'?>",
  "<workbook version='18.1'>",
  '<datasources>',
  "<datasource name='Sample - Superstore' />",
  '</datasources>',
  '<worksheets><worksheet name="Sheet 1" /></worksheets>',
  '</workbook>',
].join('');

// A host datasource that already carries a Parameters dependency block — the injector must
// append into it rather than create a second block.
const XML_EXISTING_DEP_BLOCK = [
  "<?xml version='1.0' encoding='utf-8'?>",
  "<workbook version='18.1'>",
  '<datasources>',
  "<datasource name='Sample - Superstore'>",
  "<datasource-dependencies datasource='Parameters'>",
  "<column caption='p.Existing' datatype='integer' name='[Parameter 9]' param-domain-type='any' role='measure' type='quantitative' value='1'><calculation class='tableau' formula='1' /></column>",
  '</datasource-dependencies>',
  '</datasource>',
  '</datasources>',
  '<worksheets><worksheet name="Sheet 1" /></worksheets>',
  '</workbook>',
].join('');

// Two non-Parameters datasources — the tool must ask which one hosts the parameter.
const XML_TWO_DATASOURCES = [
  "<?xml version='1.0' encoding='utf-8'?>",
  "<workbook version='18.1'>",
  '<datasources>',
  "<datasource name='Sales'></datasource>",
  "<datasource name='Returns'></datasource>",
  '</datasources>',
  '<worksheets><worksheet name="Sheet 1" /></worksheets>',
  '</workbook>',
].join('');

let originalDesktopSessionId: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  originalDesktopSessionId = process.env.TABLEAU_DESKTOP_SESSION_ID;
  delete process.env.TABLEAU_DESKTOP_SESSION_ID;
});
afterEach(() => {
  restoreEnv('TABLEAU_DESKTOP_SESSION_ID', originalDesktopSessionId);
  vi.restoreAllMocks();
});

describe('authorParameterTool', () => {
  it('creates a list parameter in place against the same session (no reopen)', async () => {
    process.env.TABLEAU_DESKTOP_SESSION_ID = '12345';
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);

    const { result, applyWorkbookDocument, getExecutor } = await getToolResult({
      args: {
        caption: 'p.Period',
        datatype: 'string',
        value: 'Month',
        members: ['Month', 'Quarter', 'Year'],
      },
      readbackXml: xmlWithParameterCaption('p.Period'),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toMatchObject({
      parameterName: '[Parameter 2]', // [Parameter 1] taken
      caption: 'p.Period',
      applied: 'in-place',
      session: '12345',
    });

    // The apply is in place: same session, no new instance, no SIGTERM.
    expect(getExecutor).toHaveBeenCalledWith('12345');
    expect(process.env.TABLEAU_DESKTOP_SESSION_ID).toBe('12345');
    expect(kill).not.toHaveBeenCalled();

    // The posted document carries the parameter as a dependency block hung off the real
    // datasource (the proven materialization shape), with the full list domain.
    expect(applyWorkbookDocument).toHaveBeenCalledOnce();
    const posted = applyWorkbookDocument.mock.calls[0][0] as string;
    expect(posted).toContain("<datasource-dependencies datasource='Parameters'>");
    expect(posted).toContain("caption='p.Period'");
    expect(posted).toContain("param-domain-type='list'");
    expect(posted).toContain("<member value='&quot;Quarter&quot;' />");
    expect(posted.indexOf("name='Sample - Superstore'")).toBeLessThan(
      posted.indexOf('<datasource-dependencies'),
    );
  });

  it('materializes via a dependency block only, without seeding a top-level Parameters datasource', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: { caption: 'p.Segment', datatype: 'integer', value: '10' },
      initialXml: XML_NO_PARAMS_DS,
      readbackXml: xmlWithParameterCaption('p.Segment'),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      caption: 'p.Segment',
      applied: 'in-place',
    });

    const posted = applyWorkbookDocument.mock.calls[0][0] as string;
    expect(posted).toContain("<datasource-dependencies datasource='Parameters'>");
    expect(posted).toContain("caption='p.Segment'");
    expect(posted).toContain("datatype-customized='true'");
    // Arm-3 shape: no separate top-level Parameters datasource is created.
    expect(posted).not.toContain("name='Parameters'");
  });

  it('rejects a caption collision without touching the live document', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: { caption: 'p.Top N', datatype: 'integer', value: '5' },
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('caption collision');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('rejects an empty caption', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: { caption: '', datatype: 'integer', value: '5' },
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('caption empty');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('errors when there is no data source to host the parameter', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: { caption: 'p.Period', datatype: 'string', value: 'Month' },
      initialXml: XML_ONLY_PARAMS_DS,
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('No non-Parameters datasource');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('reopens a self-closing host datasource around the dependency block', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: { caption: 'p.Region', datatype: 'integer', value: '1' },
      initialXml: XML_SELF_CLOSING_HOST,
      readbackXml: xmlWithParameterCaption('p.Region'),
    });

    expect(result.isError).toBe(false);
    const posted = applyWorkbookDocument.mock.calls[0][0] as string;
    // the self-closing tag is reopened (only the slash is stripped) and closed around the block
    expect(posted).not.toContain("<datasource name='Sample - Superstore' />");
    expect(posted).toContain(
      "<datasource name='Sample - Superstore' ><datasource-dependencies datasource='Parameters'>",
    );
    expect(posted).toContain("caption='p.Region'");
    expect(posted).toContain('</datasource-dependencies></datasource>');
  });

  it('appends to an existing Parameters dependency block instead of creating a second one', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: { caption: 'p.New', datatype: 'integer', value: '2' },
      initialXml: XML_EXISTING_DEP_BLOCK,
      readbackXml: xmlWithParameterCaption('p.New'),
    });

    expect(result.isError).toBe(false);
    const posted = applyWorkbookDocument.mock.calls[0][0] as string;
    // exactly one dependency block — the new column joined the existing one
    expect(posted.match(/<datasource-dependencies datasource='Parameters'>/g)).toHaveLength(1);
    expect(posted).toContain("caption='p.Existing'");
    expect(posted).toContain("caption='p.New'");
    // the new column lands after the pre-existing one, ahead of the single closing tag
    expect(posted.indexOf("caption='p.Existing'")).toBeLessThan(posted.indexOf("caption='p.New'"));
  });

  it('requires a datasource when multiple non-Parameters datasources exist', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: { caption: 'p.Period', datatype: 'string', value: 'Month' },
      initialXml: XML_TWO_DATASOURCES,
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Multiple datasources found');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('injects the dependency block onto the requested datasource', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: { caption: 'p.Period', datatype: 'string', value: 'Month', datasource: 'Returns' },
      initialXml: XML_TWO_DATASOURCES,
      readbackXml: xmlWithParameterCaption('p.Period'),
    });

    expect(result.isError).toBe(false);
    const posted = applyWorkbookDocument.mock.calls[0][0] as string;
    // the block hangs off the requested datasource, not the first candidate
    const salesOpen = posted.indexOf("name='Sales'");
    const returnsOpen = posted.indexOf("name='Returns'");
    const depBlock = posted.indexOf('<datasource-dependencies');
    expect(salesOpen).toBeLessThan(returnsOpen);
    expect(returnsOpen).toBeLessThan(depBlock);
  });

  it('errors when the readback does not contain the new parameter (did not materialize)', async () => {
    process.env.TABLEAU_DESKTOP_SESSION_ID = '12345';
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);

    const { result } = await getToolResult({
      args: { caption: 'p.Period', datatype: 'string', value: 'Month' },
      readbackXml: XML_WITH_PARAMS_DS, // no p.Period column
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('did not materialize');
    expect(process.env.TABLEAU_DESKTOP_SESSION_ID).toBe('12345');
    expect(kill).not.toHaveBeenCalled();
  });

  it('surfaces an error when the workbook apply is rejected', async () => {
    const { result } = await getToolResult({
      args: { caption: 'p.Period', datatype: 'string', value: 'Month' },
      applyResult: new Err({
        type: 'command-failed',
        error: { code: 'load-rejected', message: 'Qualified Name Parse Error', recoverable: false },
      }),
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).not.toContain('did not materialize');
  });
});

type AuthorParameterArgs = {
  session?: string;
  caption: string;
  datatype?: 'integer' | 'real' | 'string' | 'boolean' | 'date';
  value: string;
  members?: string[];
  datasource?: string;
};

async function getToolResult({
  args,
  initialXml = XML_WITH_PARAMS_DS,
  readbackXml = XML_WITH_PARAMS_DS,
  applyResult,
}: {
  args: AuthorParameterArgs;
  initialXml?: string;
  readbackXml?: string;
  applyResult?: Awaited<ReturnType<ExternalApiToolExecutor['applyWorkbookDocument']>>;
}): Promise<{
  result: CallToolResult;
  applyWorkbookDocument: ReturnType<typeof vi.fn>;
  getWorkbookDocument: ReturnType<typeof vi.fn>;
  getExecutor: ReturnType<typeof vi.fn>;
}> {
  let applied = false;
  const okApply: Awaited<ReturnType<ExternalApiToolExecutor['applyWorkbookDocument']>> = new Ok({
    command_id: 'apply-1',
    status: 'completed',
    submitted_at: '2026-08-20T00:00:00.000Z',
  });
  const applyWorkbookDocument = vi.fn(async (_xml: string) => {
    applied = true;
    return applyResult ?? okApply;
  });
  const getWorkbookDocument = vi.fn(
    async () =>
      new Ok({
        xml: applied ? readbackXml : initialXml,
        applicationVersion: undefined,
        xsdPayloadVersion: undefined,
      }),
  );
  const executor = makeExecutorMock({
    start: vi.fn(async () => undefined),
    stop: vi.fn(),
    isAvailable: vi.fn(() => true),
    executeCommand: vi
      .fn()
      .mockResolvedValue(new Ok({ command_id: 'command-1', status: 'completed', result: null })),
    getWorkbookDocument,
    applyWorkbookDocument,
  });
  const getExecutor = vi.fn(async () => executor);
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

  return { result, applyWorkbookDocument, getWorkbookDocument, getExecutor };
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
