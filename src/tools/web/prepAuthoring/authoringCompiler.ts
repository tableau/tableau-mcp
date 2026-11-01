import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';

import {
  CompactYaml,
  ensureJson,
  isFloatField,
  isObject,
  Json,
  jsonBytes,
  markFloatField,
  Obj,
  object,
  parseJson,
  parseJsonTyped,
} from './compactYaml.js';
import { alias, knownEntries, metadataErrors, SchemaValues, uuid } from './metadata.js';
import { readNativeArchive, writeNativeArchive } from './nativeArchive.js';
import {
  AuthoringError,
  entryName,
  MAX_ENTRIES,
  MAX_FILE,
  MAX_TOTAL,
  ProjectIo,
} from './projectIo.js';

export type PackageType = 'tfl' | 'tflx';
export type CompiledFlow = { document: Obj; files: Map<string, Buffer>; errors: string[] };
const values = new SchemaValues();
function uuid5(name: string, namespace: string): string {
  const bytes = createHash('sha1')
    .update(Buffer.from(namespace.replaceAll('-', ''), 'hex'))
    .update(name, 'utf8')
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 0x50;
  bytes[8] = (bytes[8] & 63) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function setDefault(target: Obj, key: string, value: Json): void {
  if (!Object.hasOwn(target, key)) target[key] = value;
}

export function compileFlowYaml(
  io: ProjectIo,
  project: string,
  text: string,
  format: PackageType,
): CompiledFlow {
  const codec = new CompactYaml(),
    authored = codec.load(text);
  const properties = object(values.definition('authoringProject').properties);
  if (
    authored.format !== object(properties.format).const ||
    typeof authored.namespace !== 'string' ||
    !uuid.test(authored.namespace) ||
    Object.keys(authored).some((key) => !Object.hasOwn(properties, key))
  )
    throw new AuthoringError();
  const namespace = authored.namespace;
  const defaults =
    authored.defaults === undefined ? object(properties.defaults).default : authored.defaults;
  if (typeof defaults !== 'boolean') throw new AuthoringError();
  let remaining = MAX_TOTAL - Buffer.byteLength(text);
  const floatIncludes = new Set<Json>();
  const resource = (name: string): string => io.path(entryName(name), project);
  const include = (name: string): Json => {
    const raw = io.read(resource(name), Math.min(MAX_FILE, Math.max(0, remaining)));
    remaining -= raw.length;
    const parsed = parseJsonTyped(raw);
    if (parsed.float) floatIncludes.add(name);
    return parsed.value;
  };
  const idsRef = authored.ids === undefined ? undefined : codec.reference(authored.ids);
  const ids = object(
    idsRef?.kind === 'include'
      ? include(idsRef.value)
      : authored.ids === undefined
        ? {}
        : authored.ids,
  );
  if (
    Object.entries(ids).some(
      ([key, value]) => !alias.test(key) || typeof value !== 'string' || !uuid.test(value),
    ) ||
    new Set(Object.values(ids)).size !== Object.keys(ids).length
  )
    throw new AuthoringError();
  const claimed = new Map(Object.entries(ids).map(([name, id]) => [String(id), name]));
  const idFor = (name: string): string => {
    if (!alias.test(name)) throw new AuthoringError();
    const id = Object.hasOwn(ids, name) ? String(ids[name]) : uuid5(name, namespace);
    if (claimed.has(id) && claimed.get(id) !== name) throw new AuthoringError();
    claimed.set(id, name);
    return id;
  };
  const expand = (value: Json): Json => {
    const reference = codec.reference(value);
    if (reference?.kind === 'id') return idFor(reference.value);
    if (reference?.kind === 'include') {
      const result = include(reference.value);
      if (floatIncludes.has(reference.value)) floatIncludes.add(value);
      return result;
    }
    if (reference?.kind === 'path') {
      const path = resource(reference.value);
      io.read(path, MAX_TOTAL);
      return path;
    }
    if (Array.isArray(value)) {
      const result = value.map(expand);
      value.forEach((item, i) => {
        if (isFloatField(value, String(i)) || floatIncludes.has(item))
          markFloatField(result, String(i));
      });
      return result;
    }
    if (isObject(value)) {
      const result: Obj = Object.create(null);
      for (const [key, item] of Object.entries(value)) {
        const name = expand(key);
        if (typeof name !== 'string' || Object.hasOwn(result, name)) throw new AuthoringError();
        result[name] = expand(item);
        if (isFloatField(value, key) || floatIncludes.has(item)) markFloatField(result, name);
      }
      return result;
    }
    return value;
  };
  const document: Obj = Object.fromEntries(
    knownEntries
      .filter((key) => Object.hasOwn(authored, key))
      .map((key) => [key, expand(authored[key])]),
  );
  ensureJson(document);
  const flow = object(document.flow);
  const prepare = (graph: Obj): void => {
    const normalized: Obj = Object.create(null);
    for (const [key, value] of Object.entries(object(graph.nodes))) {
      const id = uuid.test(key) ? key : idFor(key),
        node = object(value);
      if (Object.hasOwn(normalized, id)) throw new AuthoringError();
      setDefault(node, 'id', id);
      if (defaults) {
        setDefault(node, 'name', key);
        values.defaults(node, 'commonNode');
        const variant = values.variant(node.nodeType);
        if (variant) values.defaults(node, variant);
        if (Array.isArray(node.nextNodes))
          for (const edge of node.nextNodes) if (isObject(edge)) values.defaults(edge, 'edge');
      }
      if (node.loomContainer !== undefined && node.loomContainer !== null)
        prepare(object(node.loomContainer));
      normalized[id] = node;
    }
    graph.nodes = normalized;
    if (defaults) {
      const targets = new Set(
        Object.values(normalized).flatMap((n) =>
          Array.isArray(object(n).nextNodes)
            ? (object(n).nextNodes as Json[]).filter(isObject).map((e) => e.nextNodeId)
            : [],
        ),
      );
      setDefault(
        graph,
        'initialNodes',
        Object.keys(normalized).filter((key) => !targets.has(key)),
      );
      const template = values.template('flow');
      for (const key of ['majorVersion', 'minorVersion']) setDefault(graph, key, template[key]);
    }
  };
  prepare(flow);
  const connections: Obj = Object.create(null);
  for (const [key, value] of Object.entries(
    object(flow.connections === undefined ? {} : flow.connections),
  )) {
    const id = uuid.test(key) ? key : idFor(key);
    if (Object.hasOwn(connections, id)) throw new AuthoringError();
    connections[id] = object(value);
  }
  if (Object.hasOwn(flow, 'connections')) flow.connections = connections;
  if (defaults) {
    values.defaults(flow, 'flow');
    setDefault(flow, 'connectionIds', Object.keys(connections));
    for (const key of ['documentId', 'obfuscatorId']) {
      const strategy = object(object(values.definition('flow').properties)[key])[
        'x-authoring-generated'
      ];
      if (typeof strategy !== 'string' || !strategy.startsWith('uuid5:'))
        throw new AuthoringError();
      setDefault(flow, key, uuid5(strategy.slice(6), namespace));
    }
  }
  if (!Object.hasOwn(document, 'displaySettings')) {
    const display = values.template('displaySettings');
    const spacing = Number(values.definition('nodeDisplaySettings')['x-authoring-node-spacing']);
    const nodes = object(object(display.flowDisplaySettings).flowNodeDisplaySettings);
    Object.keys(object(flow.nodes)).forEach((key, index) => {
      const node = values.template('nodeDisplaySettings'),
        position = object(node.position);
      position.x = Number(position.x) + index * spacing;
      nodes[key] = node;
    });
    document.displaySettings = display;
  }
  setDefault(document, 'maestroMetadata', values.template('maestroMetadata'));
  const manifest = object(document.maestroMetadata);
  for (const key of ['flowEntryName', 'displaySettingsEntryName']) {
    const expected = object(object(values.definition('maestroMetadata').properties)[key]).const;
    if (Object.hasOwn(manifest, key) && manifest[key] !== expected) throw new AuthoringError();
    setDefault(manifest, key, expected);
  }
  manifest.isPackagedMaestroDocument = format === 'tflx';
  const records = expand(authored.files === undefined ? [] : authored.files),
    files = new Map<string, Buffer>();
  if (!Array.isArray(records) || records.length > MAX_ENTRIES - 3) throw new AuthoringError();
  const occupied = new Set<string>(knownEntries.map((name) => name.toUpperCase().toLowerCase()));
  let total = Object.values(document).reduce(
    (size: number, value) => size + jsonBytes(value).length,
    0,
  );
  for (const record of records) {
    const item = object(record);
    if (Object.keys(item).sort().join(',') !== 'entry,source') throw new AuthoringError();
    let name = item.entry;
    if (Array.isArray(name) && name.every((v) => typeof v === 'string')) name = name.join('/');
    if (typeof name !== 'string' || typeof item.source !== 'string') throw new AuthoringError();
    entryName(name);
    const key = name.toUpperCase().toLowerCase();
    if (occupied.has(key) || (format === 'tfl' && name.split('/')[0].toLowerCase() === 'data'))
      throw new AuthoringError();
    occupied.add(key);
    const data = io.read(resource(item.source), MAX_TOTAL - total);
    files.set(name, data);
    total += data.length;
  }
  if (total > MAX_TOTAL) throw new AuthoringError();
  return { document, files, errors: metadataErrors(document) };
}

function writeProject(
  io: ProjectIo,
  project: string,
  codec: CompactYaml,
  authored: Obj,
  resources: Map<string, Buffer>,
): void {
  const text = codec.dump(authored);
  if (io.exists(join(project, 'project.yml')) || io.exists(join(project, 'project.resources')))
    throw new AuthoringError();
  io.mkdir(join(project, 'project.resources'), true);
  for (const [name, data] of resources)
    io.write(io.path(name, join(project, 'project.resources')), data);
  io.write(join(project, 'project.yml'), text);
}
export function exportFlowYaml(
  io: ProjectIo,
  project: string,
  entries: Map<string, Buffer>,
  externalizeBytes = 1024,
): void {
  if (externalizeBytes < 1) throw new AuthoringError();
  const document: Obj = {};
  for (const name of knownEntries) {
    const raw = entries.get(name);
    if (raw) document[name] = parseJson(raw);
  }
  if (!Object.hasOwn(document, 'flow')) throw new AuthoringError();
  const codec = new CompactYaml(),
    resources = new Map<string, Buffer>(),
    ids: Obj = {},
    labels = new Map<string, string>();
  const shorten = (value: Json, key?: string): Json => {
    if (typeof value === 'string' && uuid.test(value)) {
      if (!labels.has(value)) {
        const label = 'n' + (labels.size + 1);
        labels.set(value, label);
        ids[label] = value;
      }
      return codec.ref('id', labels.get(value)!);
    }
    if (
      key === 'values' &&
      (isObject(value) || Array.isArray(value)) &&
      jsonBytes(value).length >= externalizeBytes
    ) {
      const name = 'values-' + (resources.size + 1) + '.json';
      resources.set(name, jsonBytes(value));
      return codec.ref('include', 'project.resources/' + name);
    }
    if (Array.isArray(value)) {
      const result = value.map((v) => shorten(v));
      value.forEach((_, i) => {
        if (isFloatField(value, String(i))) markFloatField(result, String(i));
      });
      return result;
    }
    if (isObject(value)) {
      const result: Obj = Object.create(null);
      for (const [name, v] of Object.entries(value)) {
        const key = String(shorten(name));
        result[key] = shorten(v, name);
        if (isFloatField(value, name)) markFloatField(result, key);
      }
      return result;
    }
    return value;
  };
  const authored: Obj = {
    ...values.template('authoringProject'),
    namespace: randomUUID(),
    defaults: false,
    ids: codec.ref('include', 'project.resources/ids.json'),
    flow: shorten(document.flow),
  };
  resources.set('ids.json', jsonBytes(ids));
  for (const name of ['displaySettings', 'maestroMetadata']) {
    if (!Object.hasOwn(document, name)) continue;
    resources.set(name + '.json', jsonBytes(document[name]));
    authored[name] = codec.ref('include', 'project.resources/' + name + '.json');
  }
  authored.files = [];
  for (const [entry, data] of [...entries]
    .filter(([name]) => !(knownEntries as readonly string[]).includes(name))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const name = 'attachment-' + (authored.files.length + 1) + '.bin';
    resources.set(name, data);
    authored.files.push({ entry, source: 'project.resources/' + name });
  }
  writeProject(io, project, codec, authored, resources);
}
export function newFlowYaml(io: ProjectIo, project: string, format: PackageType): void {
  const codec = new CompactYaml(),
    packaged = format === 'tflx';
  const csv = values.template('nodeVariants/loadCsv');
  const authored: Obj = {
    ...values.template('authoringProject'),
    namespace: randomUUID(),
    flow: {
      nodes: {
        input: {
          ...csv,
          name: 'Sales',
          connectionId: codec.ref('id', 'csv'),
          connectionAttributes: {},
          fields: [
            { name: 'Region', type: 'string', collation: null },
            { name: 'Sales', type: 'real', collation: null },
          ],
          nextNodes: [{ ...values.template('edge'), nextNodeId: codec.ref('id', 'calculate') }],
        },
        calculate: {
          ...values.template('nodeVariants/addColumn'),
          name: 'Tax included',
          columnName: 'SalesWithTax',
          expression: '[Sales] * 1.1',
          nextNodes: [{ ...values.template('edge'), nextNodeId: codec.ref('id', 'output') }],
        },
        output: {
          ...values.template('nodeVariants/writeToHyper'),
          name: 'Result',
          hyperOutputFile: 'sales-output.hyper',
          tdsOutput: 'sales-output.tds',
        },
      },
      connections: {
        csv: {
          ...values.template('authoringCsvConnection'),
          id: codec.ref('id', 'csv'),
          name: 'sales.csv',
          isPackaged: packaged,
          connectionAttributes: {
            ...object(values.template('authoringCsvConnection').connectionAttributes),
            filename: packaged ? 'sales.csv' : codec.ref('path', 'project.resources/sales.csv'),
          },
        },
      },
    },
    files: packaged
      ? [
          {
            entry: ['Data', codec.ref('id', 'csv'), 'sales.csv'],
            source: 'project.resources/sales.csv',
          },
        ]
      : [],
  };
  const separator = csv.separator === '\\t' ? '\t' : csv.separator;
  if (
    typeof separator !== 'string' ||
    separator.length !== 1 ||
    !/^utf-?8$/i.test(String(csv.charSet))
  )
    throw new AuthoringError();
  const rows = [
    ...(csv.containsHeaders ? [['Region', 'Sales']] : []),
    ['East', '100'],
    ['West', '200'],
  ];
  const bytes = Buffer.from(rows.map((row) => row.join(separator)).join('\n') + '\n');
  writeProject(io, project, codec, authored, new Map([['sales.csv', bytes]]));
}
export function buildFlowPackage(compiled: CompiledFlow): Buffer {
  if (compiled.errors.length) throw new AuthoringError();
  const expected = new Map([
    ...compiled.files,
    ...Object.entries(compiled.document).map(
      ([name, value]) => [name, jsonBytes(value)] as [string, Buffer],
    ),
  ]);
  const bytes = writeNativeArchive(expected),
    actual = readNativeArchive(bytes);
  for (const [name, value] of Object.entries(compiled.document))
    if (!jsonBytes(parseJson(actual.get(name)!)).equals(jsonBytes(value)))
      throw new AuthoringError('SOURCE_CHANGED');
  return bytes;
}
