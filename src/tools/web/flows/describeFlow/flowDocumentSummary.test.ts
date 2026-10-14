import { Flow } from '../../../../sdks/tableau/types/flow.js';
import {
  FlowDocument,
  flowDocumentConnectionSchema,
} from '../../../../sdks/tableau/types/flowDocument.js';
import { summarizeFlowDocument } from './flowDocumentSummary.js';
import { mockFlowDocument } from './mockFlowDocument.js';

const mockFlow = {
  id: 'd00700fe-28a0-4ece-a7af-5543ddf38a82',
  name: 'Sales Cleanup',
  description: 'Cleans up the daily sales feed',
  webpageUrl: 'http://tableau.example.com/#/flows/3',
  fileType: 'tflx',
  updatedAt: '2024-11-06T21:31:00Z',
  project: { id: 'proj-1', name: 'Finance' },
  owner: { id: 'owner-1', fullName: 'Dana Owner', name: 'downer' },
  tags: { tag: [{ label: 'sales' }, { label: 'daily' }] },
} satisfies Flow;

describe('summarizeFlowDocument', () => {
  it('classifies nodes into inputs / outputs / transforms and counts them', () => {
    const result = summarizeFlowDocument({ document: mockFlowDocument });

    expect(result.stats).toEqual({
      nodeCount: 6,
      inputCount: 2,
      outputCount: 1,
      transformCount: 3,
      connectionCount: 2,
    });
    expect(result.inputs.map((i) => i.name).sort()).toEqual(['Customers', 'Orders.csv']);
    expect(result.outputs.map((o) => o.name)).toEqual(['Sales Mart']);
    expect(result.steps.map((s) => s.name).sort()).toEqual([
      'Join Orders + Customers',
      'Keep 2024',
      'Profit Ratio',
    ]);
  });

  it('assigns friendly roles to known node types', () => {
    const result = summarizeFlowDocument({ document: mockFlowDocument });

    const csv = result.inputs.find((i) => i.name === 'Orders.csv');
    expect(csv?.role).toBe('Input — CSV file');
    const output = result.outputs[0];
    expect(output.role).toBe('Output — published data source / extract');
    const join = result.steps.find((s) => s.name === 'Join Orders + Customers');
    expect(join?.role).toBe('Join');
  });

  it('resolves each input to its data connection (file + database)', () => {
    const result = summarizeFlowDocument({ document: mockFlowDocument });

    const csv = result.inputs.find((i) => i.name === 'Orders.csv');
    expect(csv?.connection).toMatchObject({
      type: 'textscan',
      file: 'Orders.csv',
      isPackaged: true,
    });

    const sql = result.inputs.find((i) => i.name === 'Customers');
    expect(sql?.connection).toMatchObject({
      type: 'sqlserver',
      server: 'sql.internal.example.com',
      database: 'SalesDW',
      schema: 'dbo',
      isPackaged: false,
    });
  });

  it('surfaces recognizable output target details', () => {
    const result = summarizeFlowDocument({ document: mockFlowDocument });
    expect(result.outputs[0].target).toMatchObject({
      datasourceName: 'Sales Mart',
      projectName: 'Finance',
    });
  });

  it('builds step-to-step lineage edges by name', () => {
    const result = summarizeFlowDocument({ document: mockFlowDocument });
    expect(result.lineage).toEqual(
      expect.arrayContaining([
        { from: 'Orders.csv', to: 'Join Orders + Customers' },
        { from: 'Customers', to: 'Join Orders + Customers' },
        { from: 'Join Orders + Customers', to: 'Keep 2024' },
        { from: 'Keep 2024', to: 'Profit Ratio' },
        { from: 'Profit Ratio', to: 'Sales Mart' },
      ]),
    );
    expect(result.lineage).toHaveLength(5);
  });

  it('reads parameters from the document when no flow metadata is supplied', () => {
    const result = summarizeFlowDocument({ document: mockFlowDocument });
    expect(result.parameters).toEqual([{ name: 'Region', type: 'string', value: 'West' }]);
  });

  it('prefers strongly-typed flow parameters over the document parameter map', () => {
    const flowWithParams: Flow = {
      ...mockFlow,
      parameters: {
        parameter: [
          { id: 'p1', name: 'Region', type: 'string', value: 'West' },
          { id: 'p2', name: 'Year', type: 'integer', value: '2024' },
        ],
      },
    };
    const result = summarizeFlowDocument({ document: mockFlowDocument, flow: flowWithParams });
    expect(result.parameters).toEqual([
      { name: 'Region', type: 'string', value: 'West' },
      { name: 'Year', type: 'integer', value: '2024' },
    ]);
  });

  it('summarizes flow identity from the supplied flow metadata', () => {
    const result = summarizeFlowDocument({ document: mockFlowDocument, flow: mockFlow });
    expect(result.flow).toMatchObject({
      id: mockFlow.id,
      name: 'Sales Cleanup',
      project: 'Finance',
      owner: 'Dana Owner',
      fileType: 'tflx',
      tags: ['sales', 'daily'],
    });
  });

  it('omits per-step field schemas unless includeFieldSchemas is set', () => {
    const without = summarizeFlowDocument({ document: mockFlowDocument });
    expect(without.fields).toBeUndefined();

    const withFields = summarizeFlowDocument({
      document: mockFlowDocument,
      includeFieldSchemas: true,
    });
    expect(withFields.fields).toBeDefined();
    expect(withFields.fields?.['Orders.csv']).toEqual([
      { name: 'OrderId', type: 'integer' },
      { name: 'Amount', type: 'real' },
    ]);
  });

  it('falls back to initialNodes for classification when baseType is absent', () => {
    // No baseType anywhere; only `initialNodes` marks the input. A node with an
    // unknown type should be humanized rather than dropped.
    const doc: FlowDocument = {
      initialNodes: ['a'],
      nodes: {
        a: {
          id: 'a',
          name: 'Source',
          nodeType: '.v1.SomeWeirdLoader',
          nextNodes: [{ nextNodeId: 'b' }],
        },
        b: { id: 'b', name: 'Reshape', nodeType: '.v1.ChangeColumnType', nextNodes: [] },
      },
    };
    const result = summarizeFlowDocument({ document: doc });
    expect(result.inputs.map((i) => i.name)).toEqual(['Source']);
    expect(result.steps[0].role).toBe('Change column type');
  });

  it('classifies real baseTypes (container / superNode / transform) as steps with friendly roles', () => {
    // Mirrors live document shapes: a "Clean" container step plus Super*/Simple*
    // operation nodes. baseType is authoritative; Super/Simple prefixes are
    // normalized for the role label.
    const doc: FlowDocument = {
      initialNodes: ['in'],
      nodes: {
        in: {
          id: 'in',
          name: 'orders',
          nodeType: '.v1.LoadCsv',
          baseType: 'input',
          nextNodes: [{ nextNodeId: 'clean' }],
        },
        clean: {
          id: 'clean',
          name: 'Remove Nulls',
          nodeType: '.v1.Container',
          baseType: 'container',
          nextNodes: [{ nextNodeId: 'join' }],
        },
        join: {
          id: 'join',
          name: 'Join 1',
          nodeType: '.v1.SuperJoin',
          baseType: 'superNode',
          nextNodes: [{ nextNodeId: 'union' }],
        },
        union: {
          id: 'union',
          name: 'Union 1',
          nodeType: '.v1.SimpleUnion',
          baseType: 'transform',
          nextNodes: [{ nextNodeId: 'out' }],
        },
        out: {
          id: 'out',
          name: 'Output',
          nodeType: '.v1.PublishExtract',
          baseType: 'output',
          nextNodes: [],
        },
      },
    };
    const result = summarizeFlowDocument({ document: doc });

    expect(result.stats).toMatchObject({ inputCount: 1, outputCount: 1, transformCount: 3 });
    // The container "Remove Nulls" must NOT be treated as an input.
    expect(result.inputs.map((i) => i.name)).toEqual(['orders']);
    const byName = Object.fromEntries(result.steps.map((s) => [s.name, s.role]));
    expect(byName['Remove Nulls']).toBe('Clean step (prep operations)');
    expect(byName['Join 1']).toBe('Join');
    expect(byName['Union 1']).toBe('Union');
  });

  it('returns zeroed stats and a warning for an empty document', () => {
    const result = summarizeFlowDocument({ document: {} });
    expect(result.stats.nodeCount).toBe(0);
    expect(result.inputs).toEqual([]);
    expect(result.outputs).toEqual([]);
    expect(result.mcp?.warnings?.[0]).toMatchObject({
      type: 'EMPTY_DOCUMENT',
      severity: 'WARNING',
      affectedField: 'steps',
    });
    expect(result.mcp?.warnings?.[0].message).toContain('no recognizable steps');
  });
});

