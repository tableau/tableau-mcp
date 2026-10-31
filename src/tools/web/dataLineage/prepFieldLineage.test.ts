import { analyzePrepFields, PrepFieldAnalysis } from './prepFieldLineage.js';
import policies from './prepNodePolicies.json';

const luid = '11111111-1111-4111-8111-111111111111';
type Node = Record<string, unknown> & { id: string; nextNodes: unknown[] };
const node = (id: string, nodeType: string, settings: Record<string, unknown> = {}): Node => ({
  id,
  nodeType,
  nextNodes: [],
  ...settings,
});
const input = (
  id = 'in',
  fields: Record<string, string> = { id: 'integer', amount: 'real' },
): Node =>
  node(id, '.v1.LoadSql', {
    fields: Object.entries(fields).map(([name, type]) => ({ name, type })),
  });
function flow(
  nodes: Node[],
  edges = nodes.slice(1).map((n, i) => [nodes[i].id, n.id, 'Default', 'Default']),
): { nodes: Record<string, Node> } {
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  for (const [from, to, namespace, nextNamespace] of edges)
    byId[from].nextNodes.push({ nextNodeId: to, namespace, nextNamespace });
  return { nodes: byId };
}
function field(
  analysis: PrepFieldAnalysis,
  step: string,
  name: string,
  namespace = 'Default',
): string | undefined {
  return analysis.outputs.get(step)?.get(namespace)?.fields.get(name);
}
function origins(
  analysis: PrepFieldAnalysis,
  id: string | undefined,
): Array<Array<string | undefined>> {
  const ids = new Set<string>(),
    queue = id ? [id] : [];
  while (queue.length) {
    const next = queue.shift()!;
    if (ids.has(next)) continue;
    ids.add(next);
    queue.push(...analysis.edges.filter((e) => e.to === next).map((e) => e.from));
  }
  return analysis.nodes
    .filter((n) => ids.has(n.id) && n.operation === 'input')
    .map((n) => [n.stepId, n.name]);
}

