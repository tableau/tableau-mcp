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
import { getAddFieldToEncodingTool } from './addFieldToEncoding.js';

vi.mock('../../../desktop/metadata/index.js');
vi.mock('fs');

const resultSchema = z.object({
  message: z.string(),
  file: z.string(),
});

const WORKSHEET_FILE = '/cache/worksheet.xml';
const WORKBOOK_FILE = '/cache/workbook.xml';
const COLUMN_REF = '[Sample - Superstore].[sum:Profit:qk]';
const MODIFIED_XML = '<worksheet name="Sheet 1"><table></table></worksheet>';

describe('addFieldToEncodingTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getAddFieldToEncodingTool(new DesktopMcpServer());
    expect(tool.name).toBe('add-field-to-encoding');
    expect(tool.description).toContain('Add a field to an encoding');
    expect(tool.paramsSchema).toMatchObject({
      worksheetFile: expect.any(Object),
      encodingType: expect.any(Object),
      columnRef: expect.any(Object),
      index: expect.any(Object),
      workbookFile: expect.any(Object),
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

  it('should return error when addFieldToEncoding throws', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<worksheet/>');
    vi.mocked(metadataModule.addFieldToEncoding).mockImplementation(() => {
      throw new Error('Invalid column ref');
    });

    const result = await getResult({
      worksheetFile: WORKSHEET_FILE,
      encodingType: 'color',
      columnRef: COLUMN_REF,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new XmlModificationError('Invalid column ref').message);
  });

  it('should return error when modified XML is not well-formed', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<worksheet/>');
    vi.mocked(metadataModule.addFieldToEncoding).mockReturnValue('<unclosed');

    const result = await getResult({
      worksheetFile: WORKSHEET_FILE,
      encodingType: 'color',
      columnRef: COLUMN_REF,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    // XmlValidationError message contains the validation error text
    expect(result.content[0].text).toContain('failed validation');
  });

  it('should write modified XML and return success', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<worksheet/>');
    vi.mocked(metadataModule.addFieldToEncoding).mockReturnValue(MODIFIED_XML);
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

  it('should pass optional workbookFile when it exists', async () => {
    vi.mocked(existsSync).mockImplementation((p) => p === WORKSHEET_FILE || p === WORKBOOK_FILE);
    vi.mocked(readFileSync).mockImplementation((p) =>
      p === WORKBOOK_FILE ? '<workbook/>' : '<worksheet/>',
    );
    vi.mocked(metadataModule.addFieldToEncoding).mockReturnValue(MODIFIED_XML);
    vi.mocked(writeFileSync).mockReturnValue(undefined);

    await getResult({
      worksheetFile: WORKSHEET_FILE,
      encodingType: 'color',
      columnRef: COLUMN_REF,
      workbookFile: WORKBOOK_FILE,
    });

    expect(metadataModule.addFieldToEncoding).toHaveBeenCalledWith(
      '<worksheet/>',
      'color',
      COLUMN_REF,
      undefined,
      '<workbook/>',
    );
  });

  it('should pass index to addFieldToEncoding when provided', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<worksheet/>');
    vi.mocked(metadataModule.addFieldToEncoding).mockReturnValue(MODIFIED_XML);
    vi.mocked(writeFileSync).mockReturnValue(undefined);

    await getResult({
      worksheetFile: WORKSHEET_FILE,
      encodingType: 'size',
      columnRef: COLUMN_REF,
      index: 1,
    });

    expect(metadataModule.addFieldToEncoding).toHaveBeenCalledWith(
      '<worksheet/>',
      'size',
      COLUMN_REF,
      1,
      undefined,
    );
  });
});

async function getResult({
  worksheetFile,
  encodingType,
  columnRef,
  index,
  workbookFile,
}: {
  worksheetFile: string;
  encodingType: 'color' | 'size' | 'lod' | 'detail' | 'text' | 'tooltip' | 'path' | 'angle';
  columnRef: string;
  index?: number;
  workbookFile?: string;
}): Promise<CallToolResult> {
  const tool = getAddFieldToEncodingTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    { worksheetFile, encodingType, columnRef, index, workbookFile },
    getMockRequestHandlerExtra(),
  );
}
