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
import { getAddFieldToColsTool } from './addFieldToCols.js';

vi.mock('../../../desktop/metadata/index.js');
vi.mock('fs');

const resultSchema = z.object({
  message: z.string(),
  file: z.string(),
});

const WORKSHEET_FILE = '/cache/worksheet.xml';
const COLUMN_REF = '[Sample - Superstore].[none:Category:nk]';
const MODIFIED_XML = '<worksheet name="Sheet 1"><table></table></worksheet>';

describe('addFieldToColsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getAddFieldToColsTool(new DesktopMcpServer());
    expect(tool.name).toBe('add-field-to-cols');
    expect(tool.description).toContain('columns shelf');
    expect(tool.paramsSchema).toMatchObject({
      worksheetFile: expect.any(Object),
      columnRef: expect.any(Object),
      index: expect.any(Object),
      workbookFile: expect.any(Object),
    });
    expect(tool.annotations).toMatchObject({ readOnlyHint: false });
  });

  it('should return error when worksheet file does not exist', async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const result = await getResult({ worksheetFile: WORKSHEET_FILE, columnRef: COLUMN_REF });

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

    const result = await getResult({ worksheetFile: WORKSHEET_FILE, columnRef: COLUMN_REF });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new FileReadError(readError).message);
  });

  it('should return error when addFieldToCols throws', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<worksheet/>');
    vi.mocked(metadataModule.addFieldToCols).mockImplementation(() => {
      throw new Error('Invalid format');
    });

    const result = await getResult({ worksheetFile: WORKSHEET_FILE, columnRef: COLUMN_REF });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new XmlModificationError('Invalid format').message);
  });

  it('should write modified XML and return success', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<worksheet/>');
    vi.mocked(metadataModule.addFieldToCols).mockReturnValue(MODIFIED_XML);
    vi.mocked(writeFileSync).mockReturnValue(undefined);

    const result = await getResult({ worksheetFile: WORKSHEET_FILE, columnRef: COLUMN_REF });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(body.message).toContain('columns shelf');
    expect(body.file).toBe(WORKSHEET_FILE);
    expect(writeFileSync).toHaveBeenCalledWith(WORKSHEET_FILE, MODIFIED_XML, 'utf-8');
  });

  it('should pass index and workbookFile to addFieldToCols', async () => {
    const workbookFile = '/cache/workbook.xml';
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation((p) =>
      p === workbookFile ? '<workbook/>' : '<worksheet/>',
    );
    vi.mocked(metadataModule.addFieldToCols).mockReturnValue(MODIFIED_XML);
    vi.mocked(writeFileSync).mockReturnValue(undefined);

    await getResult({
      worksheetFile: WORKSHEET_FILE,
      columnRef: COLUMN_REF,
      index: 0,
      workbookFile,
    });

    expect(metadataModule.addFieldToCols).toHaveBeenCalledWith(
      '<worksheet/>',
      COLUMN_REF,
      0,
      '<workbook/>',
    );
  });
});

async function getResult({
  worksheetFile,
  columnRef,
  index,
  workbookFile,
}: {
  worksheetFile: string;
  columnRef: string;
  index?: number;
  workbookFile?: string;
}): Promise<CallToolResult> {
  const tool = getAddFieldToColsTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    { worksheetFile, columnRef, index, workbookFile },
    getMockRequestHandlerExtra(),
  );
}
