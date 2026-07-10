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
import { getRemoveFieldFromRowsTool } from './removeFieldFromRows.js';

vi.mock('../../../desktop/metadata/index.js');
vi.mock('fs');

const resultSchema = z.object({
  message: z.string(),
  file: z.string(),
});

const WORKSHEET_FILE = '/cache/worksheet.xml';
const COLUMN_REF = '[Sample - Superstore].[sum:Profit:qk]';
const MODIFIED_XML = '<worksheet name="Sheet 1"><table></table></worksheet>';

describe('removeFieldFromRowsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getRemoveFieldFromRowsTool(new DesktopMcpServer());
    expect(tool.name).toBe('remove-field-from-rows');
    expect(tool.description).toContain('rows shelf');
    expect(tool.paramsSchema).toMatchObject({
      worksheetFile: expect.any(Object),
      columnRef: expect.any(Object),
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

  it('should return error when removeFieldFromRows throws', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<worksheet/>');
    vi.mocked(metadataModule.removeFieldFromRows).mockImplementation(() => {
      throw new Error('Column not found in rows');
    });

    const result = await getResult({ worksheetFile: WORKSHEET_FILE, columnRef: COLUMN_REF });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(
      new XmlModificationError('Column not found in rows').message,
    );
  });

  it('should write modified XML and return success', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<worksheet/>');
    vi.mocked(metadataModule.removeFieldFromRows).mockReturnValue(MODIFIED_XML);
    vi.mocked(writeFileSync).mockReturnValue(undefined);

    const result = await getResult({ worksheetFile: WORKSHEET_FILE, columnRef: COLUMN_REF });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(body.message).toContain('rows shelf');
    expect(body.file).toBe(WORKSHEET_FILE);
    expect(writeFileSync).toHaveBeenCalledWith(WORKSHEET_FILE, MODIFIED_XML, 'utf-8');
  });

  it('should pass arguments correctly to removeFieldFromRows', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<worksheet/>');
    vi.mocked(metadataModule.removeFieldFromRows).mockReturnValue(MODIFIED_XML);
    vi.mocked(writeFileSync).mockReturnValue(undefined);

    await getResult({ worksheetFile: WORKSHEET_FILE, columnRef: COLUMN_REF });

    expect(metadataModule.removeFieldFromRows).toHaveBeenCalledWith('<worksheet/>', COLUMN_REF);
  });
});

async function getResult({
  worksheetFile,
  columnRef,
}: {
  worksheetFile: string;
  columnRef: string;
}): Promise<CallToolResult> {
  const tool = getRemoveFieldFromRowsTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback({ worksheetFile, columnRef }, getMockRequestHandlerExtra());
}
