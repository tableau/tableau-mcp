import Ajv2020 from 'ajv/dist/2020.js';
import { z } from 'zod';

import { isFloatField, isObject, Json, Obj, object } from './compactYaml.js';
import { AuthoringError, MAX_ITEMS } from './projectIo.js';
import schemaDocument from './tableau_prep_flow.schema.json';

export const knownEntries = ['flow', 'displaySettings', 'maestroMetadata'] as const;
export const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
export const alias = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/;
export class SchemaValues {
  readonly schema = schemaDocument as unknown as Obj;
  definition(name: string): Obj {
    let shape: Json = this.schema.$defs;
    for (const part of name.split('/')) shape = object(shape)[part];
    return object(shape);
  }
  expand(shape: Obj): Obj {
    if (shape.$ref === undefined) return shape;
    if (typeof shape.$ref !== 'string' || !shape.$ref.startsWith('#/$defs/'))
      throw new AuthoringError();
    const target = this.definition(shape.$ref.slice(8));
    if (target.$ref) throw new AuthoringError();
    const { $ref: _, ...remaining } = shape;
    return { ...target, ...remaining };
  }
  template(name: string): Obj {
    const read = (source: Obj): Json | undefined => {
      const referenced = source.$ref !== undefined,
        shape = this.expand(source);
      if (Object.hasOwn(shape, 'const')) return structuredClone(shape.const);
      if (Object.hasOwn(shape, 'default')) return structuredClone(shape.default);
      if (referenced) return undefined;
      const value: Obj = {};
      for (const [key, child] of Object.entries(object(shape.properties ?? {}))) {
        const item = read(object(child));
        if (item !== undefined) value[key] = item;
      }
      return Object.keys(value).length ? value : undefined;
    };
    return object(read(this.definition(name)) ?? {});
  }
  defaults(target: Obj, name: string): void {
    for (const [key, value] of Object.entries(this.template(name)))
      if (!Object.hasOwn(target, key)) target[key] = value;
  }
  variant(type: Json): string | undefined {
    if (typeof type !== 'string') return;
    for (const [name, shape] of Object.entries(this.definition('nodeVariants'))) {
      const discriminator = object(object(object(shape).properties).nodeType);
      if (
        discriminator.const === type ||
        (typeof discriminator.pattern === 'string' && new RegExp(discriminator.pattern).test(type))
      )
        return 'nodeVariants/' + name;
    }
  }
  describe(name?: string): Obj {
    const start = name ? this.definition(name) : this.schema,
      records: Json[] = [];
    const constraints = [
      'type',
      'const',
      'enum',
      'pattern',
      'format',
      'items',
      'additionalProperties',
      'required',
      'minimum',
      'maximum',
      'minItems',
      'maxItems',
      'minLength',
      'maxLength',
      'default',
      'examples',
      'x-value-evidence',
      'x-native-known-values',
      'x-authoring-generated',
    ];
    const select = (shape: Obj): Obj =>
      Object.fromEntries(
        constraints
          .filter((k) => Object.hasOwn(shape, k))
          .map((k) => [k, structuredClone(shape[k])]),
      );
    const visit = (value: Json, path: string, inherited: Json = null): void => {
      if (isObject(value)) {
        const evidence = value['x-value-evidence'] ?? inherited;
        for (const [key, shape] of Object.entries(object(value.properties ?? {}))) {
          const expanded = this.expand(object(shape)),
            record: Obj = { key, schemaPath: path + '/properties/' + key, ...select(expanded) };
          if (!Object.hasOwn(record, 'x-value-evidence'))
            record['x-value-evidence'] = evidence
              ? structuredClone(evidence)
              : { kind: 'unverified-value-domain' };
          if (Array.isArray(expanded.anyOf))
            record.alternatives = expanded.anyOf.map((shape) =>
              structuredClone(this.expand(object(shape))),
            );
          records.push(record);
        }
        for (const [key, child] of Object.entries(value))
          if (!['default', 'examples', 'x-value-evidence', 'x-native-known-values'].includes(key))
            visit(child, path + '/' + key.replaceAll('~', '~0').replaceAll('/', '~1'), evidence);
      } else if (Array.isArray(value))
        value.forEach((child, index) => visit(child, path + '/' + index, inherited));
    };
    visit(start, name ? '#/$defs/' + name : '#');
    return {
      format: 'tableau-prep-values/v1',
      definition: name ?? null,
      contract: select(start),
      properties: records,
      notes: [
        'Static generation values use const/default; IDs and references use declared generation strategies.',
        'Native XML value domains are distinct from flow JSON domains.',
        'Known native values and examples are not exhaustive enums unless enum is explicit.',
      ],
    };
  }
}

