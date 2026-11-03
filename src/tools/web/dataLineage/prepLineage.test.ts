import { z } from 'zod';

import { DataLineageTraversal } from '../../../sdks/tableau/methods/dataLineage.js';
import { dataLineageParams, LineageNode } from '../../../sdks/tableau/types/dataLineage.js';
import { FlowDocument } from '../../../sdks/tableau/types/flowDocument.js';
import { analyzeLineageImpact } from './dataImpact.js';
import { addPrepTopology } from './prepLineage.js';

const luid = '11111111-1111-4111-8111-111111111111';
const flow: LineageNode = { id: 'metadata:f', kind: 'flow', luid };
const document: FlowDocument = {
  nodes: {
    start: {
      id: 'start',
      nodeType: '.v1.LoadSql',
      nextNodes: [{ nextNodeId: 'calc' }],
      fields: [{ name: 'Sales', type: 'real' }],
    },
    calc: {
      id: 'calc',
      nodeType: '.v1.Container',
      nextNodes: [{ nextNodeId: 'out' }],
      namespacesToInput: { Default: { nodeId: 'inner', namespace: 'Default' } },
      namespacesToOutput: { Default: { nodeId: 'inner', namespace: 'Default' } },
      loomContainer: {
        nodes: {
          inner: {
            id: 'inner',
            nodeType: '.v1.AddColumn',
            columnName: 'Gross',
            expression: '[Sales] * 1.1',
          },
        },
      },
    },
    out: { id: 'out', nodeType: '.v1.PublishExtract', nextNodes: [] },
    unrelated: {
      id: 'unrelated',
      nodeType: '.v1.Container',
      nextNodes: [],
      fields: [{ name: 'Sales' }],
    },
  },
};
function builder(
  direction: 'upstream' | 'downstream' | 'both' = 'downstream',
): DataLineageTraversal {
  const traversal = new DataLineageTraversal(
    z.object(dataLineageParams).parse({ source: { type: 'flow', luid }, direction }),
    { graphql: vi.fn(), isAllowed: async () => true, prepEnabled: true },
  );
  traversal.result.nodes.push(
    flow,
    { id: 'metadata:out', kind: 'flow-output-step', stepId: 'out', flowLuid: luid },
    {
      id: 'metadata:other-flow-output',
      kind: 'flow-output-step',
      stepId: 'out',
      flowLuid: '22222222-2222-4222-8222-222222222222',
    },
  );
  traversal.result.resolution = 'resolved';
  traversal.result.sourceId = flow.id;
  return traversal;
}