describe('Prep symbolic field lineage', () => {
  it.each(
    ['.v1.LoadCsv', '.v1.LoadExcel'].flatMap((inputType) =>
      [
        '.v1.WriteToCsv',
        '.v2021_1_1.WriteToExcel',
        '.v1.WriteToHyper',
        '.v1.WriteToJson',
        '.v1.PublishExtract',
      ].map((outputType) => ({ inputType, outputType })),
    ),
  )(
    'preserves file input fields through rename/calculation to $outputType from $inputType',
    ({ inputType, outputType }) => {
      const analysis = analyzePrepFields(
        flow([
          node('in', inputType, { fields: [{ name: 'Amount', type: 'real' }] }),
          node('rename', '.v1.RenameColumn', { columnName: 'Amount', rename: 'Net' }),
          node('calc', '.v1.AddColumn', { columnName: 'Gross', expression: '[Net] * 1.1' }),
          node('out', outputType),
        ]),
        luid,
      );
      expect(origins(analysis, field(analysis, 'out', 'Gross'))).toEqual([['in', 'Amount']]);
      expect(field(analysis, 'out', 'Amount')).toBeUndefined();
    },
  );

  it('pins all 94 inventoried types and 20 explicit name-effect families', () => {
    expect(Object.keys(policies)).toHaveLength(94);
    expect(new Set(Object.values(policies)).size).toBe(20);
  });

  it.each(['.v1.AddColumn', '.v2019_2_3.DuplicateColumn', '.v2023_3_1.MultiRowCalc'])(
    'resolves calculation dependencies and overwrite versions for %s',
    (token) => {
      const analysis = analyzePrepFields(
        flow([
          input(),
          node('calc', token, { columnName: 'amount', expression: '[amount] * 2' }),
          node('out', '.v1.WriteToCsv'),
        ]),
        luid,
      );
      const id = field(analysis, 'out', 'amount');
      expect(origins(analysis, id)).toEqual([['in', 'amount']]);
      expect(analysis.nodes.find((n) => n.id === id)?.operation).toBe('calculation');
      expect(analysis.issues).toEqual([]);
    },
  );

  it('keeps rename, bulk rename, grouping and aggregation in order', () => {
    const analysis = analyzePrepFields(
      flow([
        input('in', { id: 'integer', rev_A: 'real', rev_B: 'real' }),
        node('rename', '.v1.RenameColumn', { columnName: 'id', rename: 'RecordId' }),
        node('bulk', '.v2021_2_1.BulkRenameColumns', {
          columnsSelection: {
            selectionRule: { type: 'prefixBasedColumnsSelection', columnNamePrefix: 'rev_' },
          },
          columnsOperation: {
            type: 'replaceColumnPrefixOperation',
            existingPrefix: 'rev_',
            newPrefix: 'sales_',
          },
        }),
        node('aggregate', '.v1.Aggregate', {
          groupByFields: [{ columnName: 'RecordId' }],
          aggregateFields: [{ columnName: 'sales_A', newColumnName: 'Total', function: 'SUM' }],
        }),
        node('out', '.v1.WriteToCsv'),
      ]),
      luid,
    );
    expect(origins(analysis, field(analysis, 'out', 'Total'))).toEqual(
      expect.arrayContaining([
        ['in', 'rev_A'],
        ['in', 'id'],
      ]),
    );
    expect(field(analysis, 'out', 'sales_B')).toBeUndefined();
    expect(analysis.issues).toEqual([]);
  });

  it('distinguishes Join Left/Right field origins, suffixes and key row dependencies', () => {
    const left = input('left', { id: 'integer', a: 'real' }),
      right = input('right', { id: 'integer', b: 'real' });
    const join = node('join', '.v1.SimpleJoin', {
        conditions: [{ leftExpression: '[id]', rightExpression: '[id]' }],
      }),
      out = node('out', '.v1.WriteToCsv');
    const analysis = analyzePrepFields(
      flow(
        [left, right, join, out],
        [
          ['left', 'join', 'Default', 'Left'],
          ['right', 'join', 'Default', 'Right'],
          ['join', 'out', 'Default', 'Default'],
        ],
      ),
      luid,
    );
    expect(origins(analysis, field(analysis, 'out', 'id-1'))).toEqual(
      expect.arrayContaining([
        ['right', 'id'],
        ['left', 'id'],
      ]),
    );
    expect(origins(analysis, field(analysis, 'out', 'b'))).toContainEqual(['right', 'b']);
    expect(analysis.issues).toEqual([]);
  });

  it('refuses iteration-dependent Join suffixes', () => {
    const analysis = analyzePrepFields(
      flow(
        [
          input('left', { id: 'real' }),
          input('right', { id: 'real', 'id-1': 'real' }),
          node('join', '.v1.SimpleJoin'),
        ],
        [
          ['left', 'join', 'Default', 'Left'],
          ['right', 'join', 'Default', 'Right'],
        ],
      ),
      luid,
    );
    expect(field(analysis, 'join', 'id')).toBeUndefined();
    expect(analysis.issues.some((i) => i.code === 'ambiguous-join-suffix')).toBe(true);
  });

  it('uses namespace-specific Union mappings and creates provenance at the Union', () => {
    const analysis = analyzePrepFields(
      flow(
        [
          input('one', { Amount: 'real' }),
          input('two', { amount: 'real' }),
          node('union', '.v1.SimpleUnion', {
            namespaceFieldMappings: [
              { namespaceName: 'Two', fieldMappings: { '[amount]': 'Amount' } },
            ],
          }),
        ],
        [
          ['one', 'union', 'Default', 'One'],
          ['two', 'union', 'Default', 'Two'],
        ],
      ),
      luid,
    );
    expect(origins(analysis, field(analysis, 'union', 'Amount'))).toEqual([
      ['one', 'Amount'],
      ['two', 'amount'],
    ]);
    expect(origins(analysis, field(analysis, 'union', 'Table Names'))).toEqual([]);
    expect(
      analysis.nodes.find((n) => n.id === field(analysis, 'union', 'Table Names'))?.operation,
    ).toBe('generated-union-provenance');
  });

  it('handles legacy unpivot and current columns-to-rows/rows-to-columns mappings', () => {
    const unpivot = node('long', '.v2018_3_4.UnpivotExtended', {
      unpivotGroup: {
        literalColumn: { literalColumnName: 'Period' },
        unpivotColumns: [
          {
            unpivotColumnName: 'Value',
            columnInformation: { bindingsType: 'manual', manualBindings: ['Q1', 'Q2'] },
          },
        ],
      },
    });
    const pivot = node('wide', '.v2018_3_3.Pivot', {
      pivotColumnName: 'Period',
      aggregateColumnName: 'Value',
      pivotGroupingColumns: ['id'],
      newPivotColumns: [{ newColumnName: 'Q1 wide' }],
    });
    const analysis = analyzePrepFields(
      flow([input('in', { id: 'integer', Q1: 'real', Q2: 'real' }), unpivot, pivot]),
      luid,
    );
    expect(origins(analysis, field(analysis, 'wide', 'Q1 wide'))).toEqual(
      expect.arrayContaining([
        ['in', 'Q1'],
        ['in', 'Q2'],
      ]),
    );
    const legacy = analyzePrepFields(
      flow([
        input('in', { Q1: 'real', Q2: 'real' }),
        node('long', '.v1.Unpivot', {
          unpivotGroups: [
            {
              expressions: [
                {
                  bindings: [
                    { bindingType: 'literal', newColumnName: 'Period', groupName: 'Q1' },
                    { bindingType: 'column', columnName: 'Q1', newColumnName: 'Value' },
                  ],
                },
                { bindings: [{ bindingType: 'column', columnName: 'Q2', newColumnName: 'Value' }] },
              ],
            },
          ],
        }),
      ]),
      luid,
    );
    expect(origins(legacy, field(legacy, 'long', 'Value'))).toEqual([
      ['in', 'Q1'],
      ['in', 'Q2'],
    ]);
  });

  it('resolves a static unpivot wildcard and defers dynamic membership', () => {
    const setting = {
      unpivotGroup: {
        literalColumn: { literalColumnName: 'Period' },
        unpivotColumns: [
          {
            unpivotColumnName: 'Value',
            columnInformation: {
              bindingsType: 'wildcard',
              wildcardType: 'Starts with',
              wildcardExpression: 'Q',
              additionalColumns: [],
            },
          },
        ],
      },
    };
    const resolved = analyzePrepFields(
      flow([
        input('in', { Q1: 'real', Q2: 'real' }),
        node('long', '.v2018_3_4.UnpivotExtended', setting),
      ]),
      luid,
    );
    expect(origins(resolved, field(resolved, 'long', 'Value'))).toHaveLength(2);
    const unknown = analyzePrepFields(
      flow([node('in', '.v1.LoadSql'), node('long', '.v2018_3_4.UnpivotExtended', setting)]),
      luid,
    );
    expect(unknown.issues.some((i) => i.code === 'unresolved-unpivot-membership')).toBe(true);
  });

  it('preserves Group ports and nested rename origins', () => {
    const group = node('group', '.v2020_3_3.Group', {
      loomContainer: flow([
        node('rename', '.v1.RenameColumn', { columnName: 'amount', rename: 'Sales' }),
      ]),
      namespacesToInput: { In: { nodeId: 'rename', namespace: 'Default' } },
      namespacesToOutput: { Out: { nodeId: 'rename', namespace: 'Default' } },
    });
    const analysis = analyzePrepFields(
      flow(
        [input(), group, node('out', '.v1.WriteToCsv')],
        [
          ['in', 'group', 'Default', 'In'],
          ['group', 'out', 'Out', 'Default'],
        ],
      ),
      luid,
    );
    expect(origins(analysis, field(analysis, 'out', 'Sales'))).toEqual([['in', 'amount']]);
    expect(field(analysis, 'group', 'Sales', 'Out')).toBeDefined();
    expect(analysis.issues).toEqual([]);
  });

  it('applies before/after annotations in their own namespaces and ordered input actions', () => {
    const inNode = input();
    inNode.restrictedFields = { amount: 'Sales' };
    inNode.actions = [node('keep', '.v2019_2_2.KeepOnlyColumns', { columnNames: ['Sales'] })];
    const out = node('out', '.v1.WriteToCsv', {
      beforeActionAnnotations: [
        {
          namespace: 'Default',
          annotationNode: node('rename', '.v1.RenameColumn', {
            columnName: 'Sales',
            rename: 'Revenue',
          }),
        },
      ],
      afterActionAnnotations: [
        {
          annotationNode: node('filter', '.v1.FilterOperation', {
            filterExpression: '[Revenue] > 0',
          }),
        },
      ],
    });
    const analysis = analyzePrepFields(flow([inNode, out]), luid);
    expect(origins(analysis, field(analysis, 'out', 'Revenue'))).toEqual([['in', 'amount']]);
    expect(field(analysis, 'out', 'id')).toBeUndefined();
    expect(analysis.issues).toEqual([]);
  });

  it('tracks removals, keep, merge, row generation and value/type changes', () => {
    const analysis = analyzePrepFields(
      flow([
        input('in', { a: 'real', b: 'real', c: 'real' }),
        node('merge', '.v1.MergeColumns', {
          mergeColumnsList: ['a', 'b'],
          mergedColumnName: 'Combined',
        }),
        node('type', '.v1.ChangeColumnType', {
          fields: { Combined: { type: 'string', calc: 'STR([Combined])' } },
        }),
        node('value', '.v1.Remap', { columnName: 'Combined' }),
        node('rows', '.v2021_3_1.NewRows', {
          newRowsGenerator: {
            generatorType: 'newRowsOneColumnGenerator',
            columnName: 'c',
            newColumnName: 'Generated',
          },
        }),
        node('remove', '.v1.RemoveColumn', { columnName: 'c' }),
      ]),
      luid,
    );
    expect(origins(analysis, field(analysis, 'remove', 'Combined'))).toEqual([
      ['in', 'a'],
      ['in', 'b'],
    ]);
    expect(origins(analysis, field(analysis, 'remove', 'Generated'))).toEqual([['in', 'c']]);
    expect(field(analysis, 'remove', 'c')).toBeUndefined();
  });

  it('marks external script schemas, models and unknown version suffixes unverified', () => {
    const script = analyzePrepFields(
      flow([input(), node('script', '.v2019_2_2.ExtensibilityNode')]),
      luid,
    );
    expect(field(script, 'script', 'amount')).toBeUndefined();
    expect(script.issues[0].code).toBe('external-script-schema-unavailable');
    const prediction = analyzePrepFields(
      flow([
        input(),
        node('model', '.v2021_1_3.PredictionNode', {
          predictionSettings: {
            outcomeName: 'Score',
            fieldMappings: { amount: 'model amount' },
            topPredictors: 1,
            topImprovements: 1,
          },
        }),
      ]),
      luid,
    );
    expect(field(prediction, 'model', 'Predictor 1 Impact')).toBeDefined();
    expect(
      prediction.edges
        .filter((e) => e.relationship === 'prediction-unverified')
        .every((e) => e.evidence === 'unknown'),
    ).toBe(true);
    const future = analyzePrepFields(
      flow([
        input(),
        node('future', '.future.Unknown.AddColumn', {
          columnName: 'amount',
          expression: '[amount] * 2',
        }),
      ]),
      luid,
    );
    expect(field(future, 'future', 'amount')).toBeUndefined();
    expect(future.issues.some((i) => i.code === 'unsupported-node-type')).toBe(true);
  });

  it('keeps unrelated branch fields separate and never joins them by equal names', () => {
    const analysis = analyzePrepFields(
      flow(
        [
          input('one'),
          input('two'),
          node('calc', '.v1.AddColumn', { columnName: 'Gross', expression: '[amount] * 2' }),
        ],
        [['one', 'calc', 'Default', 'Default']],
      ),
      luid,
    );
    expect(origins(analysis, field(analysis, 'calc', 'Gross'))).toEqual([['one', 'amount']]);
  });

  it('reports stale references, duplicate input ports, cycles, limits and keeps source JSON unchanged', () => {
    const doc = flow([
      input(),
      node('rename', '.v1.RenameColumn', { columnName: 'amount', rename: 'Sales' }),
      node('stale', '.v1.AddColumn', { columnName: 'Bad', expression: '[amount] + 1' }),
    ]);
    const before = JSON.stringify(doc),
      analysis = analyzePrepFields(doc, luid);
    expect(analysis.issues.some((i) => i.code === 'unresolved-field-reference')).toBe(true);
    expect(JSON.stringify(doc)).toBe(before);
    expect(analyzePrepFields(doc, luid, 1).truncated).toBe(true);
    const cyclic = analyzePrepFields(
      flow(
        [node('a', '.v1.RemoveColumn'), node('b', '.v1.RemoveColumn')],
        [
          ['a', 'b', 'Default', 'Default'],
          ['b', 'a', 'Default', 'Default'],
        ],
      ),
      luid,
    );
    expect(cyclic.issues.some((i) => i.code === 'cyclic-step-graph')).toBe(true);
  });
});
