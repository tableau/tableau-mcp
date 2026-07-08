import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync } from 'fs';
import { z } from 'zod';

import * as metadataModule from '../../../desktop/metadata/index.js';
import { FileNotFoundError, FileReadError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getListAvailableFieldsTool } from './listAvailableFields.js';

vi.mock('../../../desktop/metadata/index.js');
vi.mock('fs');

const resultSchema = z.object({
  message: z.string(),
  fields: z.array(z.any()),
});

const mockFields = [
  {
    datasource: 'Sample - Superstore',
    columnName: '[Profit]',
    columnInstanceName: '[sum:Profit:qk]',
    derivation: 'Sum',
    type: 'quantitative',
    role: 'measure',
    datatype: 'real',
    caption: undefined,
    isAggregated: false,
    column_ref: '[Sample - Superstore].[sum:Profit:qk]',
  },
  {
    datasource: 'Sample - Superstore',
    columnName: '[Category]',
    columnInstanceName: '[none:Category:nk]',
    derivation: 'None',
    type: 'nominal',
    role: 'dimension',
    datatype: 'string',
    caption: undefined,
    isAggregated: false,
    column_ref: '[Sample - Superstore].[none:Category:nk]',
  },
];

describe('listAvailableFieldsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getListAvailableFieldsTool(new DesktopMcpServer());
    expect(tool.name).toBe('list-available-fields');
    expect(tool.description).toContain('List ALL fields available in workbook datasources');
    expect(tool.paramsSchema).toMatchObject({ workbookFile: expect.any(Object) });
    expect(tool.annotations).toMatchObject({
      title: 'List All Available Fields in Workbook Datasources',
      readOnlyHint: true,
    });
  });

  it('should return error when workbook file does not exist', async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const result = await getResult({ workbookFile: '/missing/workbook.xml' });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new FileNotFoundError('/missing/workbook.xml').message);
  });

  it('should return error when readFileSync throws', async () => {
    const readError = new Error('Permission denied');
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation(() => {
      throw readError;
    });

    const result = await getResult({ workbookFile: '/workbook.xml' });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new FileReadError(readError).message);
  });

  it('should return formatted fields when fields are found', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<workbook/>');
    vi.mocked(metadataModule.listAvailableFields).mockReturnValue(mockFields as any);

    const result = await getResult({ workbookFile: '/workbook.xml' });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(body.message).toContain('Found 2 fields in "Sample - Superstore"');
    expect(body.message).toContain('DIMENSIONS');
    expect(body.message).toContain('MEASURES');
    expect(body.fields).toHaveLength(2);
  });

  it('should return empty message when no fields are found', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<workbook/>');
    vi.mocked(metadataModule.listAvailableFields).mockReturnValue([]);

    const result = await getResult({ workbookFile: '/workbook.xml' });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(body.message).toContain('No fields found');
    expect(body.fields).toHaveLength(0);
  });
});

async function getResult({ workbookFile }: { workbookFile: string }): Promise<CallToolResult> {
  const tool = getListAvailableFieldsTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback({ workbookFile }, getMockRequestHandlerExtra());
}