describe('Prep graph integration', () => {
  it('rejects a different API JSON format instead of guessing a package wrapper', () => {
    const traversal = builder();
    addPrepTopology(
      traversal,
      flow,
      { document },
      {
        type: 'prep-field',
        flowLuid: luid,
        stepId: 'start',
        name: 'Sales',
      },
    );
    expect(traversal.result.resolution).toBe('unavailable');
    expect(traversal.result.sourceId).toBeUndefined();
    expect(traversal.result.coverage.prep).toBe('unavailable');
    expect(
      traversal.result.warnings.some((w) => w.code === 'PREP_DOCUMENT_FORMAT_UNSUPPORTED'),
    ).toBe(true);
    expect(traversal.result.nodes.some((n) => n.id.startsWith('prep:'))).toBe(false);
  });

  it('joins explicit step IDs only within their owning flow and follows reachable step topology', () => {
    const traversal = builder();
    addPrepTopology(traversal, flow, document, {
      type: 'prep-step',
      flowLuid: luid,
      stepId: 'start',
    });
    const impacts = analyzeLineageImpact(traversal.result);
    expect(impacts.find((i) => i.nodeId === 'metadata:out')?.classification).toBe('indirect');
    expect(
      impacts.some(
        (i) => i.nodeId === 'metadata:other-flow-output' || i.nodeId.includes('unrelated'),
      ),
    ).toBe(false);
    expect(
      traversal.result.prepDetails?.[0].operations.find((op) => op.operation === 'AddColumn')
        ?.expression,
    ).toBe('[Sales] * 1.1');
  });

  it('uses scoped field versions without joining equal field names in other branches', () => {
    const traversal = builder();
    addPrepTopology(traversal, flow, document, {
      type: 'prep-field',
      flowLuid: luid,
      stepId: 'start',
      name: 'Sales',
    });
    expect(
      analyzeLineageImpact(traversal.result).find((i) => i.nodeId === 'metadata:out')
        ?.classification,
    ).toBe('direct');
    expect(analyzeLineageImpact(traversal.result).some((i) => i.nodeId.includes('unrelated'))).toBe(
      false,
    );
  });

  it('resolves a uniquely created calculated field without requiring a top-level field schema', () => {
    const traversal = builder();
    addPrepTopology(traversal, flow, document, {
      type: 'prep-field',
      flowLuid: luid,
      stepId: 'calc',
      name: 'Gross',
    });
    expect(traversal.result.resolution).toBe('resolved');
    expect(traversal.result.sourceId).toContain('prep-field:');
  });

  it('keeps both-direction Prep field walks from crossing into a sibling calculation through a shared input', () => {
    const traversal = builder('both');
    addPrepTopology(
      traversal,
      flow,
      {
        nodes: {
          input: {
            id: 'input',
            nodeType: '.v1.LoadSql',
            fields: [{ name: 'Sales', type: 'real' }],
            nextNodes: [{ nextNodeId: 'selected' }, { nextNodeId: 'sibling' }],
          },
          selected: {
            id: 'selected',
            nodeType: '.v1.AddColumn',
            columnName: 'Gross',
            expression: '[Sales] * 1.1',
            nextNodes: [],
          },
          sibling: {
            id: 'sibling',
            nodeType: '.v1.AddColumn',
            columnName: 'Unused',
            expression: '[Sales] * 2',
            nextNodes: [],
          },
        },
      },
      { type: 'prep-field', flowLuid: luid, stepId: 'selected', name: 'Gross' },
    );
    expect(traversal.result.resolution).toBe('resolved');
    const fields = traversal.result.nodes.filter((n) => n.kind === 'prep-field').map((n) => n.name);
    expect(fields).toEqual(expect.arrayContaining(['Sales', 'Gross']));
    expect(fields).not.toContain('Unused');
    expect(traversal.result.prepDetails?.[0].operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ expression: '[Sales] * 1.1', references: ['Sales'] }),
      ]),
    );
  });
  it('keeps bounded processing context available when catalog nodes fill the graph budget', () => {
    const traversal = new DataLineageTraversal(
      z.object(dataLineageParams).parse({ source: { type: 'flow', luid }, maxNodes: 1 }),
      { graphql: vi.fn(), isAllowed: async () => true, prepEnabled: true },
    );
    traversal.result.nodes.push(flow);
    traversal.result.sourceId = flow.id;
    addPrepTopology(traversal, flow, document, { type: 'flow', luid });
    expect(traversal.result.nodes).toHaveLength(1);
    expect(traversal.result.prepDetails?.[0].operations).toEqual(
      expect.arrayContaining([expect.objectContaining({ expression: '[Sales] * 1.1' })]),
    );
    expect(traversal.result.coverage.truncated).toBe(true);
  });
  it('does not reassign an internal source while adding details for another flow', () => {
    const traversal = builder();
    const source = { type: 'prep-step' as const, flowLuid: luid, stepId: 'start' };
    addPrepTopology(traversal, flow, document, source);
    const id = traversal.result.sourceId;
    addPrepTopology(
      traversal,
      { id: 'metadata:other', kind: 'flow', luid: '22222222-2222-4222-8222-222222222222' },
      { nodes: { only: { id: 'only' } } },
      source,
    );
    expect(traversal.result.sourceId).toBe(id);
  });

  it('omits ambiguous IDs and their links without mistaking them for namespace failures', () => {
    const traversal = builder();
    addPrepTopology(
      traversal,
      flow,
      {
        nodes: {
          a: { id: 'same' },
          b: { id: 'same' },
          x: { id: 'x', nextNodes: [{ nextNodeId: 'same', namespace: 'left' }] },
        },
      },
      { type: 'prep-step', flowLuid: luid, stepId: 'same' },
    );
    expect(traversal.result.resolution).toBe('not-found');
    expect(traversal.result.sourceId).toBeUndefined();
    expect(traversal.result.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining([
        'PREP_DUPLICATE_STEP',
        'PREP_DANGLING_STEP',
        'PREP_SOURCE_UNRESOLVED',
      ]),
    );
  });
  it('keeps explicit namespaced step links while field-port mapping remains independently analyzed', () => {
    const traversal = builder();
    addPrepTopology(
      traversal,
      flow,
      {
        nodes: {
          input: {
            id: 'input',
            nodeType: '.v1.LoadCsv',
            fields: [{ name: 'Amount', type: 'real' }],
            nextNodes: [{ nextNodeId: 'output', namespace: 'Default', nextNamespace: 'Default' }],
          },
          output: { id: 'output', nodeType: '.v1.PublishExtract' },
        },
      },
      { type: 'prep-step', flowLuid: luid, stepId: 'input' },
    );
    expect(
      traversal.result.edges.some((e) => e.relationship === 'nextNodes' && e.evidence === 'direct'),
    ).toBe(true);
    expect(traversal.result.warnings.some((w) => w.code === 'PREP_NAMESPACE_UNSUPPORTED')).toBe(
      false,
    );
  });
});
