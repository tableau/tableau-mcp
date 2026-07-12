import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync } from 'fs';
import { z } from 'zod';

import * as metadataModule from '../../../desktop/metadata/index.js';
import { FileNotFoundError, FileReadError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getListFieldsTool } from './listFields.js';

vi.mock('../../../desktop/metadata/index.js');
vi.mock('fs');

const resultSchema = z.object({
  message: z.string(),
  fields: z.array(z.any()),
});

describe('listFieldsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getListFieldsTool(new DesktopMcpServer());
    expect(tool.name).toBe('list-fields');
    expect(tool.description).toContain('already placed');
    expect(tool.paramsSchema).toMatchObject({ worksheetFile: expect.any(Object) });
    expect(tool.annotations).toMatchObject({ readOnlyHint: true });
  });

  it('should return error when worksheet file does not exist', async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const result = await getResult({ worksheetFile: '/missing/worksheet.xml' });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new FileNotFoundError('/missing/worksheet.xml').message);
  });

  it('should return error when readFileSync throws', async () => {
    const readError = new Error('Permission denied');
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation(() => {
      throw readError;
    });

    const result = await getResult({ worksheetFile: '/worksheet.xml' });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new FileReadError(readError).message);
  });

  it('should return empty message when no fields are on the worksheet', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<worksheet/>');
    vi.mocked(metadataModule.listFields).mockReturnValue([]);

    const result = await getResult({ worksheetFile: '/worksheet.xml' });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(body.message).toContain('No fields found');
    expect(body.fields).toHaveLength(0);
  });

  it('should return grouped fields by location', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<worksheet/>');
    vi.mocked(metadataModule.listFields).mockReturnValue([
      { location: 'rows', column: '[Sample - Superstore].[sum:Profit:qk]', index: 0 },
      {
        location: 'encodings',
        encodingType: 'color',
        column: '[Sample - Superstore].[none:Category:nk]',
        index: 0,
      },
    ] as any);

    const result = await getResult({ worksheetFile: '/worksheet.xml' });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(body.message).toContain('Found 2 field(s)');
    expect(body.message).toContain('Rows:');
    expect(body.message).toContain('encodings:color:');
    expect(body.fields).toHaveLength(2);
  });
});

async function getResult({ worksheetFile }: { worksheetFile: string }): Promise<CallToolResult> {
  const tool = getListFieldsTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback({ worksheetFile }, getMockRequestHandlerExtra());
}
