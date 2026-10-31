import { z } from 'zod';

import { analyzeLineageImpact } from '../../../tools/web/dataLineage/dataImpact.js';
import { dataLineageParams, DataLineageResult, LineageOptions } from '../types/dataLineage.js';
import { DataLineageTraversal, LineageWireNode } from './dataLineage.js';

const flowLuid = '11111111-1111-4111-8111-111111111111';
const options = (values: Partial<LineageOptions> = {}): LineageOptions =>
  z.object(dataLineageParams).parse({ source: { type: 'column', id: 'c' }, ...values });
const node = (id: string, type: string, extra: Record<string, unknown> = {}): LineageWireNode => ({
  id,
  __typename: type,
  name: id,
  ...extra,
});
const page = (
  nodes: unknown[],
  hasNextPage = false,
  endCursor: string | null = null,
): { nodes: unknown[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } => ({
  nodes,
  pageInfo: { hasNextPage, endCursor },
});

/** A small graph service fixture, independently specified as asset identities
 * and adjacency lists rather than precomputed expected traversal output. */
function graphService(
  nodes: LineageWireNode[],
  links: Record<string, Record<string, unknown>> = {},
): ReturnType<typeof vi.fn<(query: string) => Promise<unknown>>> {
  return vi.fn(async (query: string) => {
    const root = query.match(/asset: (\w+)/)?.[1];
    const literal = query.match(/filter: \{ (id|luid|name): ("(?:\\.|[^"\\])*")/);
    const filter = literal ? { key: literal[1], value: JSON.parse(literal[2]) } : undefined;
    const types: Record<string, string[]> = {
      columnsConnection: ['Column'],
      fieldsConnection: ['ColumnField', 'CalculatedField', 'DatasourceField'],
      flowsConnection: ['Flow'],
      flowColumnInputFieldsConnection: ['FlowColumnInputField'],
      flowFieldInputFieldsConnection: ['FlowFieldInputField'],
      flowColumnOutputFieldsConnection: ['FlowColumnOutputField'],
      flowFieldOutputFieldsConnection: ['FlowFieldOutputField'],
      flowOutputStepsConnection: ['FlowOutputStep'],
      sheetsConnection: ['Sheet'],
      dashboardsConnection: ['Dashboard'],
      publishedDatasourcesConnection: ['PublishedDatasource'],
      embeddedDatasourcesConnection: ['EmbeddedDatasource'],
      workbooksConnection: ['Workbook'],
    };
    const selected = nodes.filter(
      (n) =>
        types[root ?? '']?.includes(n.__typename) && (!filter || n[filter.key] === filter.value),
    );
    return {
      data: {
        asset: page(
          selected.map((owner) => {
            const value = { ...owner };
            for (const match of query.matchAll(/\b(r\d+): (\w+)/g)) {
              const [, alias, field] = match;
              const target = links[owner.id]?.[field] ?? owner[field];
              value[alias] = field.endsWith('Connection')
                ? page(Array.isArray(target) ? target : [])
                : (target ?? null);
            }
            return value;
          }),
        ),
      },
    };
  });
}

async function traverse(
  graphql: (q: string) => Promise<unknown>,
  values: Partial<LineageOptions> = {},
  isAllowed = async () => true,
): Promise<DataLineageResult> {
  const traversal = new DataLineageTraversal(options(values), {
    graphql,
    isAllowed,
    prepEnabled: true,
  });
  await traversal.resolve();
  await traversal.expand();
  return traversal.result;
}

describe('Metadata data lineage traversal', () => {
  it('traces published datasource fields through a permitted Prep input/output to a dashboard', async () => {
    const flow = node('f', 'Flow', { luid: flowLuid });
    const input = node('i', 'FlowFieldInputField', { flow: { id: 'f', luid: flowLuid } });
    const output = node('o', 'FlowFieldOutputField', { flow: [{ id: 'f', luid: flowLuid }] });
    const source = node('published-source', 'ColumnField'),
      target = node('published-target', 'ColumnField');
    const sheet = node('s', 'Sheet'),
      dashboard = node('d', 'Dashboard');
    const api = graphService([source, flow, input, output, target, sheet, dashboard], {
      'published-source': { referencedByFlowFieldInputFieldConnection: [input] },
      f: { inputFieldsConnection: [input] },
      i: { childFieldsConnection: [output], flow },
      o: { field: target },
      'published-target': { directSheetsConnection: [sheet] },
      s: { containedInDashboardsConnection: [dashboard] },
    });
    const graph = await traverse(api, {
      source: { type: 'field', id: source.id },
      maxDepth: 8,
      includePrepDetails: true,
    });
    expect(graph.nodes.find((item) => item.metadataId === 'f')?.name).toBe('f');
    const impact = analyzeLineageImpact(graph).find((item) => item.nodeId === 'metadata:d');
    expect(impact?.classification).toBe('indirect');
    expect(impact?.path.nodeIds).toEqual([
      'metadata:published-source',
      'metadata:i',
      'metadata:o',
      'metadata:published-target',
      'metadata:s',
      'metadata:d',
    ]);
  });

  it('traces a column through a calculation, sheet and dashboard without attributing unrelated fields', async () => {
    const c = node('c', 'Column'),
      sales = node('sales', 'ColumnField'),
      calc = node('margin', 'CalculatedField', { formula: '[sales] / [cost]' }),
      sheet = node('monthly', 'Sheet'),
      dashboard = node('kpi', 'Dashboard'),
      ds = node('ds', 'PublishedDatasource'),
      unused = node('unused', 'CalculatedField');
    const api = graphService([c, sales, calc, sheet, dashboard, ds, unused], {
      c: { referencedByFieldsConnection: [sales], downstreamDashboardsConnection: [dashboard] },
      sales: { referencedByCalculationsConnection: [calc], datasource: ds },
      margin: { directSheetsConnection: [sheet], datasource: ds },
      monthly: { containedInDashboardsConnection: [dashboard] },
      ds: { fieldsConnection: [sales, calc, unused] },
    });
    const graph = await traverse(api);
    expect(graph.resolution).toBe('resolved');
    expect(graph.nodes.map((n) => n.metadataId)).not.toContain('unused');
    const impact = analyzeLineageImpact(graph).find((i) => i.nodeId === 'metadata:kpi');
    expect(impact?.classification).toBe('indirect');
    expect(impact?.path.nodeIds).toEqual([
      'metadata:c',
      'metadata:sales',
      'metadata:margin',
      'metadata:monthly',
      'metadata:kpi',
    ]);
    expect(graph.nodes.find((n) => n.metadataId === 'margin')?.formula).toBe('[sales] / [cost]');
  });

  it('traces two Prep flows through their explicit input/output column relationships', async () => {
    const c = node('c', 'Column'),
      f1 = node('f1', 'Flow', { luid: flowLuid }),
      f2 = node('f2', 'Flow', { luid: '22222222-2222-4222-8222-222222222222' });
    const i1 = node('i1', 'FlowColumnInputField', { flow: f1 }),
      o1 = node('o1', 'FlowColumnOutputField', { flow: [f1] });
    const mart = node('mart', 'Column'),
      i2 = node('i2', 'FlowColumnInputField', { flow: f2 }),
      o2 = node('o2', 'FlowFieldOutputField', { flow: [f2] }),
      field = node('final', 'ColumnField'),
      sheet = node('s', 'Sheet');
    const api = graphService([c, f1, f2, i1, o1, mart, i2, o2, field, sheet], {
      c: { referencedByFlowColumnInputFieldConnection: [i1] },
      i1: { childFieldsConnection: [o1], flow: f1 },
      o1: { column: mart },
      mart: { referencedByFlowColumnInputFieldConnection: [i2] },
      i2: { childFieldsConnection: [o2], flow: f2 },
      o2: { field },
      final: { directSheetsConnection: [sheet] },
    });
    const graph = await traverse(api, { maxDepth: 12 });
    expect(
      analyzeLineageImpact(graph).find((i) => i.nodeId === 'metadata:s')?.path.nodeIds,
    ).toEqual([
      'metadata:c',
      'metadata:i1',
      'metadata:o1',
      'metadata:mart',
      'metadata:i2',
      'metadata:o2',
      'metadata:final',
      'metadata:s',
    ]);
  });

  it('keeps a transitive rollup possible even when it is one graph hop', async () => {
    const c = node('c', 'Column'),
      dashboard = node('d', 'Dashboard');
    const graph = await traverse(
      graphService([c, dashboard], { c: { downstreamDashboardsConnection: [dashboard] } }),
    );
    expect(analyzeLineageImpact(graph)).toMatchObject([
      { nodeId: 'metadata:d', classification: 'possible' },
    ]);
  });

  it('handles cycles without revisiting assets or reporting the origin as an impact', async () => {
    const a = node('a', 'CalculatedField'),
      b = node('b', 'CalculatedField');
    const api = graphService([a, b], {
      a: { referencedByCalculationsConnection: [b] },
      b: { referencedByCalculationsConnection: [a] },
    });
    const graph = await traverse(api, { source: { type: 'field', id: 'a' } });
    expect(api).toHaveBeenCalledTimes(3);
    expect(analyzeLineageImpact(graph).map((i) => i.nodeId)).toEqual(['metadata:b']);
  });

  it('supports upstream field references without exploring sibling downstream users', async () => {
    const a = node('a', 'CalculatedField'),
      b = node('b', 'ColumnField'),
      c = node('c', 'Column'),
      sibling = node('sibling', 'CalculatedField');
    const graph = await traverse(
      graphService([a, b, c, sibling], {
        a: { fieldsConnection: [b] },
        b: { columnsConnection: [c], referencedByCalculationsConnection: [sibling] },
      }),
      { source: { type: 'field', id: 'a' }, direction: 'upstream' },
    );
    expect(graph.nodes.map((n) => n.metadataId)).toEqual(['a', 'b', 'c']);
    expect(graph.edges.map((e) => [e.from, e.to])).toEqual([
      ['metadata:b', 'metadata:a'],
      ['metadata:c', 'metadata:b'],
    ]);
  });

  it('rejects ambiguous named columns and preserves table qualifications', async () => {
    const a = node('a', 'Column', {
        name: 'Sales',
        table: { name: 'orders', schema: 'dbo', database: { name: 'db1' } },
      }),
      b = node('b', 'Column', {
        name: 'Sales',
        table: { name: 'orders', schema: 'dbo', database: { name: 'db2' } },
      });
    const api = graphService([a, b]);
    expect(
      (await traverse(api, { source: { type: 'column', name: 'Sales', table: 'orders' } }))
        .resolution,
    ).toBe('ambiguous');
    const graph = await traverse(api, {
      source: { type: 'column', name: 'Sales', table: 'orders', database: 'db2', schema: 'dbo' },
    });
    expect(graph.sourceId).toBe('metadata:b');
    expect(graph.nodes[0].table?.database).toBe('db2');
  });

  it('follows candidate pagination instead of selecting the first named match', async () => {
    const a = node('a', 'Column', { name: 'Sales', table: { name: 'orders' } }),
      b = node('b', 'Column', { name: 'Sales', table: { name: 'orders' } });
    const api = vi.fn(async (q: string) => ({
      data: { asset: q.includes('after: "p2"') ? page([b]) : page([a], true, 'p2') },
    }));
    const graph = await traverse(api, {
      source: { type: 'column', name: 'Sales', table: 'orders' },
    });
    expect(graph.resolution).toBe('ambiguous');
    expect(api).toHaveBeenCalledTimes(2);
  });

  it('paginates relationship connections and detects a non-advancing cursor', async () => {
    const c = node('c', 'Column'),
      a = node('a', 'ColumnField'),
      b = node('b', 'ColumnField');
    const api = vi.fn(async (q: string) => ({
      data: {
        asset: page([
          {
            ...c,
            ...(q.includes('r0:')
              ? {
                  r0: q.includes('after: "next"')
                    ? page([b], true, 'next')
                    : page([a], true, 'next'),
                }
              : {}),
          },
        ]),
      },
    }));
    const graph = await traverse(api, { maxRequests: 3 });
    expect(graph.nodes.map((n) => n.metadataId)).toContain('b');
    expect(graph.warnings.some((w) => w.code === 'INVALID_CURSOR')).toBe(true);
  });

  it.each([
    { maxRequests: 1, code: 'REQUEST_LIMIT' },
    { maxNodes: 1, code: 'NODE_LIMIT' },
    { maxEdges: 1, code: 'EDGE_LIMIT' },
    { maxDepth: 1, code: 'DEPTH_LIMIT' },
  ])('reports configured limits $code', async ({ code, ...limit }) => {
    const c = node('c', 'Column'),
      a = node('a', 'ColumnField'),
      b = node('b', 'CalculatedField');
    const graph = await traverse(
      graphService([c, a, b], {
        c: { referencedByFieldsConnection: [a, b] },
        a: { referencedByCalculationsConnection: [b] },
      }),
      limit,
    );
    expect(graph.coverage.truncated).toBe(true);
    expect(graph.warnings.some((w) => w.code === code)).toBe(true);
  });

  it('does not expose or traverse denied identities, nested owners, formulas or paths', async () => {
    const c = node('c', 'Column'),
      secret = node('private-id', 'CalculatedField', {
        name: 'Private name',
        formula: 'private formula',
        datasource: { id: 'private-ds', __typename: 'PublishedDatasource', luid: 'private-luid' },
      });
    const api = graphService([c, secret], { c: { referencedByFieldsConnection: [secret] } });
    const graph = await traverse(
      api,
      {},
      async (...args: unknown[]) => (args[0] as LineageWireNode).id !== 'private-id',
    );
    expect(JSON.stringify(graph)).not.toMatch(/private|Private/);
    expect(api.mock.calls).toHaveLength(2);
  });

  it('never emits an unconfirmed reverse Prep input or sends FILTER to its unsupported root', async () => {
    const field = node('a', 'ColumnField'),
      hidden = node('hidden', 'FlowFieldInputField');
    const api = graphService([field], {
      a: { referencedByFlowFieldInputFieldConnection: [hidden] },
    });
    const graph = await traverse(api, { source: { type: 'field', id: 'a' } });
    expect(
      api.mock.calls.some(
        ([q]) =>
          q.includes('flowFieldInputFieldsConnection') && !q.includes('permissionMode: FILTER'),
      ),
    ).toBe(true);
    expect(graph.nodes.map((n) => n.metadataId)).not.toContain('hidden');
  });

  it('hydrates discovery-only Prep inputs through an owning Flow FILTER connection', async () => {
    const flow = node('f', 'Flow', { luid: flowLuid });
    const discovered = node('i', 'FlowFieldInputField', {
      name: 'UNVERIFIED_NAME',
      flow: { id: 'f', luid: flowLuid },
    });
    const verified = { ...discovered, name: 'Confirmed input' };
    const api = graphService([discovered, flow], { f: { inputFieldsConnection: [verified] } });
    const graph = await traverse(api, { source: { type: 'flow-input-field', id: 'i' } });
    expect(graph.resolution).toBe('resolved');
    expect(graph.nodes.find((n) => n.metadataId === 'i')?.name).toBe('Confirmed input');
    expect(JSON.stringify(graph)).not.toContain('UNVERIFIED_NAME');
    expect(graph.coverage.permissionMode).toBe('FILTER_WITH_VERIFIED_PREP_INPUTS');
    expect(
      api.mock.calls.some(
        ([q]) =>
          q.includes('asset: flowsConnection') &&
          q.includes(
            'inputFieldsConnection(filter: { id: "i" }, first: 1, permissionMode: FILTER)',
          ),
      ),
    ).toBe(true);
  });

  it.each([false, true])(
    'omits unverified Prep input identities from source candidates (missing owner=%s)',
    async (missingOwner) => {
      const flow = node('f', 'Flow', { luid: flowLuid });
      const input = node('PRIVATE_INPUT', 'FlowFieldInputField', {
        name: 'PRIVATE_NAME',
        ...(missingOwner ? {} : { flow: { id: 'f', luid: flowLuid } }),
      });
      const api = graphService([input, flow]);
      const graph = await traverse(api, { source: { type: 'flow-input-field', id: input.id } });
      expect(graph.resolution).toBe('unavailable');
      expect(JSON.stringify(graph)).not.toMatch(/PRIVATE_INPUT|PRIVATE_NAME/);
      expect(graph.warnings.some((w) => w.code === 'PREP_INPUT_VISIBILITY_UNVERIFIED')).toBe(true);
    },
  );

  it('treats partial, error-only and invalid responses as unavailable rather than no impact', async () => {
    for (const response of [
      {
        data: { asset: page([node('c', 'Column')]) },
        errors: [{ message: 'sensitive server detail' }],
      },
      { errors: [{ message: 'forbidden' }] },
      { data: null },
      { data: { asset: {} } },
    ]) {
      const graph = await traverse(async () => response);
      expect(graph.resolution).toBe('unavailable');
      expect(graph.warnings.length).toBeGreaterThan(0);
      expect(JSON.stringify(graph)).not.toContain('sensitive server detail');
    }
  });

  it('encodes source text as a GraphQL literal without allowing injected selections', async () => {
    const id = 'x" }) { users { password } } #\n';
    const api = graphService([]);
    await traverse(api, { source: { type: 'column', id } });
    expect(api.mock.calls[0][0]).toContain(`id: ${JSON.stringify(id)}`);
  });

  it('honors cancellation before requesting metadata', async () => {
    const controller = new AbortController();
    controller.abort();
    const graphql = vi.fn();
    const traversal = new DataLineageTraversal(options(), {
      graphql,
      isAllowed: async () => true,
      prepEnabled: true,
      signal: controller.signal,
    });
    await expect(traversal.resolve()).rejects.toThrow();
    expect(graphql).not.toHaveBeenCalled();
  });
});
