import { z } from 'zod';

import {
  DataLineageTraversal,
  LineageWireNode,
} from '../../../sdks/tableau/methods/dataLineage.js';
import { dataLineageParams } from '../../../sdks/tableau/types/dataLineage.js';
import { PulseLineageRequest } from '../../../sdks/tableau/types/pulseLineage.js';
import { analyzeLineageImpact } from './dataImpact.js';
import { addPrepTopology } from './prepLineage.js';
import { pulseDownstreamContexts, PulseLineageCollector } from './pulseLineage.js';

const ds = '11111111-1111-4111-8111-111111111111';
const def = '22222222-2222-4222-8222-222222222222';
const metric = '33333333-3333-4333-8333-333333333333';
const foreign = '44444444-4444-4444-8444-444444444444';
const defId = `pulse:definition:${def}`,
  metricId = `pulse:metric:${metric}`;
const page = (nodes: unknown[], next = false, cursor: string | null = null): object => ({
  nodes,
  pageInfo: { hasNextPage: next, endCursor: cursor },
});
const datasource = (luid = ds): LineageWireNode => ({
  id: 'ds-' + luid,
  __typename: 'PublishedDatasource',
  luid,
  name: 'Published',
});
const field = (name = 'B', luid = ds, id = 'f-' + name): LineageWireNode => ({
  id,
  __typename: 'ColumnField',
  name,
  datasource: datasource(luid),
});
const definition = (extra: object = {}): Record<string, unknown> => ({
  metadata: { id: def, name: 'Sales Pulse' },
  specification: {
    datasource: { id: ds },
    basic_specification: {
      measure: { field: 'B', aggregation: 'SUM' },
      time_dimension: { field: 'Date' },
      filters: [{ field: 'B', categorical_values: [{ number_value: 2 }] }],
    },
  },
  extension_options: { allowed_dimensions: ['B', 'Region'] },
  ...extra,
});
const metricRow = (extra: object = {}): Record<string, unknown> => ({
  id: metric,
  definition_id: def,
  specification: { filters: [{ field: 'B', categorical_values: [{ number_value: 3 }] }] },
  ...extra,
});

async function setup(values: Record<string, unknown> = {}): Promise<{
  options: DataLineageTraversal['options'];
  traversal: DataLineageTraversal;
  collector: PulseLineageCollector;
  read: import('vitest').Mock<(request: PulseLineageRequest) => Promise<unknown>>;
  graphql: import('vitest').Mock<(query: string) => Promise<unknown>>;
  isAllowed: import('vitest').Mock<() => Promise<boolean>>;
  isDatasourceAllowed: import('vitest').Mock<(luid: string) => Promise<boolean>>;
  controller: AbortController;
  graph: DataLineageTraversal['result'];
}> {
  const options = z
    .object(dataLineageParams)
    .parse({ source: { type: 'field', id: 'f-B' }, maxDepth: 6, ...values });
  const graphql = vi
    .fn<(query: string) => Promise<unknown>>()
    .mockImplementation(async (query: string) => {
      const dsMatch = /luid: ("(?:\\.|[^"\\])*")/.exec(query);
      const nameMatch = /name: ("(?:\\.|[^"\\])*")/.exec(query);
      if (!dsMatch || !nameMatch) return { data: { asset: page([]) } };
      const luid = JSON.parse(dsMatch[1]) as string,
        name = JSON.parse(nameMatch[1]) as string;
      return {
        data: { asset: page([{ ...datasource(luid), pulseFields: page([field(name, luid)]) }]) },
      };
    });
  const read = vi
    .fn<(request: PulseLineageRequest) => Promise<unknown>>()
    .mockImplementation(async (request) =>
      request.kind === 'definitions' ? { definitions: [definition()] } : { metrics: [metricRow()] },
    );
  const isAllowed = vi.fn(async () => true),
    isDatasourceAllowed = vi.fn<(luid: string) => Promise<boolean>>().mockResolvedValue(true);
  const controller = new AbortController();
  const traversal = new DataLineageTraversal(options, {
    graphql,
    isAllowed,
    prepEnabled: true,
    signal: controller.signal,
  });
  const source = options.source;
  if (source.type === 'field') {
    await traversal.add(field(), 'field');
    traversal.result.sourceId = 'metadata:f-B';
    traversal.result.resolution = 'resolved';
  } else if (source.type === 'datasource') {
    await traversal.add(datasource(), 'datasource');
    traversal.result.sourceId = `metadata:ds-${ds}`;
    traversal.result.resolution = 'resolved';
  }
  const collector = new PulseLineageCollector(traversal, {
    read,
    isDatasourceAllowed,
    signal: controller.signal,
    metadataEnabled: true,
  });
  return {
    options,
    traversal,
    collector,
    read,
    graphql,
    isAllowed,
    isDatasourceAllowed,
    controller,
    graph: traversal.result,
  };
}

