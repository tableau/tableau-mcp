import { z } from 'zod';

import { DataLineageTraversal, toLineageNode } from '../../../sdks/tableau/methods/dataLineage.js';
import { identitySelection } from '../../../sdks/tableau/methods/dataLineageQueries.js';
import { dataLineageParams } from '../../../sdks/tableau/types/dataLineage.js';
import { FlowDocument } from '../../../sdks/tableau/types/flowDocument.js';
import { analyzeLineageImpact } from './dataImpact.js';
import { prepCatalogBindings } from './prepCatalogBindings.js';
import { analyzePrepFields } from './prepFieldLineage.js';
import { sourceRowNumberName } from './prepGeneratedFields.js';
import { addPrepTopology } from './prepLineage.js';

const luid = '11111111-1111-4111-8111-111111111111';
const source = '22222222-2222-4222-8222-222222222222';
const calculation = '33333333-3333-4333-8333-333333333333';
type Node = Record<string, unknown> & { id: string; nodeType: string };
const node = (id: string, nodeType: string, rest: Record<string, unknown> = {}): Node => ({
  id,
  nodeType,
  ...rest,
});
const fields = (...values: string[]): Array<{ name: string; type: string }> =>
  values.map((name) => ({ name, type: 'real' }));
function flow(...nodes: Node[]): FlowDocument {
  return {
    nodes: Object.fromEntries(
      nodes.map((n, i) => [
        n.id,
        {
          nextNodes: i + 1 < nodes.length ? [{ nextNodeId: nodes[i + 1].id }] : [],
          ...n,
        },
      ]),
    ),
  };
}
const union = (
  members: unknown[],
  outputFields: Array<{ name: string; type: string; isGenerated?: boolean }> = fields('Amount'),
): Node =>
  node(source, '.v1.LoadCsvInputUnion', {
    fields: outputFields,
    generatedInputs: members,
  });
const member = (
  id: string,
  names: string[],
  rest: Record<string, unknown> = {},
): Record<string, unknown> => ({
  inputUnionInputType: '.FileInputUnionInput',
  inputNode: node(id, '.v2022_4_1.LoadCsv', { fields: fields(...names) }),
  ...rest,
});

