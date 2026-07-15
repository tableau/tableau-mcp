import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { z } from 'zod';

import * as metadataModule from '../../../desktop/metadata/index.js';
import {
  ArgsValidationError,
  FileNotFoundError,
  FileReadError,
  XmlModificationError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getRemoveFieldTool } from './removeField.js';

vi.mock('../../../desktop/metadata/index.js');
vi.mock('fs');

type EncodingType = 'color' | 'size' | 'lod' | 'detail' | 'text' | 'tooltip' | 'path' | 'angle';
type Target = 'rows' | 'cols' | 'encoding';

const resultSchema = z.object({
  message: z.string(),
  file: z.string(),
});

const WORKSHEET_FILE = '/cache/worksheet.xml';
const COLUMN_REF = '[Sample - Superstore].[sum:Profit:qk]';
const MODIFIED_XML = '<worksheet name="Sheet 1"><table></table></worksheet>';

describe('removeFieldTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getRemoveFieldTool(new DesktopMcpServer());
    expect(tool.name).toBe('remove-field');
    expect(tool.description).toContain('Rows, Columns, or an encoding');
    expect(tool.paramsSchema).toMatchObject({
      worksheetFile: expect.any(Object),
      target: expect.any(Object),
      columnRef: expect.any(Object),
      encodingType: expect.any(Object),
    });
    expect(tool.annotations).toMatchObject({ readOnlyHint: false });
  });

  it('should return error when worksheet file does not exist', async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const result = await getResult({
      worksheetFile: WORKSHEET_FILE,
      target: 'rows',
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
      target: 'rows',
      columnRef: COLUMN_REF,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new FileReadError(readError).message);
  });

  // --- target=rows (ported from removeFieldFromRows) ---
  it('should return error when removeFieldFromRows throws (target=rows)', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<worksheet/>');
    vi.mocked(metadataModule.removeFieldFromRows).mockImplementation(() => {
      throw new Error('Column not found in rows');
    });

    const result = await getResult({
      worksheetFile: WORKSHEET_FILE,
      target: 'rows',
      columnRef: COLUMN_REF,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(
      new XmlModificationError('Column not found in rows').message,
    );
  });

  it('should write modified XML and return success (target=rows)', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<worksheet/>');
    vi.mocked(metadataModule.removeFieldFromRows).mockReturnValue(MODIFIED_XML);
    vi.mocked(writeFileSync).mockReturnValue(undefined);

    const result = await getResult({
      worksheetFile: WORKSHEET_FILE,
      target: 'rows',
      columnRef: COLUMN_REF,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(body.message).toContain('Rows shelf');
    expect(body.file).toBe(WORKSHEET_FILE);
    expect(writeFileSync).toHaveBeenCalledWith(WORKSHEET_FILE, MODIFIED_XML, 'utf-8');
    expect(metadataModule.removeFieldFromRows).toHaveBeenCalledWith('<worksheet/>', COLUMN_REF);
  });

  it('does not use the Tableau command channel after a successful field edit', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<worksheet/>');
    vi.mocked(metadataModule.removeFieldFromRows).mockReturnValue(MODIFIED_XML);
    vi.mocked(writeFileSync).mockReturnValue(undefined);
    const extra = getMockRequestHandlerExtra();
    const tool = getRemoveFieldTool(new DesktopMcpServer());
    const callback = await Provider.from(tool.callback);

    const result = await callback(
      {
        worksheetFile: WORKSHEET_FILE,
        target: 'rows',
        columnRef: COLUMN_REF,
        encodingType: undefined,
      },
      extra,
    );

    expect(result.isError).toBe(false);
    expect(extra.getExecutor).not.toHaveBeenCalled();
  });

  // --- target=cols (ported from removeFieldFromCols) ---
  it('should return error when removeFieldFromCols throws (target=cols)', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<worksheet/>');
    vi.mocked(metadataModule.removeFieldFromCols).mockImplementation(() => {
      throw new Error('Column not found in cols');
    });

    const result = await getResult({
      worksheetFile: WORKSHEET_FILE,
      target: 'cols',
      columnRef: COLUMN_REF,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(
      new XmlModificationError('Column not found in cols').message,
    );
  });

  it('should write modified XML and return success (target=cols)', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<worksheet/>');
    vi.mocked(metadataModule.removeFieldFromCols).mockReturnValue(MODIFIED_XML);
    vi.mocked(writeFileSync).mockReturnValue(undefined);

    const result = await getResult({
      worksheetFile: WORKSHEET_FILE,
      target: 'cols',
      columnRef: COLUMN_REF,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(body.message).toContain('Columns shelf');
    expect(body.file).toBe(WORKSHEET_FILE);
    expect(writeFileSync).toHaveBeenCalledWith(WORKSHEET_FILE, MODIFIED_XML, 'utf-8');
    expect(metadataModule.removeFieldFromCols).toHaveBeenCalledWith('<worksheet/>', COLUMN_REF);
  });

  // --- target=encoding (ported from removeFieldFromEncoding) ---
  it('should return error when removeFieldFromEncoding throws (target=encoding)', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<worksheet/>');
    vi.mocked(metadataModule.removeFieldFromEncoding).mockImplementation(() => {
      throw new Error('Encoding not found');
    });

    const result = await getResult({
      worksheetFile: WORKSHEET_FILE,
      target: 'encoding',
      encodingType: 'color',
      columnRef: COLUMN_REF,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new XmlModificationError('Encoding not found').message);
  });

  it('should write modified XML and return success (target=encoding)', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<worksheet/>');
    vi.mocked(metadataModule.removeFieldFromEncoding).mockReturnValue(MODIFIED_XML);
    vi.mocked(writeFileSync).mockReturnValue(undefined);

    const result = await getResult({
      worksheetFile: WORKSHEET_FILE,
      target: 'encoding',
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

  it('should pass all arguments to removeFieldFromEncoding (target=encoding)', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<worksheet/>');
    vi.mocked(metadataModule.removeFieldFromEncoding).mockReturnValue(MODIFIED_XML);
    vi.mocked(writeFileSync).mockReturnValue(undefined);

    await getResult({
      worksheetFile: WORKSHEET_FILE,
      target: 'encoding',
      encodingType: 'size',
      columnRef: COLUMN_REF,
    });

    expect(metadataModule.removeFieldFromEncoding).toHaveBeenCalledWith(
      '<worksheet/>',
      'size',
      COLUMN_REF,
    );
  });

  // --- new conditional-param behavior (consolidation) ---
  it('errors clearly when encodingType is missing and target=encoding', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<worksheet/>');

    const result = await getResult({
      worksheetFile: WORKSHEET_FILE,
      target: 'encoding',
      columnRef: COLUMN_REF,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(
      new ArgsValidationError(
        'encodingType is required when target=encoding. Provide one of: color, size, lod, detail, text, tooltip, path, angle.',
      ).message,
    );
    expect(metadataModule.removeFieldFromEncoding).not.toHaveBeenCalled();
  });

  it('ignores encodingType for target=rows (routes to rows, not encoding)', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<worksheet/>');
    vi.mocked(metadataModule.removeFieldFromRows).mockReturnValue(MODIFIED_XML);
    vi.mocked(writeFileSync).mockReturnValue(undefined);

    const result = await getResult({
      worksheetFile: WORKSHEET_FILE,
      target: 'rows',
      encodingType: 'color',
      columnRef: COLUMN_REF,
    });

    expect(result.isError).toBe(false);
    expect(metadataModule.removeFieldFromRows).toHaveBeenCalledWith('<worksheet/>', COLUMN_REF);
    expect(metadataModule.removeFieldFromEncoding).not.toHaveBeenCalled();
  });

  it('ignores encodingType for target=cols (routes to cols, not encoding)', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<worksheet/>');
    vi.mocked(metadataModule.removeFieldFromCols).mockReturnValue(MODIFIED_XML);
    vi.mocked(writeFileSync).mockReturnValue(undefined);

    const result = await getResult({
      worksheetFile: WORKSHEET_FILE,
      target: 'cols',
      encodingType: 'size',
      columnRef: COLUMN_REF,
    });

    expect(result.isError).toBe(false);
    expect(metadataModule.removeFieldFromCols).toHaveBeenCalledWith('<worksheet/>', COLUMN_REF);
    expect(metadataModule.removeFieldFromEncoding).not.toHaveBeenCalled();
  });
});

async function getResult({
  worksheetFile,
  target,
  columnRef,
  encodingType,
}: {
  worksheetFile: string;
  target: Target;
  columnRef: string;
  encodingType?: EncodingType;
}): Promise<CallToolResult> {
  const tool = getRemoveFieldTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    { worksheetFile, target, columnRef, encodingType },
    getMockRequestHandlerExtra(),
  );
}
