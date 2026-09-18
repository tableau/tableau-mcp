import { Ok } from 'ts-results-es';

import { stubDefaultEnvVars, testProductVersion } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import {
  applyDatasourceWiring,
  buildDatasourceWiringEdits,
  DatasourceDescriptor,
  deriveField,
  esc,
  resolveDatasourceDescriptor,
  typeOf,
  WiringField,
} from './datasourceWiring.js';

const mocks = vi.hoisted(() => ({
  mockQueryDatasource: vi.fn(),
  mockReadMetadata: vi.fn(),
  mockGetDatasourceModel: vi.fn(),
  mockGraphql: vi.fn(),
  mockIsDatasourceAllowed: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      siteId: 'test-site-id',
      datasourcesMethods: {
        queryDatasource: mocks.mockQueryDatasource,
      },
      vizqlDataServiceMethods: {
        readMetadata: mocks.mockReadMetadata,
        getDatasourceModel: mocks.mockGetDatasourceModel,
      },
      metadataMethods: {
        graphql: mocks.mockGraphql,
      },
    }),
  ),
}));

vi.mock('../resourceAccessChecker.js', () => ({
  resourceAccessChecker: {
    isDatasourceAllowed: mocks.mockIsDatasourceAllowed,
  },
}));

describe('typeOf', () => {
  it('maps real/integer to quantitative, date/datetime to ordinal, everything else to nominal', () => {
    expect(typeOf('real')).toBe('quantitative');
    expect(typeOf('INTEGER')).toBe('quantitative');
    expect(typeOf('date')).toBe('ordinal');
    expect(typeOf('DateTime')).toBe('ordinal');
    expect(typeOf('string')).toBe('nominal');
    expect(typeOf('unknown-type')).toBe('nominal');
  });
});

describe('deriveField', () => {
  it('derives measure attributes (Sum aggregation, role 1, sum: instance name)', () => {
    const field: WiringField = { name: 'Profit', datatype: 'real', role: 'measure' };
    const derived = deriveField(field, 2);
    expect(derived.type).toBe('quantitative');
    expect(derived.ordinal).toBe(2);
    expect(derived.aggregation).toBe('Sum');
    expect(derived.roleAttr).toBe(1);
    expect(derived.localName).toBe('[Profit]');
    expect(derived.derivation).toBe('Sum');
    expect(derived.instanceName).toBe('[sum:Profit:qk]');
  });

  it('derives dimension attributes (Count aggregation, role 0, none: instance name)', () => {
    const field: WiringField = { name: 'Region', datatype: 'string', role: 'dimension' };
    const derived = deriveField(field, 0);
    expect(derived.type).toBe('nominal');
    expect(derived.aggregation).toBe('Count');
    expect(derived.roleAttr).toBe(0);
    expect(derived.derivation).toBe('None');
    expect(derived.instanceName).toBe('[none:Region:nk]');
  });
});

describe('esc', () => {
  it('escapes XML special characters', () => {
    expect(esc('<a> & \'b\' "c"')).toBe('&lt;a&gt; &amp; &apos;b&apos; &quot;c&quot;');
  });

  it('stringifies numbers', () => {
    expect(esc(443)).toBe('443');
  });
});

const baseDescriptor: DatasourceDescriptor = {
  caption: 'Superstore',
  repositoryId: 'superstore',
  site: 'tc25',
  server: 'my-tableau-server.com',
  channel: 'https',
  port: 443,
  fields: [
    { name: 'Profit', datatype: 'real', role: 'measure' },
    { name: 'Region', datatype: 'string', role: 'dimension' },
  ],
};

