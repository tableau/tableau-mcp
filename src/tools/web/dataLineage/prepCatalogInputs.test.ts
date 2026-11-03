import { z } from 'zod';

import { DataLineageTraversal } from '../../../sdks/tableau/methods/dataLineage.js';
import {
  dataLineageParams,
  LineageNode,
  PrepSchemaObservation,
} from '../../../sdks/tableau/types/dataLineage.js';
import { FlowDocument } from '../../../sdks/tableau/types/flowDocument.js';
import { analyzeLineageImpact } from './dataImpact.js';
import { prepCatalogBindings } from './prepCatalogBindings.js';
import { analyzePrepCatalogFields } from './prepCatalogInputs.js';
import { addPrepTopology } from './prepLineage.js';
import { prepDocumentSha256 } from './prepSchemaObservations.js';

const luid = '11111111-1111-4111-8111-111111111111';
const inputId = '22222222-2222-4222-8222-222222222222';
const outputId = '33333333-3333-4333-8333-333333333333';
const foreignId = '44444444-4444-4444-8444-444444444444';
const input: LineageNode = {
  id: 'catalog-input',
  kind: 'flow-input-field',
  metadataType: 'FlowColumnInputField',
  flowLuid: luid,
  name: 'A caption that is not the native name',
  fieldId: `${inputId}-${inputId}-2018`,
};
const output: LineageNode = {
  id: 'catalog-output',
  kind: 'flow-output-field',
  flowLuid: luid,
  stepId: outputId,
  fieldId: `${outputId}-${outputId}-Value`,
};
const native = (): FlowDocument => ({
  nodes: {
    [inputId]: {
      id: inputId,
      nodeType: '.v1.LoadExcel',
      fields: [
        { name: '2017', type: 'real' },
        { name: 'Other', type: 'real' },
      ],
      nextNodes: [{ nextNodeId: outputId }],
    },
    [outputId]: {
      id: outputId,
      nodeType: '.v1.Unpivot',
      unpivotGroups: [
        { expressions: [{ bindings: [{ columnName: '2018', newColumnName: 'Value' }] }] },
      ],
    },
  },
});
const analyze = (
  document = native(),
  catalog = [input],
  observations: PrepSchemaObservation[] = [],
  limit = 5000,
): ReturnType<typeof analyzePrepCatalogFields> =>
  analyzePrepCatalogFields(document, luid, limit, observations, catalog);

