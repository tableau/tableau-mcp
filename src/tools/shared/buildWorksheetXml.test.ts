import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { getFileLogger } from '../../logging/fileLogger.js';
import { setNotificationLevel } from '../../logging/notification.js';
import { Server } from '../../server.js';
import { Provider } from '../../utils/provider.js';
import { getBuildWorksheetXmlTool } from './buildWorksheetXml.js';
import type { SharedRequestHandlerExtra } from './tool.js';

vi.mock('../../logging/fileLogger.js', () => ({ getFileLogger: vi.fn() }));

class TestServer extends Server {
  registerResources = async (): Promise<void> => {};
  registerTools = async (): Promise<void> => {};

  constructor() {
    super({ serverName: 'xml-test', serverVersion: '1.0.0' });
  }
}

const workbookXml =
  "<?xml version='1.0'?><workbook><datasources><datasource name='target.ds'>" +
  "<column name='[Revenue]' datatype='real' role='measure' type='quantitative'/>" +
  "<column name='[Profit]' datatype='real' role='measure' type='quantitative'/>" +
  '</datasource></datasources><worksheets/><windows/></workbook>';

const templateXml =
  "<?xml version='1.0'?><bookmark version='10.1'>" +
  "<datasources><datasource name='donor.ds'>" +
  "<column name='[Sales]' datatype='real' role='measure' type='quantitative'/>" +
  '</datasource></datasources>' +
  '<table><cols>[donor.ds].[sum:Sales:qk]</cols></table></bookmark>';

const args: {
  workbookXml: string;
  templateXml: string;
  templateName: string;
  title: string;
  datasource: string;
  fieldMapping: Record<string, string>;
} = {
  workbookXml,
  templateXml,
  templateName: 'offline-kpi',
  title: 'Total Revenue',
  datasource: 'target.ds',
  fieldMapping: { field_base_1: '[target.ds].[sum:Revenue:qk]' },
};

function extraFor(server: Server): SharedRequestHandlerExtra {
  return {
    server,
    signal: new AbortController().signal,
    requestId: 17,
    sendNotification: vi.fn(),
    sendRequest: vi.fn(),
  } as SharedRequestHandlerExtra;
}

async function callTool(input: typeof args): Promise<CallToolResult> {
  const server = new TestServer();
  const callback = await Provider.from(getBuildWorksheetXmlTool(server).callback);
  return callback({ ...input, derivationOverrides: undefined, topN: undefined }, extraFor(server));
}

function textBody(result: CallToolResult): string {
  expect(result.content[0].type).toBe('text');
  return result.content[0].type === 'text' ? result.content[0].text : '';
}