describe('ghidra-prep saved source coverage', () => {
  it('includes native multi-row grouping and ordering in the output dependency without consuming unrelated columns', () => {
    const a = analyzePrepFields(
      flow(
        node(source, '.v1.LoadCsv', { fields: fields('Amount', 'Customer', 'Date', 'Other') }),
        node('running', '.v2023_3_1.MultiRowCalc', {
          columnName: 'Running',
          expression: 'RUNNING_SUM([Amount])',
          specificRowCalc: {
            calcType: 'runningCalc',
            groupByColumns: ['Customer'],
            orderByColumns: [{ columnName: 'Date', sortType: 'ASC' }],
            computeUsingColumnName: 'Amount',
          },
        }),
      ),
      luid,
    );
    const output = a.outputs.get('running')!.get('Default')!.fields.get('Running');
    const parents = a.nodes.filter((n) => a.edges.some((e) => e.from === n.id && e.to === output));
    expect(parents.map((n) => n.name)).toEqual(['Amount', 'Customer', 'Date']);
    expect(a.edges.filter((e) => e.to === output).every((e) => e.evidence === 'direct')).toBe(true);
    expect(a.issues).toEqual([]);
  });
  it('keeps malformed or unknown multi-row controls unresolved even with a readable expression', () => {
    const a = analyzePrepFields(
      flow(
        node(source, '.v1.LoadCsv', { fields: fields('Amount') }),
        node('running', '.v2023_3_1.MultiRowCalc', {
          columnName: 'Running',
          expression: '[Amount]',
          specificRowCalc: { calcType: 'futureCalc', groupByColumns: ['Amount'] },
        }),
      ),
      luid,
    );
    expect(a.issues.some((i) => i.code === 'unsupported-multi-row-controls')).toBe(true);
    expect(a.edges.find((e) => e.relationship === 'calculation')?.evidence).toBe('unknown');
  });
  it('follows a saved legacy range filter as a row condition while preserving column identity', () => {
    const a = analyzePrepFields(
      flow(
        node(source, '.v1.LoadCsv', { fields: fields('Amount', 'Other') }),
        node('filter', '.v1.RangeFilter', { ranges: { Amount: [{ min: 0, max: 10 }] } }),
      ),
      luid,
    );
    const input = a.outputs.get(source)!.get('Default')!.fields.get('Amount');
    const sibling = a.outputs.get('filter')!.get('Default')!.fields.get('Other');
    expect(a.edges.find((e) => e.from === input && e.to === sibling)?.evidence).toBe('direct');
    expect(a.nativeFieldIds.get(`${source}-Amount`)?.has(sibling!)).toBeFalsy();
    expect(a.issues).toEqual([]);
  });
  it.each([
    '.v2021_1_4.QuickDateNameCalcColumn',
    '.v2020_3_3.CustomFiscalYearCalcColumn',
    '.v2020_1_4.QuickDateCalcColumn',
  ])(
    'creates the saved derived date column instead of requiring it to already exist: %s',
    (nodeType) => {
      const a = analyzePrepFields(
        flow(
          node(source, '.v1.LoadCsv', { fields: [{ name: 'Order Date', type: 'date' }] }),
          node('date', nodeType, {
            columnName: 'Fiscal Year',
            expression: 'DATEPART("year", [Order Date])',
          }),
        ),
        luid,
      );
      expect(a.issues).toEqual([]);
      expect(a.outputs.get('date')?.get('Default')?.fields.has('Fiscal Year')).toBe(true);
      expect(a.edges.find((e) => e.relationship === 'calculation')?.evidence).toBe('direct');
    },
  );
  it('confirms a reference to a saved known column even when other input-union membership is unavailable', () => {
    const a = analyzePrepFields(
      flow(
        union([], fields('Amount')),
        node('calc', '.v1.AddColumn', { columnName: 'Gross', expression: '[Amount] + 1' }),
      ),
      luid,
    );
    expect(a.edges.find((e) => e.relationship === 'calculation')?.evidence).toBe('direct');
    expect(a.issues.some((i) => i.code === 'input-schema-partial')).toBe(true);
  });
  it('distinguishes a missing column in a known schema from a column in an unavailable schema', () => {
    const known = analyzePrepFields(
      flow(
        node(source, '.v1.LoadCsv', { fields: fields('Amount') }),
        node('calc', '.v1.AddColumn', { columnName: 'Gross', expression: '[Missing] + 1' }),
      ),
      luid,
    );
    expect(known.issues.find((i) => i.code === 'unresolved-field-reference')).toMatchObject({
      fieldName: 'Missing',
      status: 'broken',
    });
    const unavailable = analyzePrepFields(
      flow(
        node(source, '.v1.LoadSql'),
        node('calc', '.v1.AddColumn', { columnName: 'Gross', expression: '[Missing] + 1' }),
      ),
      luid,
    );
    expect(unavailable.issues.find((i) => i.code === 'unresolved-field-reference')).toMatchObject({
      fieldName: 'Missing',
      status: 'unresolved',
    });
  });
  it('follows the native source-row sentinel and explicit union provenance even when isGenerated is false', () => {
    const input = node('one', '.v2022_4_1.LoadExcel', {
      fields: fields('Amount'),
      actions: [
        {
          id: 'RemoveSourceRowNumberNodeTransform',
          nodeType: '.v1.RemoveColumns',
          columnNames: ['Source Row Number'],
        },
      ],
    });
    const root = node(source, '.v2022_2_1.LoadExcelInputUnion', {
      generatedInputs: [{ inputNode: input }],
      fields: fields('Amount', 'File Paths', 'Table Names'),
      pathNameField: 'File Paths',
      tableNameField: 'Table Names',
    });
    const a = analyzePrepFields(flow(root), luid);
    expect(a.issues).toEqual([]);
    expect(
      a.edges.filter((e) => e.relationship === 'input-union' && e.evidence === 'direct'),
    ).toHaveLength(1);
    expect(a.outputs.get(source)?.get('Default')?.fields.has('Source Row Number')).toBe(false);
  });
  it('uses native generated row-number naming without replacing real source columns', () => {
    expect(sourceRowNumberName([])).toBe('Source Row Number');
    expect(sourceRowNumberName([{ name: 'Source Row Number' }])).toBe('Source Row Number-1');
    expect(sourceRowNumberName([{ name: 'Source Row Number-2' }])).toBe('Source Row Number-3');
    expect(sourceRowNumberName([{ name: 'Source Row Number-8', isGenerated: true }])).toBe(
      'Source Row Number-8',
    );
    const a = analyzePrepFields(
      flow(node(source, '.v1.LoadCsv', { fields: fields('Source Row Number') })),
      luid,
    );
    expect(a.outputs.get(source)?.get('Default')?.fields.size).toBe(2);
    expect(a.nodes.find((n) => n.name === 'Source Row Number-1')?.operation).toBe(
      'generated-source-row-number',
    );
  });
  it('follows native generatedInputs and explicit member renames, without treating every input union as incomplete', () => {
    const a = analyzePrepFields(
      flow(
        union([
          member('one', ['Amount']),
          member('two', ['Net'], { fieldMappings: { '[Net]': 'Amount' } }),
        ]),
      ),
      luid,
    );
    const output = a.outputs.get(source)!.get('Default')!.fields.get('Amount')!;
    expect(a.edges.filter((e) => e.to === output).map((e) => e.evidence)).toEqual([
      'direct',
      'direct',
    ]);
    expect(
      a.nodes
        .filter((n) => a.edges.some((e) => e.to === output && e.from === n.id))
        .map((n) => n.name),
    ).toEqual(['Amount', 'Net']);
    expect(a.issues).toEqual([]);
  });

  it('resolves wildcard membership after a complete saved input-union schema', () => {
    const a = analyzePrepFields(
      flow(
        union([member('one', ['Q1']), member('two', ['Q2'])], fields('Q1', 'Q2')),
        node('long', '.v2018_3_4.UnpivotExtended', {
          unpivotGroup: {
            literalColumn: { literalColumnName: 'Period' },
            unpivotColumns: [
              {
                unpivotColumnName: 'Value',
                columnInformation: {
                  bindingsType: 'wildcard',
                  wildcardType: 'Starts with',
                  wildcardExpression: 'Q',
                },
              },
            ],
          },
        }),
      ),
      luid,
    );
    expect(a.issues).toEqual([]);
    expect(a.edges.filter((e) => e.relationship === 'unpivot')).toHaveLength(2);
    expect(a.edges.every((e) => e.evidence === 'direct')).toBe(true);
  });

  it('keeps missing members and contradictory mappings explicit, without guessing an input', () => {
    const a = analyzePrepFields(
      flow(
        union([
          member('one', ['Amount'], {
            fieldMappings: { Amount: 'Amount' },
            columnMappings: { Amount: 'Other' },
          }),
          { inputNode: node('two', '.v2022_4_1.LoadCsv') },
        ]),
      ),
      luid,
    );
    expect(a.issues.some((i) => i.code === 'ambiguous-input-union-mapping')).toBe(true);
    expect(a.issues.some((i) => i.code === 'input-schema-partial')).toBe(true);
    expect(
      a.edges.filter((e) => e.relationship === 'input-union' && e.evidence === 'direct'),
    ).toEqual([]);
  });

  it('does not assign member-column dependencies to generated input-union provenance', () => {
    const a = analyzePrepFields(
      flow(
        union(
          [member('one', ['Amount'])],
          [...fields('Amount'), { name: 'File Paths', type: 'string', isGenerated: true }],
        ),
      ),
      luid,
    );
    const generated = a.outputs.get(source)!.get('Default')!.fields.get('File Paths');
    expect(a.edges.some((e) => e.to === generated)).toBe(false);
    expect(a.issues).toEqual([]);
  });

  it('reads a native fieldId-only filter without treating a sibling column as its selector', () => {
    const a = analyzePrepFields(
      flow(
        node(source, '.v1.LoadCsv', { fields: fields('Amount', 'Other') }),
        node('filter', '.v2019_3_2.RichDiscreteValueFilter', { fieldId: `${source}-Amount` }),
      ),
      luid,
    );
    const amount = a.outputs.get(source)!.get('Default')!.fields.get('Amount');
    const other = a.outputs.get('filter')!.get('Default')!.fields.get('Other');
    expect(
      a.edges.some((e) => e.from === amount && e.to === other && e.evidence === 'direct'),
    ).toBe(true);
    expect(a.issues).toEqual([]);
  });

  it('uses saved model fieldMappings as declared model-input dependencies without claiming model execution', () => {
    const a = analyzePrepFields(
      flow(
        node(source, '.v1.LoadCsv', { fields: fields('Amount') }),
        node('model', '.v2021_1_3.PredictionNode', {
          predictionSettings: {
            outcomeName: 'Score',
            fieldMappings: { Amount: 'feature' },
            topPredictors: 1,
            topImprovements: 1,
          },
        }),
      ),
      luid,
    );
    expect(a.edges.filter((e) => e.relationship === 'prediction-input')).toHaveLength(5);
    expect(a.edges.every((e) => e.evidence === 'direct')).toBe(true);
    expect(a.issues).toEqual([]);
  });
});

