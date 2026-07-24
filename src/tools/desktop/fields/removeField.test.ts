import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import * as configModule from '../../../config.desktop.js';
import * as cacheFingerprintModule from '../../../desktop/commands/workbook/cacheFingerprint.js';
import * as getWorksheetXmlModule from '../../../desktop/commands/workbook/getWorksheetXml.js';
import * as loadWorksheetXmlModule from '../../../desktop/commands/workbook/loadWorksheetXml.js';
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
import { getApplyWorksheetTool } from '../worksheet/applyWorksheet.js';
import { getAddFieldTool } from './addField.js';
import { getRemoveFieldTool } from './removeField.js';

vi.mock('../../../desktop/metadata/index.js');
vi.mock('../../../desktop/commands/workbook/cacheFingerprint.js');
vi.mock('../../../desktop/commands/workbook/getWorksheetXml.js');
vi.mock('../../../desktop/commands/workbook/loadWorksheetXml.js');
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
const COLUMN_REF = '[Sample - Superstore].[sum:Profit:qk]';
const MODIFIED_XML = '<worksheet name="Sheet 1"><table></table></worksheet>';

function mockPinnedSession(desktopSessionId: string | undefined): void {
  const base = new configModule.Config();
  vi.spyOn(configModule, 'getDesktopConfig').mockReturnValue({
    ...base,
    desktopSessionId,
  } as configModule.Config);
}

