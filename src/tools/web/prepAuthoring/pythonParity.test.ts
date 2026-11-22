import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildFlowPackage, compileFlowYaml } from './authoringCompiler.js';
import {
  CompactYaml,
  ensureJson,
  isFloatField,
  isObject,
  Json,
  jsonBytes,
  object,
  parseJson,
} from './compactYaml.js';
import {
  connectionScopeHasCredentials,
  containsInlineCredential,
  credentialKind,
} from './credentialPolicy.js';
import { SchemaValues } from './metadata.js';
import { readNativeArchive } from './nativeArchive.js';
import { digest, ProjectIo } from './projectIo.js';
import { loadReferenceFixtures } from './referenceFixtures.js';

const fixture = loadReferenceFixtures();
const manifest = fixture.manifest;
function canonical(value: Json): string {
  if (typeof value === 'number' || typeof value === 'bigint') {
    const raw = String(value),
      match = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(raw)!;
    let digits = (match[2] + (match[3] ?? '')).replace(/^0+/, ''),
      exponent = Number(match[4] ?? 0) - (match[3]?.length ?? 0);
    if (!digits) return 'n0';
    while (digits.endsWith('0')) {
      digits = digits.slice(0, -1);
      exponent++;
    }
    return 'n' + (match[1] === '-' ? '-' : '') + digits + 'e' + exponent;
  }
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (isObject(value))
    return (
      '{' +
      Object.keys(value)
        .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
        .map((key) => JSON.stringify(key) + ':' + canonical(value[key]))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
function typeRecords(value: Json, path = '$', parent?: Json, key = ''): Json[] {
  const kind = Array.isArray(value)
    ? 'array'
    : isObject(value)
      ? 'object'
      : value === null
        ? 'null'
        : typeof value === 'boolean'
          ? 'bool'
          : typeof value === 'bigint'
            ? 'int'
            : typeof value === 'number'
              ? isFloatField(parent, key) || !Number.isInteger(value)
                ? 'float'
                : 'int'
              : 'str';
  const result: Json[] = [[path, kind]];
  if (Array.isArray(value))
    value.forEach((item, index) =>
      result.push(...typeRecords(item, path + '/' + index, value, String(index))),
    );
  else if (isObject(value))
    for (const name of Object.keys(value).sort((a, b) =>
      Buffer.compare(Buffer.from(a), Buffer.from(b)),
    ))
      result.push(
        ...typeRecords(
          value[name],
          path + '/' + name.replaceAll('~', '~0').replaceAll('/', '~1'),
          value,
          name,
        ),
      );
  return result;
}
describe('reference Python to Node differential parity', () => {
  afterAll(() => fixture.cleanup());
  const output = join(manifest.root, 'node-results-' + randomUUID());
  if (output) mkdirSync(output);
  writeFileSync(
    join(output, 'verification-plan.json'),
    JSON.stringify(
      manifest.cases.map((item) => ({
        ...item,
        yaml: undefined,
        yamlText: undefined,
        resources: undefined,
      })),
    ),
  );
  it.each(manifest.cases)(
    'matches full serialized metadata, attachments and validity: $id',
    (item) => {
      const io = new ProjectIo(item.project),
        text = readFileSync(item.yaml, 'utf8');
      let compiled: ReturnType<typeof compileFlowYaml>;
      try {
        compiled = compileFlowYaml(io, item.project, text, item.format);
      } catch (error) {
        if (item.valid) throw error;
        return;
      }
      expect(!compiled.errors.length).toBe(item.valid);
      if (item.valid) {
        const normalized = object(parseJson(jsonBytes(compiled.document)));
        for (const field of item.pathFields ?? []) {
          let parent: Json = normalized;
          for (const part of field.path.slice(0, -1))
            parent = Array.isArray(parent) ? parent[Number(part)] : object(parent)[String(part)];
          const key = field.path[field.path.length - 1];
          const actual = Array.isArray(parent) ? parent[Number(key)] : object(parent)[String(key)];
          expect(actual).toBe(join(item.project, ...field.relative.split('/')));
          if (Array.isArray(parent)) parent[Number(key)] = '@PROJECT@/' + field.relative;
          else object(parent)[String(key)] = '@PROJECT@/' + field.relative;
        }
        expect(digest(canonical(normalized))).toBe(item.metadataSha256);
        const paths = typeRecords(compiled.document);
        expect(paths.length).toBe(item.jsonPathCount);
        expect(digest(canonical(paths))).toBe(item.metadataTypesSha256);
        expect(
          Object.fromEntries([...compiled.files].map(([name, bytes]) => [name, digest(bytes)])),
        ).toEqual(item.attachmentHashes);
        writeFileSync(join(output!, item.id + '.' + item.format), buildFlowPackage(compiled), {
          flag: 'wx',
        });
      }
    },
  );
  it.each(manifest.zipFixtures)(
    'reads bounded Python-created ZIP64 store/deflate metadata: $path',
    (item) => {
      const entries = readNativeArchive(readFileSync(item.path));
      expect(
        Object.fromEntries([...entries].map(([name, bytes]) => [name, digest(bytes)])),
      ).toEqual(item.hashes);
    },
  );
  it.each(manifest.scalarCases)('matches reference scalar value and type: $id', (item) => {
    let value: ReturnType<CompactYaml['load']>;
    try {
      value = new CompactYaml().load(item.yamlText);
      ensureJson(value);
      jsonBytes(value);
    } catch (error) {
      if (item.valid) throw error;
      return;
    }
    expect(item.valid).toBe(true);
    expect(digest(canonical(value))).toBe(item.valueSha256);
    expect(digest(canonical(typeRecords(value)))).toBe(item.typesSha256);
  });
  it.each(manifest.credentialCases)('matches credential classifier %s', (name, expected) => {
    expect(credentialKind(name)).toBe(expected);
  });
  it.each(manifest.scopeCases)(
    'matches recursive credential-container behavior %j',
    (value, expected) => {
      expect(connectionScopeHasCredentials(value)).toBe(expected);
    },
  );
  it.each(manifest.inlineCases)('matches inline authentication policy %s', (value, expected) => {
    expect(containsInlineCredential(value)).toBe(expected);
  });
  it.each(manifest.schemaCases)(
    'matches schema value/provenance description %s',
    (name, expected) => {
      expect(digest(canonical(new SchemaValues().describe(name ?? undefined)))).toBe(expected);
    },
  );
  it.each(manifest.templateCases)(
    'matches all declared defaults/constants for %s',
    (name, expected) => {
      expect(digest(canonical(new SchemaValues().template(name)))).toBe(expected);
    },
  );
});
