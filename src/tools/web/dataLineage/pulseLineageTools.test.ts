import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { dataLineageParams, LineageOptions } from '../../../sdks/tableau/types/dataLineage.js';
import { PulseLineageRequest } from '../../../sdks/tableau/types/pulseLineage.js';
import { DATA_LINEAGE_API_SCOPES, PULSE_LINEAGE_API_SCOPES } from '../../../server/oauth/scopes.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { executeDataLineage } from './executeDataLineage.js';

const mocks = vi.hoisted(() => ({
  graphql: vi.fn(),
  pulse: vi.fn(),
  session: vi.fn(),
  allowed: vi.fn(),
}));
vi.mock('../../../features/flowTools.js', () => ({ isFlowReadToolsEnabled: async () => false }));
vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: (args: unknown) => mocks.session(args),
}));
vi.mock('../resourceAccessChecker.js', () => ({
  resourceAccessChecker: {
    isDatasourceAllowed: mocks.allowed,
    isWorkbookAllowed: mocks.allowed,
    isViewAllowed: mocks.allowed,
    isFlowAllowed: mocks.allowed,
  },
}));
const ds = '11111111-1111-4111-8111-111111111111',
  def = '22222222-2222-4222-8222-222222222222';
const owner = { id: 'ds', __typename: 'PublishedDatasource', luid: ds };
const field = { id: 'f', name: 'B', __typename: 'ColumnField', datasource: owner };
const page = (nodes: unknown[]): object => ({
  nodes,
  pageInfo: { hasNextPage: false, endCursor: null },
});
const args = (input: Record<string, unknown> = {}): LineageOptions =>
  z.object(dataLineageParams).parse({ source: { type: 'field', id: 'f' }, ...input });
const extra = (disableMetadataApiRequests = false): ReturnType<typeof getMockRequestHandlerExtra> =>
  getMockRequestHandlerExtra({
    getConfigWithOverrides: vi.fn().mockResolvedValue({
      disableMetadataApiRequests,
      boundedContext: {
        projectIds: null,
        datasourceIds: null,
        workbookIds: null,
        viewIds: null,
        tags: null,
      },
    }),
  });
const version = { value: '2026.3.0', build: '' };

describe('Pulse lineage callback guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.allowed.mockResolvedValue({ allowed: true });
    mocks.graphql.mockImplementation(async (query: string) => {
      if (query.includes('pulseFields:'))
        return { data: { asset: page([{ ...owner, pulseFields: page([field]) }]) } };
      const relations = Object.fromEntries(
        [...query.matchAll(/\b(r\d+): (\w+)/g)].map((match) => [
          match[1],
          match[2].endsWith('Connection') ? page([]) : null,
        ]),
      );
      return { data: { asset: page([{ ...field, ...relations }]) } };
    });
    mocks.pulse.mockImplementation(
      async (request: PulseLineageRequest) =>
        new Ok(
          request.kind === 'definitions'
            ? {
                definitions: [
                  {
                    metadata: { id: def, name: 'Sales' },
                    specification: { datasource: { id: ds }, measure: { field: 'B' } },
                  },
                ],
              }
            : { metrics: [] },
        ),
    );
    mocks.session.mockImplementation(async ({ callback }) =>
      callback({
        metadataMethods: { graphql: mocks.graphql },
        pulseMethods: { readPulseLineage: mocks.pulse },
        siteId: 'site',
      }),
    );
  });
  it('keeps legacy metadata calls free of Pulse requests and grants', async () => {
    const graph = await executeDataLineage(args(), extra(), version);
    expect(graph.resolution).toBe('resolved');
    expect(mocks.pulse).not.toHaveBeenCalled();
    expect(mocks.session.mock.calls).toHaveLength(1);
    expect(mocks.session.mock.calls[0][0].jwtScopes).toEqual(
      DATA_LINEAGE_API_SCOPES.filter((scope) => scope !== 'tableau:flows:read'),
    );
  });
  it('requests the separate read-only Pulse grant only on opt-in', async () => {
    const graph = await executeDataLineage(args({ includePulseDetails: true }), extra(), version);
    expect(graph.nodes.some((node) => node.kind === 'pulse-definition')).toBe(true);
    expect(
      mocks.session.mock.calls.some(
        ([request]) =>
          JSON.stringify(request.jwtScopes) === JSON.stringify(PULSE_LINEAGE_API_SCOPES),
      ),
    ).toBe(true);
    expect(mocks.session.mock.calls[0][0].jwtScopes).not.toContain('tableau:insight_metrics:read');
  });
  it('starts at a Pulse origin without a Metadata root or Prep enablement', async () => {
    const graph = await executeDataLineage(
      args({ source: { type: 'pulse-definition', luid: def }, direction: 'upstream' }),
      extra(),
      version,
    );
    expect(graph.sourceId).toBe(`pulse:definition:${def}`);
    expect(graph.nodes.some((node) => node.id === 'metadata:f')).toBe(true);
    expect(mocks.graphql.mock.calls.some(([query]) => query.includes('pulseFields:'))).toBe(true);
  });
  it('can read permitted Pulse configuration with Metadata disabled while leaving field bindings unresolved', async () => {
    const graph = await executeDataLineage(
      args({ source: { type: 'pulse-definition', luid: def }, direction: 'upstream' }),
      extra(true),
      version,
    );
    expect(graph.resolution).toBe('resolved');
    expect(graph.coverage.metadata).toBe('unavailable');
    expect(graph.pulseDetails?.[0].uses[0].status).toBe('unresolved');
    expect(mocks.graphql).not.toHaveBeenCalled();
  });
  it('preserves catalog evidence when the separate Pulse session cannot be authorized', async () => {
    const normal = mocks.session.getMockImplementation()!;
    mocks.session.mockImplementation(async (request) => {
      if (request.jwtScopes.includes('tableau:insight_metrics:read'))
        throw new Error('PRIVATE_AUTH_DETAIL');
      return normal(request);
    });
    const graph = await executeDataLineage(args({ includePulseDetails: true }), extra(), version);
    expect(graph.resolution).toBe('resolved');
    expect(graph.coverage.pulse).toBe('unavailable');
    expect(JSON.stringify(graph)).not.toContain('PRIVATE_AUTH_DETAIL');
  });
  it('marks a Pulse origin unavailable on session failure instead of returning a safe empty result', async () => {
    const normal = mocks.session.getMockImplementation()!;
    mocks.session.mockImplementation(async (request) =>
      request.jwtScopes.includes('tableau:insight_metrics:read')
        ? Promise.reject(new Error('PRIVATE'))
        : normal(request),
    );
    const graph = await executeDataLineage(
      args({ source: { type: 'pulse-definition', luid: def } }),
      extra(),
      version,
    );
    expect(graph.resolution).toBe('unavailable');
    expect(graph.sourceId).toBeUndefined();
  });
  it('does not request any Tableau/Pulse service for a local file even when Pulse details are requested', async () => {
    const graph = await executeDataLineage(
      args({
        source: { type: 'local-flow', path: 'C:/Prep/not-configured.tfl' },
        includePulseDetails: true,
      }),
      extra(),
      version,
    );
    expect(mocks.session).not.toHaveBeenCalled();
    expect(graph.coverage.pulse).toBe('not-requested');
    expect(graph.warnings.some((warning) => warning.code === 'PULSE_LOCAL_UNBOUND')).toBe(true);
  });
});
