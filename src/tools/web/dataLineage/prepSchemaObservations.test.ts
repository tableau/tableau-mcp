import { z } from 'zod';

import { dataLineageParams } from '../../../sdks/tableau/types/dataLineage.js';
import { analyzePrepFields } from './prepFieldLineage.js';
import { prepDocumentSha256 } from './prepSchemaObservations.js';

const luid = '11111111-1111-4111-8111-111111111111';
const script = {
  nodes: {
    input: {
      id: 'input',
      nodeType: '.v1.LoadCsv',
      fields: [{ name: 'Amount', type: 'real' }],
      nextNodes: [{ nextNodeId: 'script' }],
    },
    script: {
      id: 'script',
      nodeType: '.v2019_2_2.ExtensibilityNode',
      nextNodes: [{ nextNodeId: 'calculation' }],
      executionParameters: { privateScript: 'PRIVATE_SCRIPT_CANARY' },
    },
    calculation: {
      id: 'calculation',
      nodeType: '.v1.AddColumn',
      columnName: 'After',
      expression: '[Score] + 1',
    },
  },
};

describe('source-bound operator schema observations', () => {
  it('provides reproducible requirements and omits script contents from the result', () => {
    const result = analyzePrepFields(script, luid);
    expect(result.schemaRequirements?.documentSha256).toBe(prepDocumentSha256(script));
    expect(result.schemaRequirements?.nodes.map((n) => n.nodeId)).toEqual(['input', 'script']);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_SCRIPT_CANARY');
    expect(prepDocumentSha256({ a: { b: 1, c: 2 }, d: [] })).toBe(
      prepDocumentSha256({ d: [], a: { c: 2, b: 1 } }),
    );
  });

  it('traces downstream from observed script outputs without inventing dependencies inside the script', () => {
    const result = analyzePrepFields(script, luid, 5000, [
      {
        documentSha256: prepDocumentSha256(script),
        nodeId: 'script',
        fields: [{ name: 'Score', type: 'real' }],
      },
    ]);
    const output = result.nodes.find((n) => n.operation === 'script-output')!;
    expect(result.appliedSchemaObservations).toBe(1);
    expect(result.nodes.find((n) => n.name === 'After')).toBeDefined();
    expect(result.edges.some((e) => e.from === output.id && e.evidence === 'direct')).toBe(true);
    expect(result.edges.some((e) => e.to === output.id)).toBe(false);
    expect(result.issues.some((i) => i.code === 'external-script-dependencies-unavailable')).toBe(
      true,
    );
    expect(JSON.stringify(result)).not.toContain('PRIVATE_SCRIPT_CANARY');
  });

  it('refuses stale observations after upstream settings or script metadata changes', () => {
    const digest = prepDocumentSha256(script);
    const changed = structuredClone(script);
    changed.nodes.input.fields[0].type = 'integer';
    const result = analyzePrepFields(changed, luid, 5000, [
      { documentSha256: digest, nodeId: 'script', fields: [{ name: 'Score', type: 'real' }] },
    ]);
    expect(result.appliedSchemaObservations).toBe(0);
    expect(result.nodes.some((n) => n.name === 'Score')).toBe(false);
    expect(result.issues.some((i) => i.code === 'stale-schema-observation')).toBe(true);
    expect(prepDocumentSha256(script)).toBe(digest);
  });

  it('can resolve current wildcard membership using an observed logical input-union schema while retaining missing member provenance', () => {
    const native = {
      nodes: {
        input: {
          id: 'input',
          nodeType: '.v1.LoadCsvInputUnion',
          nextNodes: [{ nextNodeId: 'long' }],
        },
        long: {
          id: 'long',
          nodeType: '.v2018_3_4.UnpivotExtended',
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
        },
      },
    };
    const result = analyzePrepFields(native, luid, 5000, [
      {
        documentSha256: prepDocumentSha256(native),
        nodeId: 'input',
        fields: [
          { name: 'Q1', type: 'real' },
          { name: 'Q2', type: 'real' },
        ],
      },
    ]);
    expect(
      result.edges.filter((e) => e.relationship === 'unpivot' && e.evidence === 'direct'),
    ).toHaveLength(2);
    expect(result.issues.map((i) => i.code)).toEqual(['input-union-member-lineage-unavailable']);
  });

  it('accepts model output type observations only when the saved native output schema agrees', () => {
    const native = {
      nodes: {
        input: {
          id: 'input',
          nodeType: '.v1.LoadCsv',
          fields: [{ name: 'Amount', type: 'real' }],
          nextNodes: [{ nextNodeId: 'model' }],
        },
        model: {
          id: 'model',
          nodeType: '.v2021_1_3.PredictionNode',
          predictionSettings: { outcomeName: 'Score', fieldMappings: { Amount: 'feature' } },
        },
      },
    };
    const documentSha256 = prepDocumentSha256(native);
    const valid = analyzePrepFields(native, luid, 5000, [
      {
        documentSha256,
        nodeId: 'model',
        fields: [
          { name: 'Amount', type: 'real' },
          { name: 'Source Row Number', type: 'integer' },
          { name: 'Score', type: 'real' },
        ],
      },
    ]);
    expect(valid.appliedSchemaObservations).toBe(1);
    expect(valid.nodes.find((n) => n.name === 'Score')?.dataType).toBe('real');
    const different = analyzePrepFields(native, luid, 5000, [
      { documentSha256, nodeId: 'model', fields: [{ name: 'Unexpected', type: 'string' }] },
    ]);
    expect(different.appliedSchemaObservations).toBe(0);
    expect(different.issues.some((i) => i.code === 'observed-prediction-schema-difference')).toBe(
      true,
    );
  });

  it('bounds observations and rejects duplicates, credential-shaped extra properties and malformed bindings at the tool schema', () => {
    const parse = (observedPrepSchemas: unknown): z.SafeParseReturnType<unknown, unknown> =>
      z
        .object(dataLineageParams)
        .safeParse({ source: { type: 'flow', luid }, observedPrepSchemas });
    const observation = {
      documentSha256: prepDocumentSha256(script),
      nodeId: 'script',
      fields: [{ name: 'Score', type: 'real' }],
    };
    expect(parse([observation]).success).toBe(true);
    expect(parse([observation, observation]).success).toBe(false);
    expect(
      parse([{ ...observation, fields: [observation.fields[0], observation.fields[0]] }]).success,
    ).toBe(false);
    expect(parse([{ ...observation, secret: 'PRIVATE_SECRET_CANARY' }]).success).toBe(false);
    expect(parse([{ ...observation, documentSha256: 'wrong' }]).success).toBe(false);
    expect(
      parse(Array.from({ length: 101 }, (_, i) => ({ ...observation, nodeId: String(i) }))).success,
    ).toBe(false);
    const many = Array.from({ length: 2501 }, (_, i) => ({ name: `field${i}`, type: 'real' }));
    expect(
      parse([
        { ...observation, nodeId: 'a', fields: many },
        { ...observation, nodeId: 'b', fields: many },
      ]).success,
    ).toBe(false);
  });

  it('bounds document hashing and refuses cycles without echoing metadata', () => {
    const cyclic: Record<string, unknown> = { private: 'PRIVATE_HASH_CANARY' };
    cyclic.self = cyclic;
    expect(() => prepDocumentSha256(cyclic)).toThrow('Unsupported Prep schema binding structure.');
    expect(() => prepDocumentSha256('x'.repeat(16 * 1024 * 1024 + 1))).toThrow('byte limit');
  });
});
