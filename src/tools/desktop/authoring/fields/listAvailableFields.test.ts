import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import * as metadataModule from '../../../../desktop/metadata/index.js';
import * as cacheFingerprintModule from '../../../../desktop/wrappers/cacheFingerprint.js';
import * as getWorkbookXmlModule from '../../../../desktop/wrappers/getWorkbookXml.js';
import { FileReadError } from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { getListAvailableFieldsTool } from './listAvailableFields.js';

vi.mock('../../../../desktop/wrappers/cacheFingerprint.js');
vi.mock('../../../../desktop/wrappers/getWorkbookXml.js');
vi.mock('../../../../desktop/metadata/index.js');
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

  it('should create a tool instance with correct properties', async () => {
    const tool = getListAvailableFieldsTool(new DesktopMcpServer());
    const paramsSchema = await Provider.from(tool.paramsSchema);

    expect(tool.name).toBe('list-available-fields');
    expect(tool.description).toContain('List datasource fields');
    expect(paramsSchema).toMatchObject({
      session: expect.any(Object),
      workbookFile: expect.any(Object),
      verbosity: expect.any(Object),
      hasLuid: expect.any(Object),
      luids: expect.any(Object),
    });
    expect(paramsSchema.verbosity.description).toContain('full (default)');
    expect(paramsSchema.verbosity.description).toContain('slim');
    expect(paramsSchema.verbosity.safeParse('slim').success).toBe(true);
    expect(paramsSchema.verbosity.safeParse('full').success).toBe(true);
    expect(paramsSchema.verbosity.safeParse('verbose').success).toBe(false);
    expect(tool.annotations).toMatchObject({
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

  it('omitted verbosity is byte-for-byte identical to explicit full output', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<workbook/>');
    vi.mocked(metadataModule.listAvailableFields).mockReturnValue(mockFields as any);

    const defaultResult = await getResult({ workbookFile: '/workbook.xml' });
    const fullResult = await getResult({ workbookFile: '/workbook.xml', verbosity: 'full' });

    expect(defaultResult.isError).toBe(false);
    expect(fullResult.isError).toBe(false);
    invariant(defaultResult.content[0].type === 'text');
    invariant(fullResult.content[0].type === 'text');
    expect(defaultResult.content[0].text).toBe(fullResult.content[0].text);
    const body = resultSchema.parse(JSON.parse(defaultResult.content[0].text));
    expect(body.message).toContain('DIMENSIONS');
    expect(body.message).toContain('MEASURES');
    expect(body.fields[0].column_ref).toBe('[Sample - Superstore].[sum:Profit:qk]');
  });

  it('groups the message by datasource when fields span multiple datasources', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<workbook/>');
    vi.mocked(metadataModule.listAvailableFields).mockReturnValue([
      { ...mockFields[0], datasource: 'DS One' },
      { ...mockFields[1], datasource: 'DS Two' },
    ] as any);

    const result = await getResult({ workbookFile: '/workbook.xml' });

    invariant(result.content[0].type === 'text');
    const body = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(body.message).toContain('Found 2 fields across 2 datasources:');
    expect(body.message).toContain('Datasource "DS One" (1):');
    expect(body.message).toContain('Datasource "DS Two" (1):');
    expect(body.message).not.toContain('Found 2 fields in "DS One"');
  });

  it('middle-truncates over-width names, keeping the tail so similar ids stay distinct', async () => {
    // 31 chars, exceeds the 30-wide column; the two differ only in the final digit.
    const a = 'Calculation_1368249927221915648';
    const b = 'Calculation_1368249927221915649';
    const HEAD = 15;
    const TAIL = 14; // 30-wide column: 15 head + ellipsis + 14 tail
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<workbook/>');
    vi.mocked(metadataModule.listAvailableFields).mockReturnValue([
      { ...mockFields[0], columnName: `[${a}]`, caption: undefined },
      { ...mockFields[0], columnName: `[${b}]`, caption: undefined },
    ] as any);

    const result = await getResult({ workbookFile: '/workbook.xml' });

    invariant(result.content[0].type === 'text');
    const body = resultSchema.parse(JSON.parse(result.content[0].text));
    const rendered = (s: string): string => s.slice(0, HEAD) + '…' + s.slice(s.length - TAIL);
    expect(body.message).toContain(rendered(a));
    expect(body.message).toContain(rendered(b));
    expect(rendered(a)).not.toBe(rendered(b));
    expect(body.message).not.toContain(a);
    expect(body.message).not.toContain(b);
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

  it('before authoring reads fields from the resolved live session workbook', async () => {
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
    datasources: z.array(
      z.object({
        datasource: z.string(),
        name: z.string().optional(),
        luid: z.string().optional(),
        measures: z.array(
          z.tuple([z.string(), z.string(), z.string(), z.enum(['base', 'aggregatedCalc'])]),
        ),
        timeDimensions: z.array(z.tuple([z.string(), z.string(), z.enum(['date', 'datetime'])])),
        breakdownDimensions: z.array(
          z.tuple([z.string(), z.string(), z.enum(['nominal', 'ordinal'])]),
        ),
      }),
    ),
  });

  it('verbosity=slim returns compact candidate tuples with no ASCII table', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<workbook/>');
    vi.mocked(metadataModule.listAvailableFields).mockReturnValue(mockFields as any);

    const result = await getResult({ workbookFile: '/workbook.xml', verbosity: 'slim' });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = slimBodySchema.parse(JSON.parse(result.content[0].text));

    expect('message' in body).toBe(false);
    expect('fields' in body).toBe(false);
    expect('count' in body).toBe(false);
    expect(body.datasources).toHaveLength(1);
    expect(body.datasources[0]).toEqual({
      datasource: 'Sample - Superstore',
      measures: [['Profit', 'Profit', 'Sum', 'base']],
      timeDimensions: [],
      breakdownDimensions: [['Category', 'Category', 'nominal']],
    });
    expect(JSON.stringify(body)).not.toContain('contentUrl');
    expect(JSON.stringify(body)).not.toContain('columnInstanceName');
    expect(JSON.stringify(body)).not.toContain('column_ref');
  });

  it('verbosity=slim marks already-aggregated calculation measures', async () => {
    const aggregatedCalcFields = [
      {
        ...mockFields[0],
        columnName: '[Calculation_123]',
        columnInstanceName: '[usr:Calculation_123:qk]',
        derivation: 'User',
        caption: 'Profit Ratio',
        isAggregated: true,
        formula: 'SUM([Profit]) / SUM([Sales])',
        column_ref: '[Sample - Superstore].[usr:Calculation_123:qk]',
      },
    ];
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<workbook/>');
    vi.mocked(metadataModule.listAvailableFields).mockReturnValue(aggregatedCalcFields as any);

    const result = await getResult({ workbookFile: '/workbook.xml', verbosity: 'slim' });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = slimBodySchema.parse(JSON.parse(result.content[0].text));
    expect(body.datasources[0].measures).toEqual([
      ['Profit Ratio', 'Calculation_123', 'User', 'aggregatedCalc'],
    ]);
  });

  it('verbosity=slim on an empty workbook returns no datasource groups', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<workbook/>');
    vi.mocked(metadataModule.listAvailableFields).mockReturnValue([]);

    const result = await getResult({ workbookFile: '/workbook.xml', verbosity: 'slim' });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = slimBodySchema.parse(JSON.parse(result.content[0].text));
    expect(body.datasources).toHaveLength(0);
  });

  it('verbosity=slim groups candidate tuples across multiple datasources', async () => {
    const multiDatasourceFields = [
      {
        ...mockFields[0],
        datasource: 'Sample - Superstore',
        contentUrl: 'SuperstoreDS',
        caption: 'Profit',
      },
      {
        ...mockFields[1],
        datasource: 'Sample - Superstore',
        contentUrl: 'SuperstoreDS',
        caption: 'Category',
      },
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

    expect(body.datasources.map((g) => g.datasource)).toEqual([
      'Sample - Superstore',
      'Finance Extract',
    ]);
    expect(body.datasources[0].measures).toEqual([['Profit', 'Profit', 'Sum', 'base']]);
    expect(body.datasources[0].breakdownDimensions).toEqual([['Category', 'Category', 'nominal']]);
    expect(body.datasources[1].measures).toEqual([['Profit', 'Profit', 'Sum', 'base']]);
    expect(body.datasources[1].breakdownDimensions).toEqual([['Region', 'Category', 'nominal']]);
  });

  it('verbosity=slim without workbookFile projects the live session workbook', async () => {
    vi.mocked(getWorkbookXmlModule.getWorkbookXml).mockResolvedValue(Ok(LIVE_XML));
    vi.mocked(metadataModule.listAvailableFields).mockReturnValue(mockLiveFields as any);
    const mockExecutor = {} as any;
    const extra = {
      ...getMockRequestHandlerExtra(),
      getExecutor: vi.fn().mockResolvedValue(mockExecutor),
    };

    const result = await getResult({ session: SESSION, verbosity: 'slim', extra });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = slimBodySchema.parse(JSON.parse(result.content[0].text));

    expect(body.datasources).toEqual([
      {
        datasource: 'Fresh DS',
        measures: [['Sales', 'Sales', 'Sum', 'base']],
        timeDimensions: [],
        breakdownDimensions: [],
      },
    ]);

    expect(existsSync).not.toHaveBeenCalled();
    expect(readFileSync).not.toHaveBeenCalled();
    expect(extra.getExecutor).toHaveBeenCalledWith(SESSION);
    expect(getWorkbookXmlModule.getWorkbookXml).toHaveBeenCalledWith({
      executor: mockExecutor,
      signal: extra.signal,
    });
    expect(metadataModule.listAvailableFields).toHaveBeenCalledWith(LIVE_XML);
  });

  it('rejects LUID filtering unless slim output is requested', async () => {
    const result = await getResult({ hasLuid: true });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('require verbosity: slim');
  });

  it('rejects luids unless hasLuid is true', async () => {
    const result = await getResult({ verbosity: 'slim', luids: ['luid-superstore'] });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('luids requires hasLuid: true');
  });

  it.each([{ hasLuid: true }, { hasLuid: true, luids: [] }])(
    'returns every LUID-backed datasource for slim output',
    async ({ hasLuid, luids }) => {
      const { extra, listWorkbookDatasources } = mockLiveWorkbookDatasourceMetadata([
        { luid: 'luid-superstore', name: 'Sample - Superstore' },
        { luid: null, name: 'Embedded' },
      ]);

      const result = await getResult({
        session: SESSION,
        verbosity: 'slim',
        hasLuid,
        luids,
        extra,
      });

      const body = slimBodySchema.parse(parseBody(result));
      expect(body.datasources).toEqual([
        expect.objectContaining({
          datasource: 'Sample - Superstore',
          name: 'Sample - Superstore',
          luid: 'luid-superstore',
        }),
      ]);
      expect(listWorkbookDatasources).toHaveBeenCalledWith(extra.signal);
    },
  );

  it('filters slim output by a requested LUID', async () => {
    const workbookFields = [
      ...mockFields,
      { ...mockFields[0], datasource: 'Finance', caption: 'Revenue' },
    ];
    const { extra } = mockLiveWorkbookDatasourceMetadata(
      [
        { luid: 'luid-superstore', name: 'Sample - Superstore' },
        { luid: 'luid-finance', name: 'Finance' },
      ],
      workbookFields,
    );

    const result = await getResult({
      session: SESSION,
      verbosity: 'slim',
      hasLuid: true,
      luids: ['luid-finance'],
      extra,
    });

    expect(slimBodySchema.parse(parseBody(result)).datasources).toEqual([
      expect.objectContaining({ datasource: 'Finance', luid: 'luid-finance' }),
    ]);
  });

  it('rejects a published and embedded datasource sharing the same identity', async () => {
    const { extra } = mockLiveWorkbookDatasourceMetadata([
      { luid: null, name: 'Sample - Superstore' },
      { luid: 'luid-published', caption: 'Sample - Superstore' },
    ]);

    const result = await getResult({
      session: SESSION,
      verbosity: 'slim',
      hasLuid: true,
      extra,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('matched multiple workbook datasources');
    expect(result.content[0].text).toContain('<no LUID>, luid-published');
  });

  it('ignores unrelated ambiguity for a targeted LUID', async () => {
    const workbookFields = [
      ...mockFields,
      { ...mockFields[0], datasource: 'Finance', caption: 'Revenue' },
    ];
    const { extra } = mockLiveWorkbookDatasourceMetadata(
      [
        { luid: 'luid-one', name: 'Sample - Superstore' },
        { luid: 'luid-two', caption: 'Sample - Superstore' },
        { luid: 'luid-finance', name: 'Finance' },
      ],
      workbookFields,
    );

    const result = await getResult({
      session: SESSION,
      verbosity: 'slim',
      hasLuid: true,
      luids: ['luid-finance'],
      extra,
    });

    expect(slimBodySchema.parse(parseBody(result)).datasources).toEqual([
      expect.objectContaining({ datasource: 'Finance', luid: 'luid-finance' }),
    ]);
  });

  it.each([undefined, '', 'default'])(
    'rejects cached-workbook LUID filtering without an explicit session (%s)',
    async (session) => {
      const result = await getResult({
        workbookFile: WORKBOOK_FILE,
        session,
        verbosity: 'slim',
        hasLuid: true,
      });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain(
        'LUID filtering with workbookFile requires an explicit live session',
      );
    },
  );

  it('identifies a Desktop build without workbook datasource metadata', async () => {
    vi.mocked(getWorkbookXmlModule.getWorkbookXml).mockResolvedValue(Ok(LIVE_XML));
    vi.mocked(metadataModule.listAvailableFields).mockReturnValue(mockFields as any);
    const listWorkbookDatasources = vi.fn().mockResolvedValue(
      new Err({
        type: 'command-failed',
        error: { code: 'not-found', message: 'No route matches GET /v0/workbook/datasources' },
      }),
    );
    const extra = {
      ...getMockRequestHandlerExtra(),
      getExecutor: vi.fn().mockResolvedValue({ listWorkbookDatasources } as any),
    };

    const result = await getResult({
      session: SESSION,
      verbosity: 'slim',
      hasLuid: true,
      extra,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(
      'does not serve the workbook datasources endpoint yet',
    );
  });
});

function mockLiveWorkbookDatasourceMetadata(
  workbookDatasources: any[],
  workbookFields: any[] = mockFields,
): {
  extra: ReturnType<typeof getMockRequestHandlerExtra>;
  listWorkbookDatasources: ReturnType<typeof vi.fn>;
} {
  vi.mocked(getWorkbookXmlModule.getWorkbookXml).mockResolvedValue(Ok(LIVE_XML));
  vi.mocked(metadataModule.listAvailableFields).mockReturnValue(workbookFields as any);
  const listWorkbookDatasources = vi
    .fn()
    .mockResolvedValue(Ok({ datasources: workbookDatasources }));
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: vi.fn().mockResolvedValue({ listWorkbookDatasources } as any),
  };
  return { extra, listWorkbookDatasources };
}

function parseBody(result: CallToolResult): any {
  expect(result.isError).toBe(false);
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text);
}

async function getResult({
  workbookFile,
  session,
  verbosity,
  hasLuid,
  luids,
  extra,
}: {
  workbookFile?: string;
  session?: string;
  verbosity?: 'slim' | 'full';
  hasLuid?: boolean;
  luids?: string[];
  extra?: ReturnType<typeof getMockRequestHandlerExtra>;
}): Promise<CallToolResult> {
  const tool = getListAvailableFieldsTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    { session, workbookFile, verbosity, hasLuid, luids },
    extra ?? getMockRequestHandlerExtra(),
  );
}
