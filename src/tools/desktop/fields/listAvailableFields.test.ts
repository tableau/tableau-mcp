import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import * as cacheFingerprintModule from '../../../desktop/commands/workbook/cacheFingerprint.js';
import * as getWorkbookXmlModule from '../../../desktop/commands/workbook/getWorkbookXml.js';
import * as metadataModule from '../../../desktop/metadata/index.js';
import { FileReadError } from '../../../errors/mcpToolError.js';
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

  it('should return helpful error when workbook file does not exist', async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const result = await getResult({ workbookFile: '/missing/workbook.xml' });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('File not found: /missing/workbook.xml.');
    expect(result.content[0].text).toContain('cached workbook file');
    expect(result.content[0].text).toContain(
      'Omit workbookFile to read fields from the live session workbook',
    );
    expect(result.content[0].text).not.toContain('get-*-xml');
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

  it('without workbookFile reads fields from the resolved live session workbook', async () => {
    vi.mocked(getWorkbookXmlModule.getWorkbookXml).mockResolvedValue(Ok(LIVE_XML));
    vi.mocked(metadataModule.listAvailableFields).mockReturnValue(mockLiveFields as any);
    const mockExecutor = {} as any;
    const extra = {
      ...getMockRequestHandlerExtra(),
      getExecutor: vi.fn().mockResolvedValue(mockExecutor),
    };

    const result = await getResult({ session: SESSION, extra });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(body.message).toContain('Sales');
    expect(existsSync).not.toHaveBeenCalled();
    expect(readFileSync).not.toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();
    expect(cacheFingerprintModule.writeSidecar).not.toHaveBeenCalled();
    expect(extra.getExecutor).toHaveBeenCalledWith(SESSION);
    expect(getWorkbookXmlModule.getWorkbookXml).toHaveBeenCalledWith({
      executor: mockExecutor,
      signal: extra.signal,
    });
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

  it('verbosity=slim returns compact fields with no ASCII table', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<workbook/>');
    vi.mocked(metadataModule.listAvailableFields).mockReturnValue(mockFields as any);

    const result = await getResult({ workbookFile: '/workbook.xml', verbosity: 'slim' });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = z
      .object({
        datasource: z.string().nullable(),
        count: z.number(),
        fields: z.array(
          z.object({
            caption: z.string(),
            role: z.string(),
            datatype: z.string().optional(),
          }),
        ),
      })
      .parse(JSON.parse(result.content[0].text));

    // No human-readable table in slim mode; datasource is hoisted to the top level.
    expect('message' in body).toBe(false);
    expect(body.datasource).toBe('Sample - Superstore');
    expect(body.count).toBe(2);
    expect(body.fields).toHaveLength(2);
    // caption falls back to the bracket-stripped columnName when caption is absent.
    expect(body.fields[0]).toMatchObject({ caption: 'Profit', role: 'measure', datatype: 'real' });
    expect(body.fields[1]).toMatchObject({ caption: 'Category', role: 'dimension', datatype: 'string' });
    // Per-field metadata not needed for picking is omitted: column_ref (authoring),
    // and the redundant/near-duplicate name, datasource, semanticRole.
    const first = body.fields[0] as Record<string, unknown>;
    expect(first.column_ref).toBeUndefined();
    expect(first.name).toBeUndefined();
    expect(first.datasource).toBeUndefined();
    expect(first.semanticRole).toBeUndefined();
  });

  it('verbosity=slim on an empty datasource returns count 0 and no fields', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<workbook/>');
    vi.mocked(metadataModule.listAvailableFields).mockReturnValue([]);

    const result = await getResult({ workbookFile: '/workbook.xml', verbosity: 'slim' });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = z
      .object({ datasource: z.string().nullable(), count: z.number(), fields: z.array(z.any()) })
      .parse(JSON.parse(result.content[0].text));
    expect(body.datasource).toBeNull();
    expect(body.count).toBe(0);
    expect(body.fields).toHaveLength(0);
  });
});

async function getResult({
  workbookFile,
  session,
  verbosity,
  extra,
}: {
  workbookFile?: string;
  session?: string;
  verbosity?: 'slim' | 'full';
  extra?: ReturnType<typeof getMockRequestHandlerExtra>;
}): Promise<CallToolResult> {
  const tool = getListAvailableFieldsTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback({ session, workbookFile, verbosity }, extra ?? getMockRequestHandlerExtra());
}