const id = z.string().regex(uuid),
  text = z.string().nullable().optional();
const integer = z.union([z.number().int(), z.bigint()]).nullable().optional();
const attributes = z.object({ class: text, filename: text }).passthrough();
const connection = z
  .object({
    id: id.nullable().optional(),
    connectionType: text,
    name: text,
    isPackaged: z.boolean().nullable().optional(),
    connectionAttributes: attributes.nullable().optional(),
  })
  .passthrough();
const dataConnection = z
  .object({
    id: text,
    connectionType: text,
    name: text,
    connectionAttributes: attributes.nullable().optional(),
  })
  .passthrough();
const edge = z.object({ nextNodeId: id, namespace: text, nextNamespace: text }).passthrough();
const binding = z.object({ nodeId: id.nullable().optional(), namespace: text }).passthrough();
const field = z.object({ name: text, dataType: text }).passthrough();
const nodeBase = z
  .object({
    id,
    nodeType: z.string().regex(/^\.v[0-9]+(_[0-9]+)*\.[A-Za-z0-9_]+$/),
    baseType: z.string(),
    name: text,
    description: text,
    serialize: z.boolean().nullable().optional(),
    nextNodes: z.array(edge).nullable().optional(),
    connectionId: text,
    connectionAttributes: attributes.nullable().optional(),
    namespacesToInput: z.record(binding).nullable().optional(),
    namespacesToOutput: z.record(binding).nullable().optional(),
    columnName: text,
    expression: text,
    hyperOutputFile: text,
    tdsOutput: text,
    fields: z
      .union([z.record(field), z.array(field)])
      .nullable()
      .optional(),
  })
  .passthrough();
const graphBase = z
  .object({
    nodes: z.record(id, z.unknown()),
    initialNodes: z.array(id).nullable().optional(),
    connections: z.record(id, connection).nullable().optional(),
    connectionIds: z.array(id).nullable().optional(),
    dataConnections: z.record(dataConnection).nullable().optional(),
    dataConnectionIds: z.array(z.string()).nullable().optional(),
    majorVersion: integer,
    minorVersion: integer,
    documentId: text,
    obfuscatorId: text,
    parameters: z.record(z.unknown()).nullable().optional(),
    extensibility: z.record(z.unknown()).nullable().optional(),
  })
  .passthrough();
const number = z.union([z.number(), z.bigint()]);
const nodeDisplay = z
  .object({
    position: z.object({ x: number, y: number }).passthrough().nullable().optional(),
    size: z.object({ width: number, height: number }).passthrough().nullable().optional(),
  })
  .passthrough();
const documentModel = z
  .object({
    flow: graphBase,
    displaySettings: z
      .object({
        majorVersion: integer,
        minorVersion: integer,
        flowDisplaySettings: z
          .object({
            flowNodeDisplaySettings: z.record(id, nodeDisplay).nullable().optional(),
          })
          .passthrough()
          .nullable()
          .optional(),
      })
      .passthrough(),
    maestroMetadata: z
      .object({
        majorVersion: integer,
        minorVersion: integer,
        flowEntryName: z.literal('flow'),
        displaySettingsEntryName: z.literal('displaySettings'),
        isPackagedMaestroDocument: z.boolean(),
      })
      .passthrough(),
  })
  .passthrough();
const ajv = new Ajv2020({
  strict: false,
  allErrors: true,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
  ownProperties: true,
  messages: false,
  validateFormats: false,
});
const validateDocument = ajv.compile(schemaDocument);
const validateGraph = ajv.compile({ $defs: schemaDocument.$defs, $ref: '#/$defs/flow' });

