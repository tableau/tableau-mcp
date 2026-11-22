import { parseFlowPackage } from '../../../sdks/tableau/methods/flowPackage.js';
import { analyzePrepScript } from '../../../sdks/tableau/methods/prepScriptAnalysis.js';
import fixtures from '../../../sdks/tableau/methods/prepScriptAnalysis.test.fixtures.json';
import { DataLineageResult } from '../../../sdks/tableau/types/dataLineage.js';
import { analyzeLineageImpact } from './dataImpact.js';
import { analyzePrepFields } from './prepFieldLineage.js';
import { prepDocumentSha256 } from './prepSchemaObservations.js';

const luid = '11111111-1111-4111-8111-111111111111';
const script = '22222222-2222-4222-8222-222222222222';
const model = '44444444-4444-4444-8444-444444444444';
const out = '55555555-5555-4555-8555-555555555555';
const packageFor = (language: 'python' | 'r'): ReturnType<typeof parseFlowPackage> =>
  parseFlowPackage(Buffer.from(fixtures[language], 'base64'));

describe('script and prediction field provenance migration', () => {
  it('keeps a nested script creation owned by its container while retaining the native script ID', () => {
    const parsed = packageFor('python');
    const groupId = '66666666-6666-4666-8666-666666666666';
    const inner = structuredClone(parsed.document.nodes![script]);
    inner.nextNodes = [];
    parsed.document.nodes![luid].nextNodes = [{ nextNodeId: groupId }];
    parsed.document.nodes![groupId] = {
      id: groupId,
      nodeType: '.v1.Container',
      nextNodes: [{ nextNodeId: '33333333-3333-4333-8333-333333333333' }],
      namespacesToInput: { Default: { nodeId: script, namespace: 'Default' } },
      namespacesToOutput: { Default: { nodeId: script, namespace: 'Default' } },
      loomContainer: { nodes: { [script]: inner } },
    };
    delete parsed.document.nodes![script];
    const result = analyzePrepFields(parsed.document, luid, 1000, [], [], parsed.scriptContext);
    expect(result.externalSteps[0]).toMatchObject({
      nodeId: script,
      stepId: groupId,
      usedFields: ['Price', 'Qty'],
    });
    expect(result.outputs.get(out)!.get('Default')!.fields.has('Score')).toBe(true);
  });
  it('uses native prediction suffixes from the full requested base and coordinated value/Impact pairs', () => {
    const document = {
      nodes: {
        input: {
          id: 'input',
          nodeType: '.v1.LoadCsv',
          fields: [
            { name: 'Score-2', type: 'real' },
            { name: 'Predictor 1', type: 'string' },
          ],
          nextNodes: [{ nextNodeId: model }],
        },
        [model]: {
          id: model,
          nodeType: '.v2021_1_3.PredictionNode',
          predictionSettings: {
            outcomeName: 'Score-2',
            fieldMappings: { 'Score-2': 'feature' },
            topPredictors: 1,
          },
        },
      },
    };
    const result = analyzePrepFields(document, luid);
    expect([...result.outputs.get(model)!.get('Default')!.fields.keys()]).toEqual(
      expect.arrayContaining(['Score-2-1', 'Predictor 1-1', 'Predictor 1 Impact-1']),
    );
  });
  it.each(['python', 'r'] as const)(
    'traces %s through creation, rename and model mappings without unrelated inputs or private settings',
    (language) => {
      const parsed = packageFor(language);
      const result = analyzePrepFields(parsed.document, luid, 1000, [], [], parsed.scriptContext);
      const details = result.externalSteps;
      expect(details[0]).toMatchObject({
        nodeId: script,
        family: 'script',
        usedFields: ['Price', 'Qty'],
        settings: { language, function: 'transform' },
        schemaStatus: 'static-declaration',
        nativeExecutionVerified: false,
      });
      expect(details[0].inputFields.find((field) => field.name === 'Other')?.role).toBe('provided');
      expect(details[0].outputFields).toEqual([{ name: 'Total', type: 'real' }]);
      expect(details[1]).toMatchObject({
        family: 'prediction',
        usedFields: ['Revenue'],
        settings: { outcomeName: 'Score', topPredictors: 1, topImprovements: 1 },
      });
      expect(details[1].fieldMappings).toEqual([
        { inputField: 'Revenue', modelField: 'model_total' },
      ]);
      expect(details[1].inputFields.find((field) => field.name === 'Revenue')).toEqual({
        name: 'Revenue',
        type: 'real',
        role: 'explicit-reference',
      });
      const total = result.outputs.get(script)!.get('Default')!.fields.get('Total')!;
      expect(result.nodes.find((node) => node.id === total)).toMatchObject({
        originKind: 'script',
        operation: 'script-output',
        dependencyStatus: 'static',
      });
      const inputs = result.nodes.filter((node) =>
        result.edges.some((edge) => edge.from === node.id && edge.to === total),
      );
      expect(inputs.map((node) => node.name)).toEqual(['Price', 'Qty']);
      const source = inputs.find((node) => node.name === 'Price')!.id;
      const graph = {
        nodes: result.nodes,
        edges: result.edges,
        sourceId: source,
      } as DataLineageResult;
      const impacts = analyzeLineageImpact(graph);
      expect(
        impacts.find(
          (impact) =>
            impact.nodeId === result.outputs.get(out)!.get('Default')!.fields.get('Score'),
        )?.classification,
      ).toBe('possible');
      expect(
        impacts.some(
          (impact) => result.nodes.find((node) => node.id === impact.nodeId)?.name === 'Other',
        ),
      ).toBe(false);
      expect(JSON.stringify(details)).not.toMatch(
        /NEVER_RETURN|scriptTempRelativePath|transform\.py|import pandas/,
      );
    },
  );
  it('binds observations to script bytes even when the native flow JSON is unchanged', () => {
    const before = packageFor('python');
    const after = parseFlowPackage(Buffer.from(fixtures.changedPython, 'base64'));
    expect(before.document).toEqual(after.document);
    const first = analyzePrepFields(before.document, luid, 1000, [], [], before.scriptContext);
    const observation = {
      documentSha256: first.schemaRequirements!.documentSha256,
      nodeId: script,
      fields: [{ name: 'Total', type: 'real' as const }],
    };
    expect(
      analyzePrepFields(before.document, luid, 1000, [observation], [], before.scriptContext)
        .appliedSchemaObservations,
    ).toBe(1);
    const changed = analyzePrepFields(
      after.document,
      luid,
      1000,
      [observation],
      [],
      after.scriptContext,
    );
    expect(changed.schemaRequirements!.documentSha256).not.toBe(
      first.schemaRequirements!.documentSha256,
    );
    expect(changed.appliedSchemaObservations).toBe(0);
    expect(changed.issues.some((issue) => issue.code === 'stale-schema-observation')).toBe(true);
  });
  it('preserves complete observed output schemas and reports literal declaration differences', () => {
    const parsed = packageFor('python');
    const result = analyzePrepFields(
      parsed.document,
      luid,
      1000,
      [
        {
          documentSha256: prepDocumentSha256(parsed.document, parsed.scriptContext),
          nodeId: script,
          fields: [
            { name: 'Total', type: 'string' },
            { name: 'Extra', type: 'integer' },
          ],
        },
      ],
      [],
      parsed.scriptContext,
    );
    expect(result.externalSteps[0].schemaStatus).toBe('observed');
    expect(result.externalSteps[0].schemaDifferences).toEqual([
      { name: 'Extra', kind: 'extra' },
      { name: 'Total', kind: 'type' },
    ]);
    expect(result.issues.some((issue) => issue.code === 'observed-script-schema-difference')).toBe(
      true,
    );
  });
  it('uses literal identity functions with the native default input schema, without guessing unknown code', () => {
    const parsed = packageFor('python');
    const context = {
      scripts: {
        [script]: analyzePrepScript(Buffer.from('def transform(data):\n return data\n'), 'python'),
      },
    };
    const result = analyzePrepFields(parsed.document, luid, 1000, [], [], context);
    expect(result.externalSteps[0].usedFields).toEqual([
      'Price',
      'Qty',
      'Other',
      'Source Row Number',
    ]);
    expect(result.outputs.get(script)!.get('Default')!.fields.has('Other')).toBe(true);
    expect(
      result.issues.some((issue) => issue.code === 'external-script-dependencies-unavailable'),
    ).toBe(false);
  });
  it('keeps candidate script calls possible and unresolved input references unknown', () => {
    const parsed = packageFor('python');
    const evidence = analyzePrepScript(
      Buffer.from(
        fixtures.pythonSource.replace(
          "data['Price'] * data['Qty']",
          "remote(data['Price'], data['Missing'])",
        ),
      ),
      'python',
    );
    const result = analyzePrepFields(parsed.document, luid, 1000, [], [], {
      scripts: { [script]: evidence },
    });
    const total = result.outputs.get(script)!.get('Default')!.fields.get('Total');
    expect(
      result.edges.filter((edge) => edge.to === total).every((edge) => edge.evidence === 'unknown'),
    ).toBe(true);
    expect(result.issues.some((issue) => issue.fieldName === 'Missing')).toBe(true);
    const valid = analyzePrepScript(
      Buffer.from(
        fixtures.pythonSource.replace("data['Price'] * data['Qty']", "remote(data['Price'])"),
      ),
      'python',
    );
    const candidate = analyzePrepFields(parsed.document, luid, 1000, [], [], {
      scripts: { [script]: valid },
    });
    expect(
      candidate.edges
        .filter((edge) => edge.relationship === 'script-output')
        .every((edge) => edge.evidence === 'possible'),
    ).toBe(true);
  });
  it('retains typed native prediction pairs and blank defaults while rejecting observed type drift', () => {
    const parsed = packageFor('python');
    parsed.document.nodes![model].predictionSettings = {
      outcomeName: ' \t ',
      fieldMappings: { Revenue: 'model_total' },
      topPredictors: 1,
    };
    const result = analyzePrepFields(parsed.document, luid, 1000, [], [], parsed.scriptContext);
    const outputs = result.outputs.get(model)!.get('Default')!;
    expect(
      result.nodes.find((node) => node.id === outputs.fields.get('Prediction'))?.dataType,
    ).toBe('real');
    expect(
      result.nodes.find((node) => node.id === outputs.fields.get('Predictor 1'))?.dataType,
    ).toBe('string');
    const observed = analyzePrepFields(
      parsed.document,
      luid,
      1000,
      [
        {
          documentSha256: prepDocumentSha256(parsed.document, parsed.scriptContext),
          nodeId: model,
          fields: [...outputs.fields.keys()].map((name) => ({ name, type: 'string' as const })),
        },
      ],
      [],
      parsed.scriptContext,
    );
    expect(
      observed.issues.some((issue) => issue.code === 'observed-prediction-type-difference'),
    ).toBe(true);
  });
});