describe('flowDocumentConnectionSchema isPackaged parsing', () => {
  it('parses the string "false" as false (not true)', () => {
    // Regression: z.coerce.boolean() would turn "false" into `true`.
    expect(flowDocumentConnectionSchema.parse({ id: 'c', isPackaged: 'false' }).isPackaged).toBe(
      false,
    );
  });

  it('parses the string "true" as true (case-insensitively)', () => {
    expect(flowDocumentConnectionSchema.parse({ id: 'c', isPackaged: 'true' }).isPackaged).toBe(
      true,
    );
    expect(flowDocumentConnectionSchema.parse({ id: 'c', isPackaged: 'TRUE' }).isPackaged).toBe(
      true,
    );
  });

  it('passes real booleans through unchanged', () => {
    expect(flowDocumentConnectionSchema.parse({ id: 'c', isPackaged: true }).isPackaged).toBe(true);
    expect(flowDocumentConnectionSchema.parse({ id: 'c', isPackaged: false }).isPackaged).toBe(
      false,
    );
  });

  it('leaves isPackaged undefined when absent or unrecognized', () => {
    expect(flowDocumentConnectionSchema.parse({ id: 'c' }).isPackaged).toBeUndefined();
    expect(flowDocumentConnectionSchema.parse({ id: 'c', isPackaged: 'maybe' }).isPackaged).toBe(
      undefined,
    );
  });
});