describe('native Flow fieldId handoff', () => {
  it('retains every authorized owning flow without selecting an arbitrary owner for a shared field', () => {
    const a = analyzePrepFields(
      flow(node(source, '.v1.LoadCsv', { fields: fields('Amount') })),
      luid,
    );
    const shared = toLineageNode(
      {
        id: 'shared',
        __typename: 'FlowColumnInputField',
        fieldId: `${source}-Amount`,
        flow: [{ luid: source }, { luid }, null],
      },
      'flow-input-field',
    );
    expect(shared.flowLuid).toBeUndefined();
    expect(shared.flowLuids).toEqual([source, luid]);
    expect(prepCatalogBindings([shared], luid, a)[0].version).toBeDefined();
    expect(prepCatalogBindings([shared], calculation, a)).toEqual([]);
  });
  const native = (): FlowDocument =>
    flow(
      node(source, '.v1.LoadCsv', { fields: fields('Amount', 'Other') }),
      node(calculation, '.v1.AddColumn', { columnName: 'Gross', expression: '[Amount] * 1.1' }),
      node('out', '.v1.PublishExtract'),
    );

  it('selects the documented fieldId and output step while retaining API identities as separate namespaces', () => {
    expect(identitySelection('flow-input-field')).toContain('fieldId');
    expect(identitySelection('flow-output-field')).toContain('flowOutputStep { stepId }');
    const projected = toLineageNode(
      {
        id: 'catalog-output',
        __typename: 'FlowFieldOutputField',
        fieldId: `${calculation}-Gross`,
        flow: [{ luid }],
        flowOutputStep: { stepId: 'out' },
      },
      'flow-output-field',
    );
    expect(projected).toMatchObject({
      metadataId: 'catalog-output',
      fieldId: `${calculation}-Gross`,
      stepId: 'out',
      flowLuid: luid,
    });
  });

  it('binds input/output by exact native identifier even when captions differ', () => {
    const a = analyzePrepFields(native(), luid);
    const resolved = prepCatalogBindings(
      [
        {
          id: 'in',
          kind: 'flow-input-field',
          flowLuid: luid,
          fieldId: `${source}-Amount`,
          name: 'A different caption',
        },
        {
          id: 'out',
          kind: 'flow-output-field',
          flowLuid: luid,
          fieldId: `${calculation}-Gross`,
          stepId: 'out',
          name: 'Another caption',
        },
      ],
      luid,
      a,
    );
    expect(resolved.map((b) => a.nodes.find((n) => n.id === b.version)?.name)).toEqual([
      'Amount',
      'Gross',
    ]);
    expect(resolved.every((b) => !b.reason)).toBe(true);
  });

  it('rejects name-only, wrong-output-step and foreign-flow lookalikes', () => {
    const a = analyzePrepFields(native(), luid);
    const rows = prepCatalogBindings(
      [
        {
          id: 'caption-only',
          kind: 'flow-output-field',
          flowLuid: luid,
          name: 'Gross',
          stepId: 'out',
        },
        {
          id: 'wrong-step',
          kind: 'flow-output-field',
          flowLuid: luid,
          fieldId: `${calculation}-Gross`,
          stepId: 'missing',
        },
        {
          id: 'foreign',
          kind: 'flow-output-field',
          flowLuid: source,
          fieldId: `${calculation}-Gross`,
          stepId: 'out',
        },
      ],
      luid,
      a,
    );
    expect(rows.map((r) => r.reason)).toEqual([
      'missing-native-field-id',
      'native-field-id-not-found',
    ]);
    expect(rows.some((r) => r.version)).toBe(false);
  });

  it('connects a catalog column through the actual Prep calculation into its catalog output without including another field', () => {
    const traversal = new DataLineageTraversal(
      z.object(dataLineageParams).parse({ source: { type: 'column', id: 'column' } }),
      { graphql: vi.fn(), isAllowed: async () => true, prepEnabled: true },
    );
    const graph = traversal.result;
    graph.resolution = 'resolved';
    graph.sourceId = 'column';
    graph.nodes.push(
      { id: 'column', kind: 'column' },
      { id: 'flow', kind: 'flow', luid },
      { id: 'catalog-in', kind: 'flow-input-field', flowLuid: luid, fieldId: `${source}-Amount` },
      {
        id: 'catalog-out',
        kind: 'flow-output-field',
        flowLuid: luid,
        fieldId: `${calculation}-Gross`,
        stepId: 'out',
      },
      {
        id: 'catalog-other',
        kind: 'flow-output-field',
        flowLuid: luid,
        fieldId: `${source}-Other`,
        stepId: 'out',
      },
    );
    graph.edges.push({
      id: 'column-input',
      from: 'column',
      to: 'catalog-in',
      relationship: 'column',
      evidence: 'direct',
      provenance: 'metadata-api',
      propagates: true,
    });
    addPrepTopology(traversal, graph.nodes[1], native(), { type: 'column', id: 'column' });
    const impacts = analyzeLineageImpact(graph);
    expect(impacts.find((i) => i.nodeId === 'catalog-out')?.classification).toBe('indirect');
    expect(impacts.some((i) => i.nodeId === 'catalog-other')).toBe(false);
    expect(graph.prepDetails?.[0].fieldAnalysis?.catalogBindings).toEqual({
      confirmed: 3,
      unresolved: 0,
    });
  });
  it('does not let a confirmed output suppress an unresolved handoff at another output step', () => {
    const traversal = new DataLineageTraversal(
      z.object(dataLineageParams).parse({ source: { type: 'flow', luid }, maxNodes: 500 }),
      { graphql: vi.fn(), isAllowed: async () => true, prepEnabled: true },
    );
    const flowNode = { id: 'flow', kind: 'flow' as const, luid };
    traversal.result.nodes.push(
      flowNode,
      {
        id: 'out-field',
        kind: 'flow-output-field',
        flowLuid: luid,
        fieldId: `${source}-Amount`,
        stepId: 'out',
      },
      { id: 'second', kind: 'flow-output-step', flowLuid: luid, stepId: 'second' },
    );
    addPrepTopology(
      traversal,
      flowNode,
      flow(
        node(source, '.v1.LoadCsv', { fields: fields('Amount') }),
        node('out', '.v1.PublishExtract'),
        node('second', '.v1.PublishExtract'),
      ),
      { type: 'flow', luid },
    );
    expect(
      traversal.result.edges.some(
        (e) =>
          e.to === 'second' &&
          e.relationship === 'unverified-catalog-output-field-binding' &&
          e.evidence === 'possible',
      ),
    ).toBe(true);
  });
});
