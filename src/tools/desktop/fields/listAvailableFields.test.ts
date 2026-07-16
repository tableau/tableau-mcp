import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import * as cacheFingerprintModule from '../../../desktop/commands/workbook/cacheFingerprint.js';
import * as getWorkbookXmlModule from '../../../desktop/commands/workbook/getWorkbookXml.js';
import * as metadataModule from '../../../desktop/metadata/index.js';
import { FileNotFoundError, FileReadError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getListAvailableFieldsTool } from './listAvailableFields.js';

vi.mock('../../../desktop/commands/workbook/cacheFingerprint.js');
vi.mock('../../../desktop/commands/workbook/getWorkbookXml.js');
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

const mockLiveFields = [
  {
    datasource: 'Fresh DS',
    columnName: '[Sales]',
    columnInstanceName: '[sum:Sales:qk]',
    derivation: 'Sum',
    type: 'quantitative',
    role: 'measure',
    datatype: 'real',
    caption: 'Sales',
    isAggregated: false,
    column_ref: '[Fresh DS].[sum:Sales:qk]',
  },
];

const WORKBOOK_FILE = '/workbook.xml';
const SESSION = '12345';
const STALE_XML = '<workbook><datasource name="stale"/></workbook>';
const LIVE_XML = '<workbook><datasource name="live"/></workbook>';

describe('listAvailableFieldsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getListAvailableFieldsTool(new DesktopMcpServer());
    expect(tool.name).toBe('list-available-fields');
    expect(tool.description).toContain('List ALL fields available in workbook datasources');
    expect(tool.paramsSchema).toMatchObject({
      session: expect.any(Object),
      workbookFile: expect.any(Object),
    });
    expect(tool.annotations).toMatchObject({
      title: 'List All Available Fields in Workbook Datasources',
      readOnlyHint: false,
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
    expect(body.message).toContain('Text');
    expect(body.message).toContain('Number (decimal)');
    expect(body.fields).toHaveLength(2);
  });

  it('with session re-snapshots live workbook, rewrites cache and sidecar, and lists new fields', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(STALE_XML);
    vi.mocked(writeFileSync).mockReturnValue(undefined);
    vi.mocked(getWorkbookXmlModule.getWorkbookXml).mockResolvedValue(Ok(LIVE_XML));
    vi.mocked(metadataModule.listAvailableFields).mockReturnValue(mockLiveFields as any);
    const mockExecutor = {} as any;
    const extra = {
      ...getMockRequestHandlerExtra(),
      getExecutor: vi.fn().mockResolvedValue(mockExecutor),
    };

    const result = await getResult({ session: SESSION, workbookFile: WORKBOOK_FILE, extra });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(body.message).toContain('Sales');
    expect(extra.getExecutor).toHaveBeenCalledWith(SESSION);
    expect(getWorkbookXmlModule.getWorkbookXml).toHaveBeenCalledWith({
      executor: mockExecutor,
      signal: extra.signal,
    });
    expect(writeFileSync).toHaveBeenCalledWith(WORKBOOK_FILE, LIVE_XML, 'utf-8');
    expect(cacheFingerprintModule.writeSidecar).toHaveBeenCalledWith(WORKBOOK_FILE, SESSION);
    expect(metadataModule.listAvailableFields).toHaveBeenCalledWith(LIVE_XML);
  });

  it('without session preserves cache-only behavior', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(STALE_XML);
    vi.mocked(getWorkbookXmlModule.getWorkbookXml).mockResolvedValue(Ok(LIVE_XML));
    vi.mocked(metadataModule.listAvailableFields).mockReturnValue(mockFields as any);
    const extra = getMockRequestHandlerExtra();

    const result = await getResult({ workbookFile: WORKBOOK_FILE, extra });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(body.message).toContain('Profit');
    expect(extra.getExecutor).not.toHaveBeenCalled();
    expect(getWorkbookXmlModule.getWorkbookXml).not.toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();
    expect(cacheFingerprintModule.writeSidecar).not.toHaveBeenCalled();
    expect(metadataModule.listAvailableFields).toHaveBeenCalledWith(STALE_XML);
  });

  it('refresh failure is an explicit error and never silently lists stale fields', async () => {
    const error = { type: 'command-timed-out' as const, error: 'no session' };
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(STALE_XML);
    vi.mocked(getWorkbookXmlModule.getWorkbookXml).mockResolvedValue(Err(error));
    const extra = {
      ...getMockRequestHandlerExtra(),
      getExecutor: vi.fn().mockResolvedValue({} as any),
    };

    const result = await getResult({ session: SESSION, workbookFile: WORKBOOK_FILE, extra });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(
      'Failed to refresh workbook from Tableau before listing fields',
    );
    expect(result.content[0].text).toContain('no session');
    expect(readFileSync).not.toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();
    expect(metadataModule.listAvailableFields).not.toHaveBeenCalled();
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

async function getResult({
  workbookFile,
  session,
  extra,
}: {
  workbookFile: string;
  session?: string;
  extra?: ReturnType<typeof getMockRequestHandlerExtra>;
}): Promise<CallToolResult> {
  const tool = getListAvailableFieldsTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback({ session, workbookFile }, extra ?? getMockRequestHandlerExtra());
}