describe('buildDatasourceWiringEdits', () => {
  it('builds root and view XML blocks that share the same generated connection name', () => {
    const edits = buildDatasourceWiringEdits(baseDescriptor);
    expect(edits.connectionName).toMatch(/^sqlproxy\./);
    expect(edits.rootDatasourceXml).toContain(`name='${edits.connectionName}'`);
    expect(edits.rootDatasourceXml).toContain(`connection='${edits.connectionName}'`);
    expect(edits.rootDatasourceXml).toContain("caption='Superstore'");
    expect(edits.rootDatasourceXml).toContain('<remote-name>Profit</remote-name>');
    expect(edits.rootDatasourceXml).toContain('<aggregation>Sum</aggregation>');
    expect(edits.viewDatasourceXml).toContain(`name='${edits.connectionName}'`);
    expect(edits.viewDatasourceXml).toContain(`datasource='${edits.connectionName}'`);
    expect(edits.viewDatasourceXml).toContain("name='[Profit]'");
  });

  it('reuses a caller-provided connectionName instead of generating one', () => {
    const edits = buildDatasourceWiringEdits({
      ...baseDescriptor,
      connectionName: 'sqlproxy.custom-name',
    });
    expect(edits.connectionName).toBe('sqlproxy.custom-name');
  });

  it('throws when fields is empty', () => {
    expect(() => buildDatasourceWiringEdits({ ...baseDescriptor, fields: [] })).toThrow(
      /at least one field/,
    );
  });

  it('throws when a caller-provided connectionName does not start with "sqlproxy."', () => {
    expect(() =>
      buildDatasourceWiringEdits({ ...baseDescriptor, connectionName: 'not-a-sqlproxy-name' }),
    ).toThrow(/must start with "sqlproxy\."/);
  });

  it('escapes field names and caption containing XML-unsafe characters', () => {
    const edits = buildDatasourceWiringEdits({
      ...baseDescriptor,
      caption: 'Sales & <Profit>',
      fields: [{ name: 'Bob\'s "Field"', datatype: 'string', role: 'dimension' }],
    });
    expect(edits.rootDatasourceXml).toContain('Sales &amp; &lt;Profit&gt;');
    expect(edits.rootDatasourceXml).toContain('Bob&apos;s &quot;Field&quot;');
  });
});

describe('applyDatasourceWiring', () => {
  it('resolves the root anchor then the view anchor, in that order', () => {
    const edits = buildDatasourceWiringEdits(baseDescriptor);
    const twb = 'before<datasources />middle<datasources />after';
    const wired = applyDatasourceWiring(twb, edits);
    expect(wired).toBe(`before${edits.rootDatasourceXml}middle${edits.viewDatasourceXml}after`);
    expect(wired).not.toContain('<datasources />');
  });

  it('throws when the root anchor is missing', () => {
    const edits = buildDatasourceWiringEdits(baseDescriptor);
    expect(() => applyDatasourceWiring('no anchors here', edits)).toThrow(/Root.*anchor not found/);
  });

  it('throws when the view anchor is missing after the root anchor is resolved', () => {
    const edits = buildDatasourceWiringEdits(baseDescriptor);
    expect(() => applyDatasourceWiring('only one <datasources />', edits)).toThrow(
      /View.*anchor not found/,
    );
  });

  it('throws when an empty anchor survives wiring (three anchors present)', () => {
    const edits = buildDatasourceWiringEdits(baseDescriptor);
    expect(() =>
      applyDatasourceWiring('<datasources /><datasources /><datasources />', edits),
    ).toThrow(/survived wiring/);
  });

  it('succeeds when the connection name appears at least 4 times', () => {
    const twb = 'before<datasources />middle<datasources />after';
    const wired = applyDatasourceWiring(twb, {
      connectionName: 'sqlproxy.abc',
      rootDatasourceXml:
        "<datasource name='sqlproxy.abc'><relation connection='sqlproxy.abc' /></datasource>",
      viewDatasourceXml:
        "<datasource name='sqlproxy.abc' /><datasource-dependencies datasource='sqlproxy.abc'>",
    });
    expect(wired).toBeDefined();
  });

  it('rejects wiring where the connection name appears fewer than 4 times', () => {
    const twb = 'before<datasources />middle<datasources />after';
    expect(() =>
      applyDatasourceWiring(twb, {
        connectionName: 'sqlproxy.abc',
        rootDatasourceXml: "<datasource name='sqlproxy.abc' />",
        viewDatasourceXml: "<datasource name='sqlproxy.abc' />",
      }),
    ).toThrow(/wiring incomplete/);
  });
});

