import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import * as searchLibrary from '../../../desktop/search/searchLibrary.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getLookupWorkbookSchemaTool } from './lookupWorkbookSchema.js';

vi.mock('../../../desktop/search/searchLibrary.js');

describe('lookupWorkbookSchemaTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getLookupWorkbookSchemaTool(new DesktopMcpServer());
    expect(tool.name).toBe('lookup-workbook-schema');
    expect(tool.description).toContain('XSD schema');
    expect(tool.paramsSchema).toMatchObject({
      enumType: expect.any(Object),
      elementType: expect.any(Object),
      keywords: expect.any(Object),
      expandRefs: expect.any(Object),
    });
    expect(tool.annotations).toMatchObject({ readOnlyHint: true });
  });

  it('should return enum results as JSON when enumType is provided', async () => {
    vi.mocked(searchLibrary.searchWorkbookSchema).mockReturnValue({
      enums: [{ name: 'PrimitiveType-ST', values: ['integer', 'string'] }],
      elements: [],
    });

    const result = await getResult({ enumType: 'PrimitiveType-ST' });

    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.enums).toHaveLength(1);
    expect(parsed.enums[0].name).toBe('PrimitiveType-ST');
  });

  it('should return element results when elementType is provided', async () => {
    vi.mocked(searchLibrary.searchWorkbookSchema).mockReturnValue({
      enums: [],
      elements: [{ name: 'Zone-G', parentPaths: ['workbook > dashboard > zone'] }],
    });

    const result = await getResult({ elementType: 'Zone-G' });

    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.elements[0].name).toBe('Zone-G');
  });

  it('should return hint when no matches found', async () => {
    vi.mocked(searchLibrary.searchWorkbookSchema).mockReturnValue({
      enums: [],
      elements: [],
      hint: 'No matches found. Try broader keywords.',
    });

    const result = await getResult({ keywords: ['nonexistent'] });

    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.hint).toContain('No matches found');
  });

  it('should pass all arguments to searchWorkbookSchema', async () => {
    vi.mocked(searchLibrary.searchWorkbookSchema).mockReturnValue({ enums: [], elements: [] });

    await getResult({
      enumType: 'MyEnum',
      elementType: 'Zone-G',
      keywords: ['zone', 'dashboard'],
      expandRefs: true,
    });

    expect(searchLibrary.searchWorkbookSchema).toHaveBeenCalledWith({
      enumType: 'MyEnum',
      elementType: 'Zone-G',
      keywords: ['zone', 'dashboard'],
      expandRefs: true,
    });
  });

  it('should pass undefined optional args when not provided', async () => {
    vi.mocked(searchLibrary.searchWorkbookSchema).mockReturnValue({ enums: [], elements: [] });

    await getResult({});

    expect(searchLibrary.searchWorkbookSchema).toHaveBeenCalledWith({
      enumType: undefined,
      elementType: undefined,
      keywords: undefined,
      expandRefs: undefined,
    });
  });
});

async function getResult({
  enumType,
  elementType,
  keywords,
  expandRefs,
}: {
  enumType?: string;
  elementType?: string;
  keywords?: string[];
  expandRefs?: boolean;
}): Promise<CallToolResult> {
  const tool = getLookupWorkbookSchemaTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback({ enumType, elementType, keywords, expandRefs }, getMockRequestHandlerExtra());
}
