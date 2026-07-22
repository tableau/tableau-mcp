import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import * as configModule from '../../../config.desktop.js';
import * as cacheFingerprintModule from '../../../desktop/commands/workbook/cacheFingerprint.js';
import * as getWorksheetXmlModule from '../../../desktop/commands/workbook/getWorksheetXml.js';
import * as discoveryModule from '../../../desktop/externalApi/discovery.js';
import * as metadataModule from '../../../desktop/metadata/index.js';
import {
  ArgsValidationError,
  FileNotFoundError,
  FileReadError,
  GetWorksheetXmlFailedError,
  XmlModificationError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getAddFieldTool } from './addField.js';

vi.mock('../../../desktop/metadata/index.js');
vi.mock('../../../desktop/commands/workbook/cacheFingerprint.js');
vi.mock('../../../desktop/commands/workbook/getWorksheetXml.js');
vi.mock('../../../desktop/externalApi/discovery.js');
vi.mock('fs');

type EncodingType = 'color' | 'size' | 'lod' | 'detail' | 'text' | 'tooltip' | 'path' | 'angle';
type Target = 'rows' | 'cols' | 'encoding';

const resultSchema = z.object({
  message: z.string(),
  file: z.string(),
});

const WORKSHEET_FILE = '/cache/worksheet.xml';
const SESSION = '12345';
const WORKBOOK_FILE = '/cache/workbook.xml';

function mockPinnedSession(desktopSessionId: string | undefined): void {
  const base = new configModule.Config();
  vi.spyOn(configModule, 'getDesktopConfig').mockReturnValue({
    ...base,
    desktopSessionId,
  } as configModule.Config);
}
const COLUMN_REF = '[Sample - Superstore].[sum:Profit:qk]';
const MODIFIED_XML = '<worksheet name="Sheet 1"><table></table></worksheet>';