describe('Pulse lineage integration', () => {
  it('connects a saved Prep calculation through its exact output handoff to Pulse within catalog depth', async () => {
    const calc = '55555555-5555-4555-8555-555555555555';
    const test = await setup({ source: { type: 'flow', luid: foreign }, maxDepth: 3 });
    const flow = await test.traversal.add(
      { id: 'flow', __typename: 'Flow', luid: foreign },
      'flow',
    );
    await test.traversal.add(field(), 'field');
    await test.traversal.add(
      {
        id: 'output-field',
        __typename: 'FlowFieldOutputField',
        name: 'B',
        flow: { id: 'flow', luid: foreign },
        fieldId: `${calc}-B`,
        flowOutputStep: { stepId: 'out' },
      },
      'flow-output-field',
    );
    test.graph.resolution = 'resolved';
    test.graph.edges.push({
      id: 'output-published',
      from: 'metadata:output-field',
      to: 'metadata:f-B',
      relationship: 'field',
      evidence: 'direct',
      provenance: 'metadata-api',
      propagates: true,
    });
    addPrepTopology(
      test.traversal,
      flow!,
      {
        nodes: {
          start: {
            id: 'start',
            nodeType: '.v1.LoadCsv',
            fields: [{ name: 'A', type: 'real' }],
            nextNodes: [{ nextNodeId: calc }],
          },
          [calc]: {
            id: calc,
            nodeType: '.v1.AddColumn',
            columnName: 'B',
            expression: '[A] * 2',
            nextNodes: [{ nextNodeId: 'out' }],
          },
          out: { id: 'out', nodeType: '.v1.PublishExtract', nextNodes: [] },
        },
      },
      { type: 'prep-field', flowLuid: foreign, stepId: 'start', name: 'A' },
    );
    await test.collector.enrich();
    const impact = analyzeLineageImpact(test.graph).find((item) => item.nodeId === metricId);
    expect(
      impact?.classification,
      JSON.stringify({
        edges: test.graph.edges,
        bindings: test.graph.prepDetails?.[0].fieldAnalysis?.catalogBindings,
        source: test.graph.sourceId,
        warnings: test.graph.warnings,
      }),
    ).toBe('indirect');
    expect(impact?.path.nodeIds).toContain('metadata:output-field');
    expect(impact?.path.nodeIds).toContain('metadata:f-B');
    expect(test.graph.prepDetails?.[0].operations).toEqual(
      expect.arrayContaining([expect.objectContaining({ expression: '[A] * 2' })]),
    );
  });
  it('connects exact published field uses, saved values and metrics without unrelated inputs', async () => {
    const test = await setup();
    await test.collector.enrich();
    expect(test.graph.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining([defId, metricId]),
    );
    expect(
      test.graph.edges
        .filter((edge) => edge.from === 'metadata:f-B' && edge.to === defId)
        .map((edge) => edge.evidence),
    ).toEqual(expect.arrayContaining(['direct', 'possible']));
    expect(
      test.graph.pulseDetails?.find((detail) => detail.ownerId === metricId)?.uses[0],
    ).toMatchObject({
      datasourceLuid: ds,
      values: [3],
      status: 'resolved',
      fieldId: 'metadata:f-B',
    });
    expect(
      analyzeLineageImpact(test.graph).find((item) => item.nodeId === metricId)?.classification,
    ).toBe('direct');
    expect(test.graph.nodes.some((node) => node.name === 'Region' || node.name === 'Date')).toBe(
      false,
    );
    expect(test.graph.coverage.pulse).toBe('visible-subgraph');
  });
  it('keeps available breakdown dimensions possible rather than claiming actual metric use', async () => {
    const test = await setup();
    test.read.mockImplementation(async (request) =>
      request.kind === 'definitions'
        ? {
            definitions: [
              definition({
                specification: { datasource: { id: ds } },
                extension_options: { allowed_dimensions: ['B'] },
              }),
            ],
          }
        : { metrics: [metricRow({ specification: { filters: [] } })] },
    );
    await test.collector.enrich();
    const impacts = analyzeLineageImpact(test.graph);
    expect(impacts.find((item) => item.nodeId === defId)?.classification).toBe('possible');
    expect(impacts.find((item) => item.nodeId === metricId)?.classification).toBe('possible');
  });
  it('finds metric-only filter usage without making its parent definition a field impact', async () => {
    const test = await setup();
    test.read.mockImplementation(async (request) =>
      request.kind === 'definitions'
        ? {
            definitions: [
              definition({
                specification: { datasource: { id: ds } },
                extension_options: { allowed_dimensions: [] },
              }),
            ],
          }
        : { metrics: [metricRow()] },
    );
    await test.collector.enrich();
    expect(test.graph.nodes.some((node) => node.id === metricId)).toBe(true);
    expect(test.graph.nodes.some((node) => node.id === defId)).toBe(false);
  });
  it('inherits a missing metric datasource only from its exact fetched parent in the same request', async () => {
    const test = await setup({
      source: { type: 'pulse-metric', luid: metric },
      direction: 'upstream',
    });
    test.read.mockImplementation(async (request) =>
      request.kind === 'definitions' ? { definition: definition() } : { metric: metricRow() },
    );
    await test.collector.resolveSource();
    expect(test.graph.sourceId).toBe(metricId);
    expect(test.graph.nodes.find((node) => node.id === metricId)?.pulse).toEqual({
      datasourceLuid: ds,
      definitionLuid: def,
    });
    expect(test.graph.nodes.some((node) => node.name === 'B')).toBe(true);
    expect(test.read.mock.calls.some(([request]) => request.kind === 'metrics')).toBe(false);
  });
  it.each(['upstream', 'both'] as const)(
    'keeps Pulse metric %s walks out of sibling metrics',
    async (direction) => {
      const test = await setup({ source: { type: 'pulse-metric', luid: metric }, direction });
      const sibling = '55555555-5555-4555-8555-555555555555';
      test.read.mockImplementation(async (request) =>
        request.kind === 'definitions'
          ? {
              definition: definition({
                metrics: [metricRow({ id: sibling, datasource_luid: ds })],
              }),
            }
          : { metric: metricRow() },
      );
      await test.collector.resolveSource();
      expect(test.graph.nodes.some((node) => node.luid === sibling)).toBe(false);
      expect(test.read.mock.calls).toHaveLength(2);
    },
  );
  it('does not take a both-direction shared ancestor into unrelated downstream Pulse users', async () => {
    const test = await setup({ source: { type: 'workbook', luid: foreign }, direction: 'both' });
    await test.traversal.add({ id: 'workbook', __typename: 'Workbook', luid: foreign }, 'workbook');
    await test.traversal.add(field(), 'field');
    test.graph.sourceId = 'metadata:workbook';
    test.graph.resolution = 'resolved';
    test.graph.edges.push({
      id: 'upstream',
      from: 'metadata:f-B',
      to: 'metadata:workbook',
      relationship: 'uses',
      evidence: 'direct',
      provenance: 'metadata-api',
      propagates: true,
    });
    await test.collector.enrich();
    expect(test.read).not.toHaveBeenCalled();
    expect(test.graph.nodes.some((node) => node.kind === 'pulse-definition')).toBe(false);
  });
  it('never uses terminal datasource membership to fan out to Pulse', async () => {
    const test = await setup();
    await test.traversal.add(datasource(), 'datasource');
    test.graph.edges.push({
      id: 'container',
      from: 'metadata:f-B',
      to: `metadata:ds-${ds}`,
      relationship: 'datasource',
      evidence: 'direct',
      provenance: 'metadata-api',
      propagates: false,
    });
    expect(pulseDownstreamContexts(test.graph).has(`metadata:ds-${ds}`)).toBe(false);
    await test.collector.enrich();
    expect(
      test.graph.edges.some((edge) => edge.relationship === 'pulse-datasource-reference'),
    ).toBe(false);
  });
  it('allows a whole-datasource dependency even when its Pulse field specification is opaque', async () => {
    const test = await setup({ source: { type: 'datasource', luid: ds } });
    test.read.mockImplementation(async (request) =>
      request.kind === 'definitions'
        ? {
            definitions: [
              definition({
                specification: {
                  datasource: { id: ds },
                  viz_state_specification: { viz_state_string: 'DO_NOT_PARSE' },
                },
              }),
            ],
          }
        : { metrics: [] },
    );
    await test.collector.enrich();
    expect(
      test.graph.edges.some(
        (edge) =>
          edge.from === `metadata:ds-${ds}` && edge.to === defId && edge.evidence === 'direct',
      ),
    ).toBe(true);
    expect(test.graph.coverage.pulse).toBe('partial');
    expect(JSON.stringify(test.graph)).not.toContain('DO_NOT_PARSE');
  });
  it('keeps scopes separate for nested goals and equal names in other datasources', async () => {
    const test = await setup();
    await test.traversal.add(field('B', foreign, 'foreign-b'), 'field');
    test.read.mockImplementation(async (request) =>
      request.kind === 'definitions'
        ? {
            definitions: [
              definition({ goals: [{ datasource: { id: foreign }, measure: { field: 'B' } }] }),
            ],
          }
        : { metrics: [] },
    );
    await test.collector.enrich();
    expect(
      test.graph.edges.some(
        (edge) => edge.from === 'metadata:foreign-b' && edge.provenance === 'pulse-rest',
      ),
    ).toBe(false);
    expect(
      test.graph.pulseDetails?.[0].uses.some(
        (use) => use.path.includes('/goals/') && use.status === 'not-requested',
      ),
    ).toBe(true);
  });
  it('filters primary and nested datasource bounds before disclosing selectors or values', async () => {
    const test = await setup();
    test.isDatasourceAllowed.mockImplementation(async (luid) => luid === ds);
    test.read.mockImplementation(async (request) =>
      request.kind === 'definitions'
        ? {
            definitions: [
              definition({
                goals: [
                  {
                    datasource: { id: foreign },
                    measure: { field: 'PRIVATE_FIELD' },
                    filters: [
                      {
                        field: 'PRIVATE_FILTER',
                        categorical_values: [{ string_value: 'PRIVATE_VALUE' }],
                      },
                    ],
                  },
                ],
              }),
            ],
          }
        : { metrics: [] },
    );
    await test.collector.enrich();
    expect(JSON.stringify(test.graph)).not.toMatch(/PRIVATE_FIELD|PRIVATE_FILTER|PRIVATE_VALUE/);
    const denied = await setup({ source: { type: 'pulse-definition', luid: def } });
    denied.isDatasourceAllowed.mockResolvedValue(false);
    await denied.collector.resolveSource();
    expect(denied.graph.resolution).toBe('not-allowed');
    expect(denied.graph.nodes).toEqual([]);
  });
  it('requires a complete unique filtered lookup even if only one equal name is already in the graph', async () => {
    const test = await setup();
    test.graphql.mockImplementation(async () => ({
      data: {
        asset: page([
          { ...datasource(), pulseFields: page([field(), field('B', ds, 'duplicate')]) },
        ]),
      },
    }));
    await test.collector.enrich();
    expect(test.graph.nodes.some((node) => node.kind === 'pulse-definition')).toBe(false);
    expect(test.graph.warnings.some((warning) => warning.code === 'PULSE_FIELD_AMBIGUOUS')).toBe(
      true,
    );
  });
  it('refuses partial, stale-owner or non-advancing field lookup results', async () => {
    for (const variant of ['partial', 'owner', 'cursor'] as const) {
      const test = await setup();
      test.graphql.mockImplementation(async () => ({
        data: {
          asset: page([
            {
              ...datasource(),
              pulseFields: page(
                [variant === 'owner' ? field('B', foreign) : field()],
                variant === 'cursor',
                'same',
              ),
            },
          ]),
        },
        ...(variant === 'partial' ? { errors: [{ message: 'PRIVATE_ERROR' }] } : {}),
      }));
      await test.collector.enrich();
      expect(test.graph.edges.some((edge) => edge.provenance === 'pulse-rest')).toBe(false);
      expect(JSON.stringify(test.graph)).not.toContain('PRIVATE_ERROR');
    }
  });
  it('keeps opaque/missing root selector bindings explicit without discarding a visible Pulse origin', async () => {
    const test = await setup({
      source: { type: 'pulse-definition', luid: def },
      direction: 'upstream',
    });
    test.graphql.mockImplementation(async () => ({
      data: { asset: page([{ ...datasource(), pulseFields: page([]) }]) },
    }));
    await test.collector.resolveSource();
    expect(test.graph.resolution).toBe('resolved');
    expect(test.graph.pulseDetails?.[0].uses.every((use) => use.status === 'unresolved')).toBe(
      true,
    );
    expect(test.graph.coverage.pulse).toBe('partial');
  });
  it('stops repeated Pulse cursors without repeating metric collections', async () => {
    const test = await setup();
    test.read.mockImplementation(async (request) =>
      request.kind === 'definitions'
        ? { definitions: [definition()], next_page_token: 'same' }
        : { metrics: [] },
    );
    await test.collector.enrich();
    expect(test.read.mock.calls.filter(([request]) => request.kind === 'metrics')).toHaveLength(1);
    expect(test.graph.warnings.some((warning) => warning.code === 'PULSE_CURSOR_INVALID')).toBe(
      true,
    );
  });
  it('reports unreturned metrics and rejects foreign definition ownership', async () => {
    const test = await setup();
    test.read.mockImplementation(async (request) =>
      request.kind === 'definitions'
        ? { definitions: [definition()] }
        : { metrics: [metricRow({ definition_id: foreign })], total_available: 2 },
    );
    await test.collector.enrich();
    expect(test.graph.nodes.some((node) => node.id === metricId)).toBe(false);
    expect(test.graph.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(['PULSE_LIST_PARTIAL', 'PULSE_METRIC_OWNER_MISMATCH']),
    );
  });
  it('invalidates conflicting owner identities and dependent metrics already collected', async () => {
    const test = await setup();
    let definitions = 0;
    test.read.mockImplementation(async (request) =>
      request.kind === 'definitions'
        ? definitions++ === 0
          ? { definitions: [definition()], next_page_token: 'next' }
          : { definitions: [definition({ specification: { datasource: { id: foreign } } })] }
        : { metrics: [metricRow()] },
    );
    await test.collector.enrich();
    expect(
      test.graph.nodes.some(
        (node) => node.kind === 'pulse-definition' || node.kind === 'pulse-metric',
      ),
    ).toBe(false);
    expect(test.graph.warnings.some((warning) => warning.code === 'PULSE_IDENTITY_CHANGED')).toBe(
      true,
    );
  });
  it.each([{ maxRequests: 1 }, { maxNodes: 1 }, { maxEdges: 1 }])(
    'obeys the shared graph/request limits %j',
    async (limit) => {
      const test = await setup({
        source: { type: 'pulse-definition', luid: def },
        direction: 'both',
        ...limit,
      });
      await test.collector.resolveSource();
      expect(test.graph.coverage.requests).toBeLessThanOrEqual(test.options.maxRequests);
      expect(test.graph.nodes.length).toBeLessThanOrEqual(test.options.maxNodes);
      expect(test.graph.edges.length).toBeLessThanOrEqual(test.options.maxEdges);
      expect(test.graph.coverage.truncated).toBe(true);
    },
  );
  it('spends Pulse reference depth before catalog expansion and excludes deeper parent-only fields', async () => {
    const test = await setup({
      source: { type: 'pulse-metric', luid: metric },
      direction: 'both',
      maxDepth: 1,
    });
    test.read.mockImplementation(async (request) =>
      request.kind === 'definitions' ? { definition: definition() } : { metric: metricRow() },
    );
    await test.collector.resolveSource();
    expect(test.graph.nodes.some((node) => node.name === 'B')).toBe(true);
    expect(test.graph.nodes.some((node) => node.name === 'Date' || node.name === 'Region')).toBe(
      false,
    );
    expect(test.graph.coverage.truncated).toBe(true);
  });
  it('retains catalog results on errors and aborts rather than returning a false successful graph', async () => {
    const test = await setup();
    test.read.mockRejectedValue(new Error('PRIVATE_ERROR'));
    await test.collector.enrich();
    expect(test.graph.resolution).toBe('resolved');
    expect(test.graph.coverage.pulse).toBe('unavailable');
    expect(JSON.stringify(test.graph)).not.toContain('PRIVATE_ERROR');
    const stopped = await setup();
    stopped.controller.abort();
    await expect(stopped.collector.enrich()).rejects.toThrow();
    expect(stopped.read).not.toHaveBeenCalled();
  });
  it('does not perform downstream enrichment for an upstream-only non-Pulse request', async () => {
    const test = await setup({ direction: 'upstream' });
    await test.collector.enrich();
    expect(test.read).not.toHaveBeenCalled();
  });
  it('uses request-private selector caches across independent site/user collectors', async () => {
    const first = await setup();
    await first.collector.enrich();
    const second = await setup();
    second.graphql.mockImplementation(async () => ({
      data: { asset: page([{ ...datasource(), pulseFields: page([]) }]) },
    }));
    await second.collector.enrich();
    expect(second.graphql).toHaveBeenCalled();
    expect(second.graph.edges.some((edge) => edge.provenance === 'pulse-rest')).toBe(false);
  });
  it('bounds permission probes independently of oversized distinct datasource scopes', async () => {
    const test = await setup({
      source: { type: 'pulse-definition', luid: def },
      direction: 'upstream',
      maxRequests: 1,
    });
    test.read.mockResolvedValue({
      definition: definition({
        goals: [{ datasource: { id: foreign }, measure: { field: 'Private' } }],
      }),
    });
    await test.collector.resolveSource();
    expect(test.isDatasourceAllowed.mock.calls.length).toBeLessThanOrEqual(1);
    expect(test.graph.warnings.some((warning) => warning.code === 'PULSE_SCOPE_LIMIT')).toBe(true);
  });
});