describe('build-worksheet-xml shared tool', () => {
  it('redacts supplied XML from file and MCP invocation logs while using it to build', async () => {
    const canary = 'private-connection-value-123';
    const input = {
      ...args,
      workbookXml: workbookXml.replace('</workbook>', `<!--${canary}--></workbook>`),
      templateXml: templateXml.replace('</bookmark>', `<!--${canary}--></bookmark>`),
    };
    const server = new TestServer();
    const fileLog = vi.fn();
    vi.mocked(getFileLogger).mockReturnValue({ log: fileLog } as never);
    setNotificationLevel(server.mcpServer, 'debug', { silent: true });
    const notification = vi.spyOn(server.mcpServer.server, 'notification').mockResolvedValue();
    try {
      const callback = await Provider.from(getBuildWorksheetXmlTool(server).callback);
      const result = await callback(
        { ...input, derivationOverrides: undefined, topN: undefined },
        extraFor(server),
      );

      expect(result.isError, textBody(result)).toBe(false);
      expect(JSON.parse(textBody(result)).worksheetXml).toContain('Revenue');
      expect(fileLog).toHaveBeenCalled();
      expect(notification).toHaveBeenCalled();
      expect(JSON.stringify(fileLog.mock.calls)).toContain('Total Revenue');
      expect(JSON.stringify(notification.mock.calls)).toContain('Total Revenue');
      expect(JSON.stringify(fileLog.mock.calls)).not.toContain(canary);
      expect(JSON.stringify(notification.mock.calls)).not.toContain(canary);
      expect(JSON.stringify(fileLog.mock.calls)).not.toContain(input.workbookXml);
      expect(JSON.stringify(notification.mock.calls)).not.toContain(input.templateXml);
    } finally {
      notification.mockRestore();
      vi.mocked(getFileLogger).mockReturnValue(undefined);
    }
  });

  it('builds worksheet and window XML using only supplied bytes and generic context', async () => {
    const result = await callTool(args);

    expect(result.isError).toBe(false);
    const body = JSON.parse(textBody(result));
    expect(body).toMatchObject({
      datasource: 'target.ds',
      bindings: [{ slotId: 'field_base_1', field: '[target.ds].[sum:Revenue:qk]' }],
    });
    expect(body.worksheetXml).toContain('Revenue');
    expect(body.worksheetXml).not.toMatch(/donor\.ds|\{\{/);
    expect(body.windowXml).toContain('Total Revenue');
    expect(body).not.toHaveProperty('artifactId');
    expect(body).not.toHaveProperty('sessionId');
    expect(body).not.toHaveProperty('instanceId');
  });

  it('returns a tool error for a mismatched workbook close and a wrong template root', async () => {
    const malformedWorkbook = await callTool({
      ...args,
      workbookXml: workbookXml.replace('</workbook>', '</different>'),
    });
    expect(malformedWorkbook.isError).toBe(true);
    expect(textBody(malformedWorkbook)).toContain('workbook XML is not well-formed');

    const wrongTemplateRoot = await callTool({
      ...args,
      templateXml: '<unrelated><table/></unrelated>',
    });
    expect(wrongTemplateRoot.isError).toBe(true);
    expect(textBody(wrongTemplateRoot)).toContain('bookmark XML must be well-formed');
  });

  it('preserves required binding diagnostics at the tool boundary', async () => {
    const result = await callTool({ ...args, fieldMapping: {} });

    expect(result.isError).toBe(true);
    expect(textBody(result)).toContain('fieldMapping must contain 1-32');
  });

  it('uses a fresh namespace for each callback invocation', async () => {
    const calcTemplate =
      "<?xml version='1.0'?><bookmark version='10.1'>" +
      "<datasources><datasource name='donor.ds'>" +
      "<column name='[Margin]' datatype='real' role='measure' type='quantitative'>" +
      "<calculation class='tableau' formula='[Profit] / [Revenue]'/></column>" +
      "<column name='[Profit]' datatype='real' role='measure' type='quantitative'/>" +
      "<column name='[Revenue]' datatype='real' role='measure' type='quantitative'/>" +
      '</datasource></datasources><table><view>' +
      '<datasources><datasource name="donor.ds"/></datasources>' +
      '<datasource-dependencies datasource="donor.ds">' +
      "<column name='[Profit]' datatype='real' role='measure' type='quantitative'/>" +
      "<column name='[Revenue]' datatype='real' role='measure' type='quantitative'/>" +
      "<column name='[Margin]' datatype='real' role='measure' type='quantitative'>" +
      "<calculation class='tableau' formula='[Profit] / [Revenue]'/></column>" +
      "<column-instance column='[Profit]' derivation='None' name='[none:Profit:nk]' pivot='key' type='quantitative'/>" +
      "<column-instance column='[Revenue]' derivation='None' name='[none:Revenue:nk]' pivot='key' type='quantitative'/>" +
      "<column-instance column='[Margin]' derivation='Sum' name='[sum:Margin:qk]' pivot='key' type='quantitative'/>" +
      '</datasource-dependencies></view>' +
      '<cols>[donor.ds].[sum:Margin:qk]</cols></table></bookmark>';
    const calcArgs = {
      ...args,
      templateXml: calcTemplate,
      fieldMapping: {
        field_base_1: '[target.ds].[none:Profit:nk]',
        field_base_2: '[target.ds].[none:Revenue:nk]',
      },
    };

    const first = await callTool(calcArgs);
    const second = await callTool(calcArgs);
    expect(first.isError, textBody(first)).toBe(false);
    expect(second.isError, textBody(second)).toBe(false);
    expect(JSON.parse(textBody(first)).worksheetXml).not.toBe(
      JSON.parse(textBody(second)).worksheetXml,
    );
  });
});
