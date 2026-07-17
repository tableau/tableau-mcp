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
    contentUrl: 'SuperstoreDS',
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
    contentUrl: 'SuperstoreDS',
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

  const slimBodySchema = z.object({
    count: z.number(),
    datasources: z.array(
      z.object({
        datasource: z.string().nullable(),
        contentUrl: z.string().optional(),
        fields: z.array(
          z.object({
            caption: z.string(),
            role: z.string(),
            datatype: z.string().optional(),
          }),
        ),
      }),
    ),
  });

  it('verbosity=slim returns compact grouped fields with no ASCII table', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<workbook/>');
    vi.mocked(metadataModule.listAvailableFields).mockReturnValue(mockFields as any);

    const result = await getResult({ workbookFile: '/workbook.xml', verbosity: 'slim' });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = slimBodySchema.parse(JSON.parse(result.content[0].text));

    // No human-readable table; a single datasource is still the grouped shape
    // (one group) so callers always parse the same structure.
    expect('message' in body).toBe(false);
    expect('fields' in body).toBe(false);
    expect(body.count).toBe(2);
    expect(body.datasources).toHaveLength(1);
    expect(body.datasources[0].datasource).toBe('Sample - Superstore');
    // Published datasource → contentUrl surfaced once on the group (the input
    // resolve-datasource-luid needs), not repeated per field.
    expect(body.datasources[0].contentUrl).toBe('SuperstoreDS');
    const groupFields = body.datasources[0].fields;
    expect(groupFields).toHaveLength(2);
    // caption falls back to the bracket-stripped columnName when caption is absent.
    expect(groupFields[0]).toMatchObject({ caption: 'Profit', role: 'measure', datatype: 'real' });
    expect(groupFields[1]).toMatchObject({ caption: 'Category', role: 'dimension', datatype: 'string' });
    // Per-field metadata not needed for picking is omitted: column_ref (authoring),
    // and the redundant/near-duplicate name, datasource (it's on the group), semanticRole.
    const first = groupFields[0] as Record<string, unknown>;
    expect(first.column_ref).toBeUndefined();
    expect(first.name).toBeUndefined();
    expect(first.datasource).toBeUndefined();
    expect(first.semanticRole).toBeUndefined();
  });

  it('verbosity=slim on an empty workbook returns count 0 and no datasource groups', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<workbook/>');
    vi.mocked(metadataModule.listAvailableFields).mockReturnValue([]);

    const result = await getResult({ workbookFile: '/workbook.xml', verbosity: 'slim' });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = slimBodySchema.parse(JSON.parse(result.content[0].text));
    expect(body.count).toBe(0);
    expect(body.datasources).toHaveLength(0);
  });

  it('verbosity=slim groups fields by datasource across multiple datasources', async () => {
    // Two datasources, including a SAME caption ('Profit') in each — the case
    // where hoisting fields[0].datasource would misattribute the second and
    // erase the only disambiguator. Grouping carries the datasource once per
    // group rather than repeating it on every field.
    // Two datasources: 'Sample - Superstore' is PUBLISHED (has a contentUrl),
    // 'Finance Extract' is EMBEDDED (contentUrl undefined). Both have a 'Profit'.
    const multiDatasourceFields = [
      { ...mockFields[0], datasource: 'Sample - Superstore', contentUrl: 'SuperstoreDS', caption: 'Profit' },
      { ...mockFields[1], datasource: 'Sample - Superstore', contentUrl: 'SuperstoreDS', caption: 'Category' },
      { ...mockFields[0], datasource: 'Finance Extract', contentUrl: undefined, caption: 'Profit' },
      { ...mockFields[1], datasource: 'Finance Extract', contentUrl: undefined, caption: 'Region' },
    ];
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<workbook/>');
    vi.mocked(metadataModule.listAvailableFields).mockReturnValue(multiDatasourceFields as any);

    const result = await getResult({ workbookFile: '/workbook.xml', verbosity: 'slim' });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = slimBodySchema.parse(JSON.parse(result.content[0].text));

    // Grouped shape (no top-level `datasource`, no flat `fields`) when >1 datasource.
    expect('datasource' in body).toBe(false);
    expect('fields' in body).toBe(false);
    expect(body.count).toBe(4);
    expect(body.datasources.map((g) => g.datasource)).toEqual(['Sample - Superstore', 'Finance Extract']);
    // contentUrl per group: present for the published one, omitted for the embedded one.
    expect(body.datasources[0].contentUrl).toBe('SuperstoreDS');
    expect(body.datasources[1].contentUrl).toBeUndefined();
    // The two same-caption 'Profit' fields stay distinct — one per group.
    expect(body.datasources[0].fields.map((f) => f.caption)).toEqual(['Profit', 'Category']);
    expect(body.datasources[1].fields.map((f) => f.caption)).toEqual(['Profit', 'Region']);
    // The datasource string is NOT repeated on individual fields.
    expect((body.datasources[0].fields[0] as Record<string, unknown>).datasource).toBeUndefined();
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