describe('resolveDatasourceDescriptor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    mocks.mockIsDatasourceAllowed.mockResolvedValue({ allowed: true });
    mocks.mockQueryDatasource.mockResolvedValue({
      name: 'Superstore',
      contentUrl: 'superstore',
      project: { id: 'proj-1' },
    });
    mocks.mockReadMetadata.mockResolvedValue(
      new Ok({
        data: [
          {
            fieldName: 'Profit',
            fieldCaption: 'Profit',
            dataType: 'REAL',
            defaultAggregation: 'SUM',
            logicalTableId: '',
            columnClass: 'COLUMN',
          },
          {
            fieldName: 'Region',
            fieldCaption: 'Region',
            dataType: 'STRING',
            defaultAggregation: 'COUNT',
            logicalTableId: '',
            columnClass: 'COLUMN',
          },
        ],
      }),
    );
    mocks.mockGetDatasourceModel.mockResolvedValue(new Ok({ logicalTables: [] }));
    mocks.mockGraphql.mockRejectedValue(new Error('metadata api disabled'));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('resolves server/site/channel/port from the configured SERVER URL', async () => {
    const result = await resolveDatasourceDescriptor({
      datasourceLuid: 'ds-1',
      extra: getMockRequestHandlerExtra(),
      productVersion: testProductVersion,
    });

    invariant(result.isOk(), result.isErr() ? result.error.message : '');
    expect(result.value.caption).toBe('Superstore');
    expect(result.value.repositoryId).toBe('superstore');
    expect(result.value.server).toBe('my-tableau-server.com');
    expect(result.value.channel).toBe('https');
    expect(result.value.port).toBe(443);
    expect(result.value.fields).toHaveLength(2);
  });

  it('returns every field when fieldNames is omitted', async () => {
    const result = await resolveDatasourceDescriptor({
      datasourceLuid: 'ds-1',
      extra: getMockRequestHandlerExtra(),
      productVersion: testProductVersion,
    });

    invariant(result.isOk());
    expect(result.value.fields.map((f) => f.name).sort()).toEqual(['Profit', 'Region']);
  });

  it('filters to the requested fieldNames, preserving caller-requested order', async () => {
    const result = await resolveDatasourceDescriptor({
      datasourceLuid: 'ds-1',
      fieldNames: ['Region', 'Profit'],
      extra: getMockRequestHandlerExtra(),
      productVersion: testProductVersion,
    });

    invariant(result.isOk());
    expect(result.value.fields.map((f) => f.name)).toEqual(['Region', 'Profit']);
  });

  it('returns UnknownDatasourceFieldError when a requested field does not exist', async () => {
    const result = await resolveDatasourceDescriptor({
      datasourceLuid: 'ds-1',
      fieldNames: ['Profit', 'Nonexistent'],
      extra: getMockRequestHandlerExtra(),
      productVersion: testProductVersion,
    });

    invariant(result.isErr());
    expect(result.error.type).toBe('unknown-datasource-field');
    expect(result.error.message).toContain('Nonexistent');
  });

  it('returns DatasourceNotAllowedError when the datasource is outside the bounded context', async () => {
    mocks.mockIsDatasourceAllowed.mockResolvedValue({
      allowed: false,
      message: 'not allowed',
    });

    const result = await resolveDatasourceDescriptor({
      datasourceLuid: 'ds-1',
      extra: getMockRequestHandlerExtra(),
      productVersion: testProductVersion,
    });

    invariant(result.isErr());
    expect(mocks.mockQueryDatasource).not.toHaveBeenCalled();
    expect(result.error.type).toBe('datasource-not-allowed');
  });
});
