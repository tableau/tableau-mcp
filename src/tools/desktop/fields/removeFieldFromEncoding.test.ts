import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { z } from 'zod';

import * as metadataModule from '../../../desktop/metadata/index.js';
import {
  FileNotFoundError,
  FileReadError,
  XmlModificationError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getRemoveFieldFromEncodingTool } from './removeFieldFromEncoding.js';

vi.mock('../../../desktop/metadata/index.js');
vi.mock('fs');

const resultSchema = z.object({
  message: z.string(),
  file: z.string(),
});

const WORKSHEET_FILE = '/cache/worksheet.xml';
const COLUMN_REF = '[Sample - Superstore].[sum:Profit:qk]';
const MODIFIED_XML = '<worksheet name="Sheet 1"><table></table></worksheet>';

describe('removeFieldFromEncodingTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getRemoveFieldFromEncodingTool(new DesktopMcpServer());
    expect(tool.name).toBe('remove-field-from-encoding');
    expect(tool.description).toContain('Remove a field from an encoding');
    expect(tool.paramsSchema).toMatchObject({
      worksheetFile: expect.any(Object),
      encodingType: expect.any(Object),
      columnRef: expect.any(Object),
    });
    expect(tool.annotations).toMatchObject({ readOnlyHint: false });
  });

  it('should return error when worksheet file does not exist', async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const result = await getResult({
      worksheetFile: WORKSHEET_FILE,
      encodingType: 'color',
      columnRef: COLUMN_REF,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new FileNotFoundError(WORKSHEET_FILE).message);
  });

  it('should return error when readFileSync throws', async () => {
    const readError = new Error('Permission denied');
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation(() => {
      throw readError;
    });

    const result = await getResult({
      worksheetFile: WORKSHEET_FILE,
      encodingType: 'color',
      columnRef: COLUMN_REF,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new FileReadError(readError).message);
  });

  it('should return error when removeFieldFromEncoding throws', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<worksheet/>');
    vi.mocked(metadataModule.removeFieldFromEncoding).mockImplementation(() => {
      throw new Error('Encoding not found');
    });

    const result = await getResult({
      worksheetFile: WORKSHEET_FILE,
      encodingType: 'color',
      columnRef: COLUMN_REF,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new XmlModificationError('Encoding not found').message);
  });

  it('should write modified XML and return success', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<worksheet/>');
    vi.mocked(metadataModule.removeFieldFromEncoding).mockReturnValue(MODIFIED_XML);
    vi.mocked(writeFileSync).mockReturnValue(undefined);

    const result = await getResult({
      worksheetFile: WORKSHEET_FILE,
      encodingType: 'color',
      columnRef: COLUMN_REF,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(body.message).toContain('color encoding');
    expect(body.file).toBe(WORKSHEET_FILE);
    expect(writeFileSync).toHaveBeenCalledWith(WORKSHEET_FILE, MODIFIED_XML, 'utf-8');
  });

  it('should pass all arguments to removeFieldFromEncoding', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<worksheet/>');
    vi.mocked(metadataModule.removeFieldFromEncoding).mockReturnValue(MODIFIED_XML);
    vi.mocked(writeFileSync).mockReturnValue(undefined);

    await getResult({ worksheetFile: WORKSHEET_FILE, encodingType: 'size', columnRef: COLUMN_REF });

    expect(metadataModule.removeFieldFromEncoding).toHaveBeenCalledWith(
      '<worksheet/>',
      'size',
      COLUMN_REF,
    );
  });
});

async function getResult({
  worksheetFile,
  encodingType,
  columnRef,
}: {
  worksheetFile: string;
  encodingType: 'color' | 'size' | 'lod' | 'detail' | 'text' | 'tooltip' | 'path' | 'angle';
  columnRef: string;
}): Promise<CallToolResult> {
  const tool = getRemoveFieldFromEncodingTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback({ worksheetFile, encodingType, columnRef }, getMockRequestHandlerExtra());
}