/** Validation uses a numeric projection; the original arbitrary integers remain untouched. */
function schemaProjection(value: Json): unknown {
  if (typeof value === 'bigint') return Number(value);
  if (Array.isArray(value)) return value.map(schemaProjection);
  if (isObject(value))
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, schemaProjection(v)]));
  return value;
}
export function metadataErrors(document: Obj): string[] {
  const errors: string[] = [];
  const checkModel = (shape: z.ZodTypeAny, value: Json, prefix: string): void => {
    const result = shape.safeParse(value);
    if (!result.success)
      errors.push(...result.error.issues.map((e) => prefix + '.' + e.path.join('.')));
  };
  if (!validateDocument(schemaProjection(document)))
    errors.push(...(validateDocument.errors ?? []).map((e) => e.instancePath || '$'));
  checkModel(documentModel, document, '$');
  const integerVersions = (value: Obj, path: string): void => {
    for (const key of ['majorVersion', 'minorVersion'])
      if (isFloatField(value, key)) errors.push(path + '.' + key);
  };
  if (isObject(document.displaySettings))
    integerVersions(document.displaySettings, 'displaySettings');
  if (isObject(document.maestroMetadata))
    integerVersions(document.maestroMetadata, 'maestroMetadata');
  const visit = (graph: Obj, path: string): void => {
    integerVersions(graph, path);
    if (path !== 'flow' && !validateGraph(schemaProjection(graph)))
      errors.push(...(validateGraph.errors ?? []).map((e) => path + e.instancePath));
    if (path !== 'flow') checkModel(graphBase, graph, path);
    for (const [key, value] of Object.entries(object(graph.nodes))) {
      const node = object(value);
      checkModel(nodeBase, node, path + '.nodes.' + key);
      if (node.loomContainer !== undefined && node.loomContainer !== null)
        visit(object(node.loomContainer), path + '.nodes.' + key + '.loomContainer');
    }
  };
  visit(object(document.flow), 'flow');
  if (errors.length) return errors;
  const connections = object(object(document.flow).connections ?? {}),
    seen = new Set<string>();
  const graphErrors = (graph: Obj, path: string): void => {
    const nodes = object(graph.nodes),
      incoming = new Map(Object.keys(nodes).map((k) => [k, 0]));
    for (const id of (graph.initialNodes ?? []) as string[])
      if (!Object.hasOwn(nodes, id)) errors.push(path + '.initialNodes');
    for (const [key, value] of Object.entries(nodes)) {
      const node = object(value),
        prefix = path + '.nodes.' + key;
      if (seen.has(key.toLowerCase())) errors.push(prefix + '.duplicateId');
      seen.add(key.toLowerCase());
      if (node.id !== key) errors.push(prefix + '.id');
      const connection = node.connectionId;
      if (
        connection &&
        typeof connection === 'string' &&
        !Object.hasOwn(connections, connection) &&
        !(String(node.nodeType).endsWith('.WriteToDataCloud') && !uuid.test(connection))
      )
        errors.push(prefix + '.connectionId');
      for (const item of (node.nextNodes ?? []) as Obj[]) {
        const target = String(item.nextNodeId);
        if (!incoming.has(target)) errors.push(prefix + '.nextNodes');
        else incoming.set(target, incoming.get(target)! + 1);
      }
      if (isObject(node.loomContainer)) {
        graphErrors(node.loomContainer, prefix + '.loomContainer');
        for (const direction of ['namespacesToInput', 'namespacesToOutput'])
          for (const binding of Object.values(object(node[direction] ?? {})))
            if (!Object.hasOwn(object(node.loomContainer.nodes), String(object(binding).nodeId)))
              errors.push(prefix + '.' + direction);
      }
    }
    const queue = [...incoming].filter(([, degree]) => !degree).map(([id]) => id);
    let visited = 0;
    while (queue.length) {
      const current = queue.pop()!;
      visited++;
      for (const item of (object(nodes[current]).nextNodes ?? []) as Obj[]) {
        const target = String(item.nextNodeId);
        if (incoming.has(target)) {
          incoming.set(target, incoming.get(target)! - 1);
          if (!incoming.get(target)) queue.push(target);
        }
      }
    }
    if (visited !== Object.keys(nodes).length) errors.push(path + '.nodes.cycle');
  };
  graphErrors(object(document.flow), 'flow');
  for (const [key, value] of Object.entries(connections))
    if (object(value).id !== undefined && object(value).id !== null && object(value).id !== key)
      errors.push('flow.connections.id');
  const flow = object(document.flow);
  for (const key of (flow.connectionIds ?? []) as string[])
    if (!Object.hasOwn(connections, key)) errors.push('flow.connectionIds');
  for (const key of (flow.dataConnectionIds ?? []) as string[])
    if (!Object.hasOwn(object(flow.dataConnections ?? {}), key))
      errors.push('flow.dataConnectionIds');
  return errors;
}

export function summary(document: Json): {
  hasScriptSteps: boolean;
  hasInputUnion: boolean;
  hasFileInputs: boolean;
} {
  const types = new Set<string>(),
    stack: Json[] = [document];
  let budget = MAX_ITEMS;
  while (stack.length) {
    if (--budget < 0) throw new AuthoringError();
    const value = stack.pop()!;
    if (Array.isArray(value)) stack.push(...value);
    else if (isObject(value)) {
      if (typeof value.nodeType === 'string') types.add(value.nodeType);
      stack.push(...Object.values(value));
    }
  }
  return {
    hasScriptSteps: [...types].some((t) => t.includes('Extensibility') || t.endsWith('.Script')),
    hasInputUnion: [...types].some((t) => t.includes('InputUnion')),
    hasFileInputs: [...types].some((t) => /\.Load(Csv|Excel|Json|Hyper|Statistical)/.test(t)),
  };
}