describe('removeFieldTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPinnedSession(undefined);
    vi.mocked(discoveryModule.discoverInstances).mockReturnValue([]);
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getRemoveFieldTool(new DesktopMcpServer());
    expect(tool.name).toBe('remove-field');
    expect(tool.description).toBe(
      'Remove a field from a shelf (rows/cols/encoding); counterpart to add-field.',
    );
    expect(tool.paramsSchema).toMatchObject({
      session: expect.any(Object),
      worksheetName: expect.any(Object),
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

  it('writes a fingerprint sidecar after updating the worksheet cache file', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<worksheet/>');
    vi.mocked(metadataModule.removeFieldFromRows).mockReturnValue(MODIFIED_XML);
    vi.mocked(writeFileSync).mockReturnValue(undefined);

    await getResult({ worksheetFile: WORKSHEET_FILE, target: 'rows', columnRef: COLUMN_REF });

    expect(cacheFingerprintModule.writeSidecar).toHaveBeenCalledWith(WORKSHEET_FILE, SESSION);
  });

  it('stamps the sidecar with the pinned session, not the requested one', async () => {
    mockPinnedSession(SESSION);
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<worksheet/>');
    vi.mocked(metadataModule.removeFieldFromRows).mockReturnValue(MODIFIED_XML);
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
    vi.mocked(metadataModule.removeFieldFromRows).mockReturnValue(MODIFIED_XML);
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
    vi.mocked(metadataModule.removeFieldFromRows).mockReturnValue(MODIFIED_XML);
    vi.mocked(writeFileSync).mockReturnValue(undefined);
    const extra = getMockRequestHandlerExtra();
    const tool = getRemoveFieldTool(new DesktopMcpServer());
    const callback = await Provider.from(tool.callback);

    const result = await callback(
      {
        session: SESSION,
        worksheetName: undefined,
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

  it('fetches and caches the sheet by name when no worksheetFile is given, then edits it', async () => {
    const fragment = '<worksheet name="Sheet 1"><table/></worksheet>';
    vi.mocked(getWorksheetXmlModule.getWorksheetFragment).mockResolvedValue(Ok(fragment));
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(fragment);
    vi.mocked(metadataModule.removeFieldFromRows).mockReturnValue(MODIFIED_XML);
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
    expect(getWorksheetXmlModule.getWorksheetFragment).toHaveBeenCalledWith(
      expect.objectContaining({ worksheetName: 'Sheet 1' }),
    );
    expect(body.file).toMatch(/worksheet-Sheet_1-/);
    expect(writeFileSync).toHaveBeenCalledWith(body.file, fragment, 'utf-8');
    expect(writeFileSync).toHaveBeenCalledWith(body.file, MODIFIED_XML, 'utf-8');
  });

  it('uses a supplied worksheetFile without fetching when worksheetName is also given', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<worksheet/>');
    vi.mocked(metadataModule.removeFieldFromRows).mockReturnValue(MODIFIED_XML);
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
    expect(getWorksheetXmlModule.getWorksheetFragment).not.toHaveBeenCalled();
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
    expect(metadataModule.removeFieldFromRows).not.toHaveBeenCalled();
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
    vi.mocked(getWorksheetXmlModule.getWorksheetFragment).mockResolvedValue(Err(routeMissingErr));
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

  it('stacks add then remove on the returned worksheetFile before one apply-worksheet', async () => {
    const baseXml = '<worksheet name="Sheet 1"><table/></worksheet>';
    const addedXml = '<worksheet name="Sheet 1"><table><rows>[Profit]</rows></table></worksheet>';
    const removedXml = '<worksheet name="Sheet 1"><table><rows/></table></worksheet>';
    const files = new Map<string, string>();
    vi.mocked(getWorksheetXmlModule.getWorksheetFragment).mockResolvedValue(Ok(baseXml));
    vi.mocked(existsSync).mockImplementation((path) => files.has(String(path)));
    vi.mocked(readFileSync).mockImplementation((path) => files.get(String(path)) ?? '');
    vi.mocked(writeFileSync).mockImplementation((path, data) => {
      files.set(String(path), String(data));
    });
    vi.mocked(metadataModule.addFieldToRows).mockReturnValue(addedXml);
    vi.mocked(metadataModule.removeFieldFromRows).mockReturnValue(removedXml);
    vi.mocked(cacheFingerprintModule.checkSidecar).mockReturnValue({ ok: true });
    vi.mocked(loadWorksheetXmlModule.loadWorksheetXml).mockResolvedValue(
      Ok({ readbackWarnings: [] }),
    );

    const addResult = await getAddResult({ worksheetName: 'Sheet 1', target: 'rows' });

    expect(addResult.isError).toBe(false);
    invariant(addResult.content[0].type === 'text');
    const addBody = resultSchema.parse(JSON.parse(addResult.content[0].text));

    const removeResult = await getResult({
      worksheetFile: addBody.file,
      target: 'rows',
      columnRef: COLUMN_REF,
    });

    expect(removeResult.isError).toBe(false);
    invariant(removeResult.content[0].type === 'text');
    const removeBody = resultSchema.parse(JSON.parse(removeResult.content[0].text));
    expect(removeBody.file).toBe(addBody.file);

    const applyResult = await getApplyResult({
      worksheetName: 'Sheet 1',
      worksheetFile: removeBody.file,
    });

    expect(applyResult.isError).toBe(false);
    expect(getWorksheetXmlModule.getWorksheetFragment).toHaveBeenCalledTimes(1);
    expect(loadWorksheetXmlModule.loadWorksheetXml).toHaveBeenCalledWith(
      expect.objectContaining({ worksheetName: 'Sheet 1', xml: removedXml }),
    );
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

async function getResult(params: {
  worksheetName?: string;
  worksheetFile?: string;
  target: Target;
  columnRef: string;
  encodingType?: EncodingType;
  session?: string;
}): Promise<CallToolResult> {
  const { worksheetName, worksheetFile, target, columnRef, encodingType } = params;
  const session = ('session' in params ? params.session : SESSION) as string;
  const tool = getRemoveFieldTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    { session, worksheetName, worksheetFile, target, columnRef, encodingType },
    getMockRequestHandlerExtra(),
  );
}

async function getAddResult(params: {
  worksheetName?: string;
  worksheetFile?: string;
  target: Target;
  columnRef?: string;
  encodingType?: EncodingType;
  session?: string;
}): Promise<CallToolResult> {
  const session = ('session' in params ? params.session : SESSION) as string;
  const tool = getAddFieldTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    {
      session,
      worksheetName: params.worksheetName,
      worksheetFile: params.worksheetFile,
      target: params.target,
      columnRef: params.columnRef ?? COLUMN_REF,
      encodingType: params.encodingType,
      index: undefined,
      workbookFile: undefined,
    },
    getMockRequestHandlerExtra(),
  );
}

async function getApplyResult(params: {
  worksheetName: string;
  worksheetFile: string;
  session?: string;
}): Promise<CallToolResult> {
  const session = ('session' in params ? params.session : SESSION) as string;
  const tool = getApplyWorksheetTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    {
      session,
      worksheetName: params.worksheetName,
      mode: 'file',
      worksheetFile: params.worksheetFile,
      worksheetXml: undefined,
    },
    getMockRequestHandlerExtra(),
  );
}
