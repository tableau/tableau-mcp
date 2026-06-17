import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getValidateWorkbookXmlTool } from './validateWorkbookXml.js';

describe('validateWorkbookXmlTool', () => {
  it('should create a tool instance with correct properties', () => {
    const tool = getValidateWorkbookXmlTool(new DesktopMcpServer());
    expect(tool.name).toBe('validate-workbook-xml');
    expect(tool.annotations).toMatchObject({ readOnlyHint: true });
    expect(tool.paramsSchema).toMatchObject({ xml: expect.any(Object) });
  });

  it('should return success for well-formed XML', async () => {
    const result = await getResult(
      '<?xml version="1.0"?><workbook><worksheets/></workbook>',
    );

    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('well-formed');
  });

  it('should return error for malformed XML', async () => {
    const result = await getResult('<workbook><worksheets></workbook>');

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('malformed');
  });

  it('should include fix suggestion referencing apply-workbook', async () => {
    const result = await getResult('<bad xml');

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('apply-workbook');
  });

  it('should list numbered errors when multiple issues exist', async () => {
    const result = await getResult('<a><b></a></c>');

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toMatch(/\d+\./);
  });
});

async function getResult(xml: string): Promise<CallToolResult> {
  const tool = getValidateWorkbookXmlTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback({ xml }, getMockRequestHandlerExtra());
}