describe('addFieldTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPinnedSession(undefined);
    vi.mocked(discoveryModule.discoverInstances).mockReturnValue([]);
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getAddFieldTool(new DesktopMcpServer());
    expect(tool.name).toBe('add-field');
    expect(tool.description).toBe(
      'Place a field on a shelf (rows/cols/encoding); the manual path when no template binds.',
    );
    expect(tool.paramsSchema).toMatchObject({
      session: expect.any(Object),
      worksheetName: expect.any(Object),
      worksheetFile: expect.any(Object),
      target: expect.any(Object),
      columnRef: expect.any(Object),
      encodingType: expect.any(Object),
      index: expect.any(Object),
      workbookFile: expect.any(Object),
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

  // --- target=rows (ported from addFieldToRows) ---
  it('should return error when addFieldToRows throws (target=rows)', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<worksheet/>');
    vi.mocked(metadataModule.addFieldToRows).mockImplementation(() => {
      throw new Error('Invalid format');
    });

    const result = await getResult({
      worksheetFile: WORKSHEET_FILE,
      target: 'rows',
      columnRef: COLUMN_REF,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new XmlModificationError('Invalid format').message);
  });

  it('should write modified XML and return success (target=rows)', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<worksheet/>');
    vi.mocked(metadataModule.addFieldToRows).mockReturnValue(MODIFIED_XML);
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
  });

  it('writes a fingerprint sidecar after updating the worksheet cache file', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<worksheet/>');
    vi.mocked(metadataModule.addFieldToRows).mockReturnValue(MODIFIED_XML);
    vi.mocked(writeFileSync).mockReturnValue(undefined);

    await getResult({ worksheetFile: WORKSHEET_FILE, target: 'rows', columnRef: COLUMN_REF });

    expect(cacheFingerprintModule.writeSidecar).toHaveBeenCalledWith(WORKSHEET_FILE, SESSION);
  });

  it('stamps the sidecar with the pinned session, not the requested one', async () => {
    mockPinnedSession(SESSION);
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<worksheet/>');
    vi.mocked(metadataModule.addFieldToRows).mockReturnValue(MODIFIED_XML);
    vi.mocked(writeFileSync).mockReturnValue(undefined);

    await getResult({
      worksheetFile: WORKSHEET_FILE,
      target: 'rows',
      columnRef: COLUMN_REF,
      session: undefined,
    });

    expect(cacheFingerprintModule.writeSidecar).toHaveBeenCalledWith(WORKSHEET_FILE, SESSION);
  });

  it('rejects and writes no sidecar when the requested session is not a running instance', async () => {
    mockPinnedSession('99999');
    vi.mocked(discoveryModule.discoverInstances).mockReturnValue([
      { pid: 99999 } as ReturnType<typeof discoveryModule.discoverInstances>[number],
    ]);
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<worksheet/>');
    vi.mocked(metadataModule.addFieldToRows).mockReturnValue(MODIFIED_XML);
    vi.mocked(writeFileSync).mockReturnValue(undefined);

    const result = await getResult({
      worksheetFile: WORKSHEET_FILE,
      target: 'rows',
      columnRef: COLUMN_REF,
      session: SESSION,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(SESSION);
    expect(result.content[0].text).toContain('list-instances');
    expect(cacheFingerprintModule.writeSidecar).not.toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it('does not use the Tableau command channel after a successful field edit', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<worksheet/>');
    vi.mocked(metadataModule.addFieldToRows).mockReturnValue(MODIFIED_XML);
    vi.mocked(writeFileSync).mockReturnValue(undefined);
    const extra = getMockRequestHandlerExtra();
    const tool = getAddFieldTool(new DesktopMcpServer());
    const callback = await Provider.from(tool.callback);

    const result = await callback(
      {
        session: SESSION,
        worksheetName: undefined,
        worksheetFile: WORKSHEET_FILE,
        target: 'rows',
        columnRef: COLUMN_REF,
        encodingType: undefined,
        index: undefined,
        workbookFile: undefined,
      },
      extra,
    );

    expect(result.isError).toBe(false);
    expect(extra.getExecutor).not.toHaveBeenCalled();
  });

  // --- name-based path (no prior get-worksheet-xml call) ---
  it('fetches + caches the sheet by name when no worksheetFile is given, then edits it', async () => {
    const FRAGMENT = '<worksheet name="Sheet 1"><table/></worksheet>';
    vi.mocked(getWorksheetXmlModule.getWorksheetFragment).mockResolvedValue(Ok(FRAGMENT));
    // The minted cache file exists after the internal write; the edit reads it back.
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(FRAGMENT);
    vi.mocked(metadataModule.addFieldToRows).mockReturnValue(MODIFIED_XML);
    vi.mocked(writeFileSync).mockReturnValue(undefined);

    const result = await getResult({
      worksheetName: 'Sheet 1',
      target: 'rows',
      columnRef: COLUMN_REF,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(body.message).toContain('Rows shelf');
    // The fetch happened, and the minted cache path (worksheet-Sheet_1-*) is returned so
    // follow-up edits can pass it as worksheetFile.
    expect(getWorksheetXmlModule.getWorksheetFragment).toHaveBeenCalledWith(
      expect.objectContaining({ worksheetName: 'Sheet 1' }),
    );
    expect(body.file).toMatch(/worksheet-Sheet_1-/);
    // The minted fragment was written to the cache before the field edit.
    expect(writeFileSync).toHaveBeenCalledWith(body.file, FRAGMENT, 'utf-8');
    // ...and the modified XML was written back to the same path.
    expect(writeFileSync).toHaveBeenCalledWith(body.file, MODIFIED_XML, 'utf-8');
  });

  it('surfaces a fetch error (unknown worksheet) without writing anything', async () => {
    const fetchErr = {
      type: 'get-worksheet-xml-error' as const,
      error: { type: 'no-worksheet-found' as const, message: 'No worksheet found for Ghost.' },
    };
    vi.mocked(getWorksheetXmlModule.getWorksheetFragment).mockResolvedValue(Err(fetchErr));

    const result = await getResult({
      worksheetName: 'Ghost',
      target: 'rows',
      columnRef: COLUMN_REF,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new GetWorksheetXmlFailedError(fetchErr.error).message);
    expect(writeFileSync).not.toHaveBeenCalled();
    expect(metadataModule.addFieldToRows).not.toHaveBeenCalled();
  });

  it('errors when neither worksheetName nor worksheetFile is provided', async () => {
    const result = await getResult({ target: 'rows', columnRef: COLUMN_REF });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(
      new ArgsValidationError(
        'Provide either worksheetName (to edit an existing sheet) or worksheetFile (a cached path).',
      ).message,
    );
    expect(getWorksheetXmlModule.getWorksheetFragment).not.toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it('prefers worksheetFile over worksheetName when both are given (no fetch)', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<worksheet/>');
    vi.mocked(metadataModule.addFieldToRows).mockReturnValue(MODIFIED_XML);
    vi.mocked(writeFileSync).mockReturnValue(undefined);

    const result = await getResult({
      worksheetName: 'Sheet 1',
      worksheetFile: WORKSHEET_FILE,
      target: 'rows',
      columnRef: COLUMN_REF,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(resultSchema.parse(JSON.parse(result.content[0].text)).file).toBe(WORKSHEET_FILE);
    // worksheetFile is authoritative — the name-based fetch must not run.
    expect(getWorksheetXmlModule.getWorksheetFragment).not.toHaveBeenCalled();
  });

  it('should pass index and workbookFile to addFieldToRows (target=rows)', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation((p) =>
      p === WORKBOOK_FILE ? '<workbook/>' : '<worksheet/>',
    );
    vi.mocked(metadataModule.addFieldToRows).mockReturnValue(MODIFIED_XML);
    vi.mocked(writeFileSync).mockReturnValue(undefined);

    await getResult({
      worksheetFile: WORKSHEET_FILE,
      target: 'rows',
      columnRef: COLUMN_REF,
      index: 2,
      workbookFile: WORKBOOK_FILE,
    });

    expect(metadataModule.addFieldToRows).toHaveBeenCalledWith(
      '<worksheet/>',
      COLUMN_REF,
      2,
      '<workbook/>',
    );
  });

  // --- target=cols (ported from addFieldToCols) ---
  it('should return error when addFieldToCols throws (target=cols)', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<worksheet/>');
    vi.mocked(metadataModule.addFieldToCols).mockImplementation(() => {
      throw new Error('Invalid format');
    });

    const result = await getResult({
      worksheetFile: WORKSHEET_FILE,
      target: 'cols',
      columnRef: COLUMN_REF,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new XmlModificationError('Invalid format').message);
  });

  it('should write modified XML and return success (target=cols)', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<worksheet/>');
    vi.mocked(metadataModule.addFieldToCols).mockReturnValue(MODIFIED_XML);
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
  });

  it('should pass index and workbookFile to addFieldToCols (target=cols)', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation((p) =>
      p === WORKBOOK_FILE ? '<workbook/>' : '<worksheet/>',
    );
    vi.mocked(metadataModule.addFieldToCols).mockReturnValue(MODIFIED_XML);
    vi.mocked(writeFileSync).mockReturnValue(undefined);

    await getResult({
      worksheetFile: WORKSHEET_FILE,
      target: 'cols',
      columnRef: COLUMN_REF,
      index: 0,
      workbookFile: WORKBOOK_FILE,
    });

    expect(metadataModule.addFieldToCols).toHaveBeenCalledWith(
      '<worksheet/>',
      COLUMN_REF,
      0,
      '<workbook/>',
    );
  });

  // --- target=encoding (ported from addFieldToEncoding) ---
  it('should return error when addFieldToEncoding throws (target=encoding)', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<worksheet/>');
    vi.mocked(metadataModule.addFieldToEncoding).mockImplementation(() => {
      throw new Error('Invalid column ref');
    });

    const result = await getResult({
      worksheetFile: WORKSHEET_FILE,
      target: 'encoding',
      encodingType: 'color',
      columnRef: COLUMN_REF,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new XmlModificationError('Invalid column ref').message);
  });

  it('should return error when modified XML is not well-formed (target=encoding)', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<worksheet/>');
    vi.mocked(metadataModule.addFieldToEncoding).mockReturnValue('<unclosed');

    const result = await getResult({
      worksheetFile: WORKSHEET_FILE,
      target: 'encoding',
      encodingType: 'color',
      columnRef: COLUMN_REF,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('failed validation');
  });

  it('should write modified XML and return success (target=encoding)', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<worksheet/>');
    vi.mocked(metadataModule.addFieldToEncoding).mockReturnValue(MODIFIED_XML);
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

  it('should pass optional workbookFile when it exists (target=encoding)', async () => {
    vi.mocked(existsSync).mockImplementation((p) => p === WORKSHEET_FILE || p === WORKBOOK_FILE);
    vi.mocked(readFileSync).mockImplementation((p) =>
      p === WORKBOOK_FILE ? '<workbook/>' : '<worksheet/>',
    );
    vi.mocked(metadataModule.addFieldToEncoding).mockReturnValue(MODIFIED_XML);
    vi.mocked(writeFileSync).mockReturnValue(undefined);

    await getResult({
      worksheetFile: WORKSHEET_FILE,
      target: 'encoding',
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

  it('should pass index to addFieldToEncoding when provided (target=encoding)', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<worksheet/>');
    vi.mocked(metadataModule.addFieldToEncoding).mockReturnValue(MODIFIED_XML);
    vi.mocked(writeFileSync).mockReturnValue(undefined);

    await getResult({
      worksheetFile: WORKSHEET_FILE,
      target: 'encoding',
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
    expect(metadataModule.addFieldToEncoding).not.toHaveBeenCalled();
  });

  it('ignores encodingType for target=rows (routes to rows, not encoding)', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<worksheet/>');
    vi.mocked(metadataModule.addFieldToRows).mockReturnValue(MODIFIED_XML);
    vi.mocked(writeFileSync).mockReturnValue(undefined);

    const result = await getResult({
      worksheetFile: WORKSHEET_FILE,
      target: 'rows',
      encodingType: 'color',
      columnRef: COLUMN_REF,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(resultSchema.parse(JSON.parse(result.content[0].text)).message).toContain('Rows shelf');
    expect(metadataModule.addFieldToRows).toHaveBeenCalledWith(
      '<worksheet/>',
      COLUMN_REF,
      undefined,
      undefined,
    );
    expect(metadataModule.addFieldToEncoding).not.toHaveBeenCalled();
  });

  it('ignores encodingType for target=cols (routes to cols, not encoding)', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<worksheet/>');
    vi.mocked(metadataModule.addFieldToCols).mockReturnValue(MODIFIED_XML);
    vi.mocked(writeFileSync).mockReturnValue(undefined);

    const result = await getResult({
      worksheetFile: WORKSHEET_FILE,
      target: 'cols',
      encodingType: 'size',
      columnRef: COLUMN_REF,
    });

    expect(result.isError).toBe(false);
    expect(metadataModule.addFieldToCols).toHaveBeenCalledWith(
      '<worksheet/>',
      COLUMN_REF,
      undefined,
      undefined,
    );
    expect(metadataModule.addFieldToEncoding).not.toHaveBeenCalled();
  });
});

async function getResult(params: {
  worksheetName?: string;
  worksheetFile?: string;
  target: Target;
  columnRef: string;
  encodingType?: EncodingType;
  index?: number;
  workbookFile?: string;
  session?: string;
}): Promise<CallToolResult> {
  const { worksheetName, worksheetFile, target, columnRef, encodingType, index, workbookFile } =
    params;
  const session = ('session' in params ? params.session : SESSION) as string;
  const tool = getAddFieldTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    { session, worksheetName, worksheetFile, target, columnRef, encodingType, index, workbookFile },
    getMockRequestHandlerExtra(),
  );
}
