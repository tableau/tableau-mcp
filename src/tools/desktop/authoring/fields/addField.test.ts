import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import * as configModule from '../../../../config.desktop.js';
import * as discoveryModule from '../../../../desktop/externalApi/discovery.js';
import * as metadataModule from '../../../../desktop/metadata/index.js';
import * as cacheFingerprintModule from '../../../../desktop/wrappers/cacheFingerprint.js';
import * as getWorksheetXmlModule from '../../../../desktop/wrappers/getWorksheetXml.js';
import {
  ArgsValidationError,
  FileNotFoundError,
  FileReadError,
  GetWorksheetXmlFailedError,
  XmlModificationError,
} from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { getAddFieldTool } from './addField.js';
import * as refreshWorkbookCacheModule from './refreshWorkbookCache.js';

vi.mock('../../../../desktop/metadata/index.js');
vi.mock('../../../../desktop/wrappers/cacheFingerprint.js');
vi.mock('../../../../desktop/wrappers/getWorksheetXml.js');
vi.mock('../../../../desktop/externalApi/discovery.js');
vi.mock('./refreshWorkbookCache.js');
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
const LIVE_WORKBOOK_XML = '<workbook live="1"/>';

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
    vi.mocked(refreshWorkbookCacheModule.refreshWorkbookCache).mockResolvedValue({
      ok: true,
      xml: LIVE_WORKBOOK_XML,
    });
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getAddFieldTool(new DesktopMcpServer());
    expect(tool.name).toBe('add-field');
    expect(tool.description).toBe(
      'Put a field on rows, cols, or a color/size/detail encoding; then apply-worksheet.',
    );
    // Live incident (v11 bundle): the old wording ("the manual path when no template binds")
    // ruled this tool out of the exact case it is for — changing the encoding of a sheet a
    // template already built.
    expect(tool.description).not.toContain('when no template binds');
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

  it('does not use the Tableau command channel when workbookFile is supplied', async () => {
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
        workbookFile: WORKBOOK_FILE,
      },
      extra,
    );

    expect(result.isError).toBe(false);
    expect(extra.getExecutor).not.toHaveBeenCalled();
    expect(refreshWorkbookCacheModule.refreshWorkbookCache).not.toHaveBeenCalled();
  });

  // --- name-based path (no prior get-worksheet-xml call) ---
  it('fetches + caches the sheet by name when no worksheetFile is given, then edits it', async () => {
    const FRAGMENT = '<worksheet name="Sheet 1"><table/></worksheet>';
    vi.mocked(getWorksheetXmlModule.getWorksheetXml).mockResolvedValue(Ok(FRAGMENT));
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
    expect(getWorksheetXmlModule.getWorksheetXml).toHaveBeenCalledWith(
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
    vi.mocked(getWorksheetXmlModule.getWorksheetXml).mockResolvedValue(Err(fetchErr));

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

  it('uses in-profile recovery guidance when the worksheet endpoint is absent', async () => {
    const routeMissingErr = {
      type: 'execute-command-error' as const,
      error: {
        type: 'command-failed' as const,
        error: {
          code: 'not-found',
          message: 'No route matches GET /api/v1/worksheets/sheet-1/document',
          recoverable: false,
        },
      },
    };
    vi.mocked(getWorksheetXmlModule.getWorksheetXml).mockResolvedValue(Err(routeMissingErr));
    vi.mocked(getWorksheetXmlModule.isRouteMissing).mockReturnValue(true);

    const result = await getResult({
      worksheetName: 'Sheet 1',
      target: 'rows',
      columnRef: COLUMN_REF,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('list-worksheets');
    expect(result.content[0].text).toContain('retry');
    expect(result.content[0].text).not.toContain('get-app-info');
    expect(writeFileSync).not.toHaveBeenCalled();
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
    expect(getWorksheetXmlModule.getWorksheetXml).not.toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  // --- sticky worksheet edit buffer ---
  it('accumulates two name-only calls on the same sticky file (fetches once)', async () => {
    const baseXml = '<worksheet name="Sheet 1"><table/></worksheet>';
    const files = new Map<string, string>();
    vi.mocked(getWorksheetXmlModule.getWorksheetXml).mockResolvedValue(Ok(baseXml));
    vi.mocked(existsSync).mockImplementation((path) => files.has(String(path)));
    vi.mocked(readFileSync).mockImplementation((path) => files.get(String(path)) ?? '');
    vi.mocked(writeFileSync).mockImplementation((path, data) => {
      files.set(String(path), String(data));
    });
    vi.mocked(metadataModule.addFieldToRows).mockReturnValue(MODIFIED_XML);
    vi.mocked(cacheFingerprintModule.checkSidecar).mockReturnValue({ ok: true });

    const first = await getResult({
      worksheetName: 'Sheet 1',
      target: 'rows',
      columnRef: COLUMN_REF,
    });
    expect(first.isError).toBe(false);
    invariant(first.content[0].type === 'text');
    const firstBody = resultSchema.parse(JSON.parse(first.content[0].text));

    const second = await getResult({
      worksheetName: 'Sheet 1',
      target: 'rows',
      columnRef: COLUMN_REF,
    });
    expect(second.isError).toBe(false);
    invariant(second.content[0].type === 'text');
    const secondBody = resultSchema.parse(JSON.parse(second.content[0].text));

    // Both name-only calls land on the same minted cache file — the second call never
    // re-fetches a fresh (blank) sheet from the live workbook.
    expect(secondBody.file).toBe(firstBody.file);
    expect(getWorksheetXmlModule.getWorksheetXml).toHaveBeenCalledOnce();
    expect(vi.mocked(metadataModule.addFieldToRows).mock.calls[1]?.[0]).toBe(MODIFIED_XML);
  });

  it('mints a fresh sheet when the sticky buffer fails its sidecar/session check', async () => {
    const baseXml = '<worksheet name="Sheet 1"><table/></worksheet>';
    const files = new Map<string, string>();
    vi.mocked(getWorksheetXmlModule.getWorksheetXml).mockResolvedValue(Ok(baseXml));
    vi.mocked(existsSync).mockImplementation((path) => files.has(String(path)));
    vi.mocked(readFileSync).mockImplementation((path) => files.get(String(path)) ?? '');
    vi.mocked(writeFileSync).mockImplementation((path, data) => {
      files.set(String(path), String(data));
    });
    vi.mocked(metadataModule.addFieldToRows).mockReturnValue(MODIFIED_XML);
    // The sidecar check fails on every lookup — as if the buffer belonged to another
    // Desktop instance/session — so the sticky pointer must never be trusted.
    vi.mocked(cacheFingerprintModule.checkSidecar).mockReturnValue({
      ok: false,
      reason: 'session-mismatch',
    } as never);

    const first = await getResult({
      worksheetName: 'Sheet 1',
      target: 'rows',
      columnRef: COLUMN_REF,
    });
    expect(first.isError).toBe(false);

    const second = await getResult({
      worksheetName: 'Sheet 1',
      target: 'rows',
      columnRef: COLUMN_REF,
    });
    expect(second.isError).toBe(false);

    // Each name-only call re-fetches because the sticky pointer never validates.
    expect(getWorksheetXmlModule.getWorksheetXml).toHaveBeenCalledTimes(2);
  });

  it('an explicit worksheetFile updates the sticky buffer for later name-only calls', async () => {
    const files = new Map<string, string>([[WORKSHEET_FILE, '<worksheet/>']]);
    vi.mocked(existsSync).mockImplementation((path) => files.has(String(path)));
    vi.mocked(readFileSync).mockImplementation((path) => files.get(String(path)) ?? '');
    vi.mocked(writeFileSync).mockImplementation((path, data) => {
      files.set(String(path), String(data));
    });
    vi.mocked(metadataModule.addFieldToRows).mockReturnValue(MODIFIED_XML);
    vi.mocked(cacheFingerprintModule.checkSidecar).mockReturnValue({ ok: true });

    // First call names the sheet AND supplies the file explicitly — the override case.
    const explicit = await getResult({
      worksheetName: 'Sheet 1',
      worksheetFile: WORKSHEET_FILE,
      target: 'rows',
      columnRef: COLUMN_REF,
    });
    expect(explicit.isError).toBe(false);

    // A later name-only call continues from that same file without any fetch.
    const nameOnly = await getResult({
      worksheetName: 'Sheet 1',
      target: 'rows',
      columnRef: COLUMN_REF,
    });
    expect(nameOnly.isError).toBe(false);
    invariant(nameOnly.content[0].type === 'text');
    expect(resultSchema.parse(JSON.parse(nameOnly.content[0].text)).file).toBe(WORKSHEET_FILE);
    expect(getWorksheetXmlModule.getWorksheetXml).not.toHaveBeenCalled();
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
    expect(getWorksheetXmlModule.getWorksheetXml).not.toHaveBeenCalled();
  });

  it('should pass index and workbookFile to addFieldToRows (target=rows)', async () => {
    const worksheetXml = '<worksheet><table><rows>[A] / [B]</rows></table></worksheet>';
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation((p) =>
      p === WORKBOOK_FILE ? '<workbook/>' : worksheetXml,
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
      worksheetXml,
      COLUMN_REF,
      2,
      '<workbook/>',
    );
  });

  it('rejects negative, fractional, and out-of-range indexes before mutating XML', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      '<worksheet><table><rows>[A] / [B]</rows></table></worksheet>',
    );

    for (const index of [-1, 1.5, 3]) {
      vi.clearAllMocks();
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        '<worksheet><table><rows>[A] / [B]</rows></table></worksheet>',
      );
      vi.mocked(refreshWorkbookCacheModule.refreshWorkbookCache).mockResolvedValue({
        ok: true,
        xml: LIVE_WORKBOOK_XML,
      });

      const result = await getResult({
        worksheetFile: WORKSHEET_FILE,
        target: 'rows',
        columnRef: COLUMN_REF,
        index,
      });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('index must be an integer in the range 0..2');
      expect(metadataModule.addFieldToRows).not.toHaveBeenCalled();
      expect(writeFileSync).not.toHaveBeenCalled();
    }
  });

  it('counts a slash inside a shelf field name as part of the field, not a separator', async () => {
    const worksheetXml =
      '<worksheet><table><rows>[Sample].[sum:Revenue/Cost:qk]</rows></table></worksheet>';
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(worksheetXml);

    const result = await getResult({
      worksheetFile: WORKSHEET_FILE,
      target: 'rows',
      columnRef: COLUMN_REF,
      index: 2,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('index must be an integer in the range 0..1');
    expect(metadataModule.addFieldToRows).not.toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();
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
    const worksheetXml = '<worksheet><table><cols>[A]</cols></table></worksheet>';
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation((p) =>
      p === WORKBOOK_FILE ? '<workbook/>' : worksheetXml,
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
      worksheetXml,
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
    const worksheetXml =
      '<worksheet><table><panes><pane><encodings><size column="[A]" /></encodings></pane></panes></table></worksheet>';
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(worksheetXml);
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
      worksheetXml,
      'size',
      COLUMN_REF,
      1,
      LIVE_WORKBOOK_XML,
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
      LIVE_WORKBOOK_XML,
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
      LIVE_WORKBOOK_XML,
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

// The schema described columnRef as "Field." for a value the metadata layer requires to
// be [Datasource].[column-instance]. 23 of add-field's 38 production errors were this
// class, and the old message only restated the grammar.
describe('add-field columnRef contract', () => {
  const WORKBOOK_XML = '<workbook/>';

  beforeEach(() => {
    vi.clearAllMocks();
    mockPinnedSession(undefined);
    vi.mocked(discoveryModule.discoverInstances).mockReturnValue([]);
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation((path) =>
      String(path) === WORKBOOK_FILE ? (WORKBOOK_XML as never) : ('<worksheet/>' as never),
    );
    vi.mocked(refreshWorkbookCacheModule.refreshWorkbookCache).mockResolvedValue({
      ok: true,
      xml: LIVE_WORKBOOK_XML,
    });
  });

  it('documents the format and a worked example on the parameter itself', async () => {
    const tool = getAddFieldTool(new DesktopMcpServer());
    const paramsSchema = (await Provider.from(tool.paramsSchema)) as Record<string, z.ZodTypeAny>;
    const description = paramsSchema['columnRef']!.description ?? '';

    expect(description).toContain('[Datasource].[derivation:Column:type]');
    expect(description).toContain('[Sample - Superstore].[sum:Sales:qk]');
    expect(description).toContain('from field resolution');
    expect(description).toContain('never invented');
  });

  it('rejects a bare field name before touching the XML, and names the real refs', async () => {
    vi.mocked(metadataModule.listAvailableFields).mockReturnValue([
      {
        column_ref: '[Sample - Superstore].[sum:Sales:qk]',
        columnName: '[Sales]',
        datasource: 'Sample - Superstore',
      },
      {
        column_ref: '[Sample - Superstore].[sum:Profit:qk]',
        columnName: '[Profit]',
        datasource: 'Sample - Superstore',
      },
    ] as never);

    const result = await getResult({
      worksheetFile: WORKSHEET_FILE,
      workbookFile: WORKBOOK_FILE,
      target: 'rows',
      columnRef: 'Sales',
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Did you mean');
    expect(result.content[0].text).toContain('[Sample - Superstore].[sum:Sales:qk]');
    expect(metadataModule.addFieldToRows).not.toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it('points at resolve-field when the workbook has no fields to suggest', async () => {
    vi.mocked(metadataModule.listAvailableFields).mockReturnValue([]);

    const result = await getResult({
      worksheetFile: WORKSHEET_FILE,
      target: 'cols',
      columnRef: 'SUM(Sales)',
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('is not a column reference');
    expect(result.content[0].text).toContain('[Sample - Superstore].[sum:Sales:qk]');
    expect(result.content[0].text).toContain('resolve-field');
    expect(metadataModule.addFieldToCols).not.toHaveBeenCalled();
  });

  it('still accepts a well-formed ref', async () => {
    vi.mocked(metadataModule.addFieldToRows).mockReturnValue(MODIFIED_XML);
    vi.mocked(writeFileSync).mockReturnValue(undefined);

    const result = await getResult({
      worksheetFile: WORKSHEET_FILE,
      target: 'rows',
      columnRef: COLUMN_REF,
    });

    expect(result.isError).toBe(false);
    expect(metadataModule.addFieldToRows).toHaveBeenCalled();
  });
});