describe('current catalog input schema recovery', () => {
  it.each(['FlowColumnInputField', 'FlowFieldInputField'])(
    'recovers an exact %s absent only from the saved cache and connects its real Unpivot dependency',
    (metadataType) => {
      const document = native();
      const before = JSON.stringify(document);
      const catalog = [{ ...input, metadataType }, output];
      const result = analyze(document, catalog);
      const bindings = prepCatalogBindings(catalog, luid, result);
      expect(result.catalogInputsAdded).toBe(1);
      expect(bindings.every((binding) => binding.version)).toBe(true);
      expect(result.edges).toContainEqual(
        expect.objectContaining({
          from: bindings[0].version,
          to: bindings[1].version,
          relationship: 'unpivot',
          evidence: 'direct',
        }),
      );
      expect(result.issues.some((issue) => issue.fieldName === '2018')).toBe(false);
      expect(result.issues).toContainEqual(
        expect.objectContaining({ code: 'catalog-input-schema-drift' }),
      );
      expect(result.outputs.get(inputId)?.get('Default')?.complete).toBe(false);
      expect(JSON.stringify(document)).toBe(before);
    },
  );

  it('accepts a plain exact input identity and multiple permitted owners without using the caption', () => {
    const result = analyze(native(), [
      { ...input, flowLuid: undefined, flowLuids: [foreignId, luid], fieldId: `${inputId}-2018` },
    ]);
    expect(result.catalogInputsAdded).toBe(1);
    expect(
      result.nodes.filter((node) => node.operation === 'catalog-input').map((node) => node.name),
    ).toEqual(['2018']);
  });

  it.each([
    { fieldId: undefined },
    { fieldId: 'opaque-id', name: '2018' },
    { fieldId: `${foreignId}-${inputId}-2018` },
    { fieldId: `${inputId}-${foreignId}-2018` },
    { flowLuid: foreignId },
    { metadataType: 'Column' },
    { metadataType: undefined },
    { kind: 'flow-output-field' as const, stepId: inputId },
    { fieldId: `${inputId}-${inputId}-<Parameters.Year>` },
    { fieldId: `${inputId}-${inputId}-bad\nname` },
    { fieldId: `${inputId}-${inputId}-${'x'.repeat(1025)}` },
  ])(
    'refuses caption guesses, foreign scopes, unsupported types and unsafe identities (%j)',
    (changes) => {
      expect(analyze(native(), [{ ...input, ...changes }]).catalogInputsAdded).toBe(0);
    },
  );

  it('does not turn a field created or renamed by input-local actions into a new raw input', () => {
    const document = native();
    document.nodes![inputId].actions = [
      { id: 'calc', nodeType: '.v1.AddColumn', columnName: 'Net', expression: '[2017] + 1' },
      { id: 'rename', nodeType: '.v1.RenameColumn', columnName: 'Net', rename: '2018' },
    ];
    const result = analyze(document);
    const binding = prepCatalogBindings([input], luid, result)[0];
    expect(result.catalogInputsAdded).toBe(0);
    expect(binding.version).toBe(result.outputs.get(inputId)?.get('Default')?.fields.get('2018'));
    expect(result.nodes.find((node) => node.id === binding.version)?.operation).toBe('rename');
    expect(result.nodes.some((node) => node.operation === 'catalog-input')).toBe(false);
    expect(
      result.edges.some(
        (edge) => edge.relationship === 'calculation' && edge.evidence === 'direct',
      ),
    ).toBe(true);
  });

  it('does not add raw fields across incomplete input-local mappings or a truncated analysis', () => {
    const document = native();
    document.nodes![inputId].userRenamedFields = { 2017: 'Year' };
    expect(analyze(document).catalogInputsAdded).toBe(0);
    const limited = analyze(native(), [input], [], 1);
    expect(limited.truncated).toBe(true);
    expect(limited.nodes).toHaveLength(1);
    expect(limited.catalogInputsAdded).toBe(0);
  });

  it('does not override a matching complete observation or conflicting matching observations', () => {
    const document = native();
    const observation: PrepSchemaObservation = {
      documentSha256: prepDocumentSha256(document),
      nodeId: inputId,
      fields: [{ name: '2017', type: 'real' }],
    };
    expect(analyze(document, [input], [observation]).catalogInputsAdded).toBe(0);
    const ambiguous = analyze(document, [input], [observation, observation]);
    expect(ambiguous.catalogInputsAdded).toBe(0);
    expect(ambiguous.issues.some((issue) => issue.code === 'ambiguous-schema-observation')).toBe(
      true,
    );
    expect(
      analyze(document, [input], [{ ...observation, documentSha256: '0'.repeat(64) }])
        .catalogInputsAdded,
    ).toBe(1);
  });

  it('keeps wildcard membership unresolved when catalog adds an individual field to a stale cache', () => {
    const document = native();
    document.nodes![outputId] = {
      id: outputId,
      nodeType: '.v2018_3_4.UnpivotExtended',
      unpivotGroup: {
        unpivotColumns: [
          {
            unpivotColumnName: 'Value',
            columnInformation: {
              bindingsType: 'wildcard',
              wildcardType: 'Starts with',
              wildcardExpression: '201',
            },
          },
        ],
      },
    };
    const result = analyze(document);
    expect(result.catalogInputsAdded).toBe(1);
    expect(result.issues.some((issue) => issue.code === 'unresolved-unpivot-membership')).toBe(
      true,
    );
    expect(
      result.edges.some((edge) => edge.relationship === 'unpivot' && edge.evidence === 'direct'),
    ).toBe(false);
  });

  it('exposes a verified catalog-to-Prep-to-output impact path and Metadata provenance without unrelated impacts', () => {
    const traversal = new DataLineageTraversal(
      z
        .object(dataLineageParams)
        .parse({ source: { type: 'flow-input-field', id: 'catalog-input' }, maxNodes: 100 }),
      { graphql: vi.fn(), isAllowed: async () => true, prepEnabled: true },
    );
    const flow = { id: 'flow', kind: 'flow' as const, luid };
    traversal.result.nodes.push(flow, input, output, {
      ...output,
      id: 'unrelated-output',
      fieldId: `${outputId}-${inputId}-Other`,
    });
    traversal.result.sourceId = input.id;
    traversal.result.resolution = 'resolved';
    addPrepTopology(traversal, flow, native(), { type: 'flow-input-field', id: 'catalog-input' });
    expect(traversal.result.prepDetails?.[0].fieldAnalysis).toMatchObject({
      catalogInputsAdded: 1,
      catalogBindings: { confirmed: 3, unresolved: 0 },
    });
    const impacts = analyzeLineageImpact(traversal.result);
    expect(impacts.find((impact) => impact.nodeId === output.id)?.classification).toBe('indirect');
    expect(impacts.some((impact) => impact.nodeId === 'unrelated-output')).toBe(false);
    expect(
      traversal.result.edges.find(
        (edge) => edge.from === input.id && edge.relationship === 'native-flow-field-id',
      ),
    ).toMatchObject({ evidence: 'direct', provenance: 'metadata-api' });
  });

  it('resolves the recovered field as a Prep-field origin without a stale not-found warning', () => {
    const traversal = new DataLineageTraversal(
      z.object(dataLineageParams).parse({
        source: { type: 'prep-field', flowLuid: luid, stepId: inputId, name: '2018' },
        maxNodes: 100,
      }),
      { graphql: vi.fn(), isAllowed: async () => true, prepEnabled: true },
    );
    const flow = { id: 'flow', kind: 'flow' as const, luid };
    traversal.result.nodes.push(flow, input, output);
    addPrepTopology(traversal, flow, native(), {
      type: 'prep-field',
      flowLuid: luid,
      stepId: inputId,
      name: '2018',
    });
    expect(traversal.result.resolution).toBe('resolved');
    expect(
      traversal.result.nodes.find((node) => node.id === traversal.result.sourceId)?.operation,
    ).toBe('catalog-input');
    expect(
      traversal.result.warnings.some((warning) => warning.code === 'PREP_SOURCE_UNRESOLVED'),
    ).toBe(false);
  });
});
