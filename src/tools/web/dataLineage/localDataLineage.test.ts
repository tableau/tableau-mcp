import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

import { z } from 'zod';

import { dataLineageParams, DataLineageResult } from '../../../sdks/tableau/types/dataLineage.js';
import { analyzeLineageImpact } from './dataImpact.js';
import { executeLocalDataLineage } from './localDataLineage.js';

const input = {
  id: 'in',
  nodeType: '.v1.LoadCsv',
  fields: [{ name: 'Amount', type: 'real' }],
  nextNodes: [{ nextNodeId: 'clean' }, { nextNodeId: 'sibling' }],
};
const document = {
  nodes: {
    in: input,
    clean: {
      id: 'clean',
      nodeType: '.v1.FilterOperation',
      expression: '[Amount] > 0',
      nextNodes: [{ nextNodeId: 'calc' }],
    },
    calc: {
      id: 'calc',
      nodeType: '.v1.AddColumn',
      columnName: 'Gross',
      expression: '[Amount] * 1.1',
      nextNodes: [{ nextNodeId: 'out' }],
    },
    out: { id: 'out', nodeType: '.v1.WriteToCsv', nextNodes: [] },
    sibling: {
      id: 'sibling',
      nodeType: '.v1.AddColumn',
      columnName: 'Other',
      expression: '[Amount] * 2',
      nextNodes: [],
    },
  },
  connections: {
    secret: { name: 'PRIVATE_CONNECTION', connectionAttributes: { password: 'PRIVATE_PASSWORD' } },
  },
};

describe('local native-flow lineage', () => {
  let root: string;
  let path: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'tableau-local-graph-')));
    path = join(root, 'sales.tfl');
    writeFileSync(path, JSON.stringify(document));
  });
  afterEach(() => {
    const rel = relative(realpathSync(tmpdir()), root);
    if (!rel.startsWith('tableau-local-graph-') || rel.includes(sep))
      throw new Error('Unexpected temporary directory.');
    rmSync(root, { recursive: true });
  });
  const analyze = (
    overrides: Record<string, unknown> = {},
    signal = new AbortController().signal,
  ): DataLineageResult =>
    executeLocalDataLineage(
      z
        .object(dataLineageParams)
        .parse({ source: { type: 'local-flow', path }, maxNodes: 500, ...overrides }),
      { transport: 'stdio', localFlowRoots: [root] },
      signal,
    );

  it('returns saved expressions with file-fingerprint identities and no invented published resources', () => {
    const graph = analyze();
    expect(graph.resolution).toBe('resolved');
    expect(graph.sourceId).toMatch(/^local:[a-f0-9]{64}$/);
    expect(graph.coverage.metadata).toBe('not-requested');
    expect(graph.coverage.permissionMode).toBe('NOT_REQUESTED');
    expect(graph.coverage.requests).toBe(0);
    expect(graph.nodes.every((node) => !node.luid && !node.flowLuid && !!node.documentId)).toBe(
      true,
    );
    expect(graph.prepDetails?.[0].operations.some((op) => op.expression === '[Amount] * 1.1')).toBe(
      true,
    );
    expect(JSON.stringify(graph)).not.toMatch(/PRIVATE_CONNECTION|PRIVATE_PASSWORD/);
    expect(graph.warnings.some((warning) => warning.code === 'LOCAL_PUBLICATION_UNVERIFIED')).toBe(
      true,
    );
  });

  it('traces an exact selected step field downstream without including earlier sibling branches', () => {
    const graph = analyze({
      source: { type: 'local-flow', path, at: { type: 'field', stepId: 'clean', name: 'Amount' } },
    });
    expect(graph.resolution).toBe('resolved');
    const impacts = analyzeLineageImpact(graph).map((impact) => ({
      ...impact,
      node: graph.nodes.find((node) => node.id === impact.nodeId),
    }));
    expect(
      impacts.some((impact) => impact.node?.name === 'Gross' && impact.classification === 'direct'),
    ).toBe(true);
    expect(
      impacts.some((impact) => impact.node?.stepId === 'out' && impact.classification === 'direct'),
    ).toBe(true);
    expect(impacts.some((impact) => impact.node?.stepId === 'sibling')).toBe(false);
    expect(graph.nodes.some((node) => node.stepId === 'sibling')).toBe(false);
  });

  it('traces calculation upstream to its saved input field', () => {
    const graph = analyze({
      source: { type: 'local-flow', path, at: { type: 'field', stepId: 'calc', name: 'Gross' } },
      direction: 'upstream',
    });
    expect(graph.nodes.some((node) => node.name === 'Amount' && node.operation === 'input')).toBe(
      true,
    );
    expect(graph.nodes.some((node) => node.stepId === 'out')).toBe(false);
  });

  it('traces step topology and never presents it as proof of column usage', () => {
    const graph = analyze({
      source: { type: 'local-flow', path, at: { type: 'step', stepId: 'clean' } },
    });
    expect(graph.nodes.map((node) => node.stepId)).toEqual(['clean', 'calc', 'out']);
    expect(graph.edges.every((edge) => edge.relationship === 'nextNodes')).toBe(true);
  });

  it('reports missing/ambiguous field origins rather than binding another name', () => {
    const graph = analyze({
      source: { type: 'local-flow', path, at: { type: 'field', stepId: 'clean', name: 'Missing' } },
    });
    expect(graph.resolution).toBe('not-found');
    expect(graph.nodes).toEqual([]);
  });

  it('bounds nodes and edges while retaining truthful local coverage', () => {
    const graph = analyze({ maxNodes: 2, maxEdges: 1 });
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges.length).toBeLessThanOrEqual(1);
    expect(graph.coverage.truncated).toBe(true);
    expect(graph.coverage.metadata).toBe('not-requested');
    expect(graph.nodes[0].id).toBe(graph.sourceId);
  });

  it('rejects excessive saved values without returning their contents', () => {
    writeFileSync(path, JSON.stringify({ ...document, privateMetadata: 'x'.repeat(8001) }));
    expect(analyze().resolution).toBe('unavailable');
  });

  it('does not confuse reused embedded flow IDs across different local files', () => {
    const first = analyze();
    writeFileSync(path, JSON.stringify({ ...document, id: 'arbitrary-rest-id' }));
    const second = analyze();
    expect(first.sourceId).not.toBe(second.sourceId);
    expect(second.nodes.every((node) => !node.flowLuid)).toBe(true);
  });

  it('propagates cancellation before filesystem work', () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => analyze({}, controller.signal)).toThrow();
  });
});
