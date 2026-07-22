import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getFormatLabelsTool } from './formatLabels.js';

const BASE_XML = [
  "<?xml version='1.0' encoding='utf-8'?>",
  "<workbook version='18.1'>",
  '<datasources><datasource name="Sample - Superstore" /></datasources>',
  '<worksheets>',
  "<worksheet name='Profit'>",
  '<table>',
  '<style />',
  '<panes>',
  "<pane selection-relaxation-option='selection-relaxation-allow'>",
  '<view><breakdown value="auto" /></view>',
  "<mark class='Automatic' />",
  '</pane>',
  '</panes>',
  '</table>',
  '</worksheet>',
  '</worksheets>',
  '</workbook>',
].join('');

function labelsShown(xml: string, value: 'true' | 'false'): string {
  return xml.replace(
    "<pane selection-relaxation-option='selection-relaxation-allow'>",
    `<pane selection-relaxation-option='selection-relaxation-allow'><style><style-rule element='mark'><format attr='mark-labels-show' value='${value}' /></style-rule></style>`,
  );
}

describe('formatLabelsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('turns mark labels ON by inserting a pane style rule and verifies readback', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: { worksheet: 'Profit', showLabels: true },
      readbackXml: labelsShown(BASE_XML, 'true'),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text).worksheet).toBe('Profit');
    expect(JSON.parse(result.content[0].text).showLabels).toBe(true);

    const appliedXml = appliedDocumentXml(applyWorkbookDocument);
    expect(appliedXml).toContain("<format attr='mark-labels-show' value='true' />");
    // Exactly one rule — no duplicate style blocks.
    expect(appliedXml.match(/mark-labels-show/g)?.length).toBe(1);
  });

  it('rewrites an existing mark-labels rule (idempotent toggle to OFF)', async () => {
    const withOn = labelsShown(BASE_XML, 'true');
    const { result, applyWorkbookDocument } = await getToolResult({
      args: { worksheet: 'Profit', showLabels: false },
      initialXml: withOn,
      readbackXml: labelsShown(BASE_XML, 'false'),
    });

    expect(result.isError).toBe(false);
    const appliedXml = appliedDocumentXml(applyWorkbookDocument);
    expect(appliedXml).toContain("value='false'");
    // Still exactly one rule — rewritten, not appended.
    expect(appliedXml.match(/mark-labels-show/g)?.length).toBe(1);
  });

  it('rejects an unknown worksheet before loading metadata', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: { worksheet: 'Nope', showLabels: true },
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('was not found');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('rejects empty worksheet', async () => {
    const { result } = await getToolResult({ args: { worksheet: '', showLabels: true } });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('worksheet empty');
  });
});

type FormatLabelsArgs = { session?: string; worksheet: string; showLabels?: boolean };

async function getToolResult({
  args,
  initialXml = BASE_XML,
  readbackXml,
}: {
  args: FormatLabelsArgs;
  initialXml?: string;
  readbackXml?: string;
}): Promise<{
  result: CallToolResult;
  applyWorkbookDocument: ReturnType<typeof vi.fn>;
}> {
  const documents = [initialXml, readbackXml ?? initialXml];
  let readCount = 0;
  const executeCommand = vi
    .fn()
    .mockResolvedValue(new Ok({ command_id: 'command-1', status: 'completed', result: null }));
  const getWorkbookDocument = vi.fn(async () => {
    return new Ok({
      xml: documents[Math.min(readCount++, documents.length - 1)],
      applicationVersion: undefined,
      xsdPayloadVersion: undefined,
    });
  });
  const applyWorkbookDocument = vi.fn(async () => {
    return new Ok({ command_id: 'apply-1', status: 'completed', result: null });
  });
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: vi.fn().mockResolvedValue({
      executeCommand,
      getWorkbookDocument,
      applyWorkbookDocument,
    }),
  };
  const tool = getFormatLabelsTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);

  const result = await callback(
    { session: '12345', ...args, showLabels: args.showLabels ?? true },
    extra,
  );

  return { result, applyWorkbookDocument };
}

function appliedDocumentXml(applyWorkbookDocument: ReturnType<typeof vi.fn>): string {
  const [xml] = applyWorkbookDocument.mock.calls[0] ?? [];
  invariant(typeof xml === 'string');
  return xml;
}
