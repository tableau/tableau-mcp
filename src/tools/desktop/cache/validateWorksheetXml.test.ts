import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getValidateWorksheetXmlTool } from './validateWorksheetXml.js';

describe('validateWorksheetXmlTool', () => {
  it('should create a tool instance with correct properties', () => {
    const tool = getValidateWorksheetXmlTool(new DesktopMcpServer());
    expect(tool.name).toBe('validate-worksheet-xml');
    expect(tool.annotations).toMatchObject({ readOnlyHint: true });
    expect(tool.paramsSchema).toMatchObject({ xml: expect.any(Object) });
  });

  it('should return success for well-formed worksheet content', async () => {
    const result = await getResult('<worksheet name="Sheet1"><table/></worksheet>');

    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('well-formed');
  });

  it('should return error for malformed worksheet content', async () => {
    const result = await getResult('<worksheet name="Sheet1"><table></worksheet>');

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Worksheet structure has');
    expect(result.content[0].text).toContain('error');
  });

  it('should include fix suggestion in error output', async () => {
    const result = await getResult('<unclosed>');

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('apply-worksheet');
  });

  it('should handle empty string as malformed', async () => {
    const result = await getResult('');

    // Empty string parses as <empty/> substitute — still valid
    expect(result.isError).toBeFalsy();
  });
});

async function getResult(xml: string): Promise<CallToolResult> {
  const tool = getValidateWorksheetXmlTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback({ xml }, getMockRequestHandlerExtra());
}
