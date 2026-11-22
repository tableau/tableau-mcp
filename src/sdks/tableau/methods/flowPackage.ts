import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

import { FlowDocument, flowDocumentSchema } from '../types/flowDocument.js';
import { PrepScriptContext } from '../types/prepScript.js';
import { analyzePrepScript, MAX_PREP_SCRIPT_BYTES } from './prepScriptAnalysis.js';
import { packagedScriptReferences } from './prepScriptBindings.js';

export const MAX_FLOW_FILE_BYTES = 32 * 1024 * 1024;
export const MAX_FLOW_JSON_BYTES = 16 * 1024 * 1024;

export class FlowPackageError extends Error {
  constructor(readonly code: 'INVALID' | 'LIMIT' | 'UNSUPPORTED') {
    super(`Flow package ${code.toLowerCase()}.`);
  }
}

export type FlowPackageDocument = {
  document: FlowDocument;
  source: { kind: 'native-flow-file'; sha256: string; byteLength: number };
  scriptContext?: PrepScriptContext;
};

type Entry = {
  name: string;
  flags: number;
  method: number;
  crc: number;
  size: number;
  compressed: number;
  offset: number;
};
const fail = (code: 'INVALID' | 'LIMIT' | 'UNSUPPORTED'): never => {
  throw new FlowPackageError(code);
};
const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Read a single native member from ZIP32. No files are extracted, no embedded
 * rows are decoded, and no script or external program is executed. */
function nativeJson(
  bytes: Buffer,
  depth: number,
): { json: Buffer; member?: (name: string, limit: number) => Buffer | undefined } {
  if (depth > 2) return fail('LIMIT');
  const prefix = bytes
    .subarray(0, 256)
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .trimStart();
  if (prefix.startsWith('{')) {
    if (bytes.length > MAX_FLOW_JSON_BYTES) return fail('LIMIT');
    return { json: bytes };
  }
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (
      bytes.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + bytes.readUInt16LE(i + 20) === bytes.length
    ) {
      end = i;
      break;
    }
  if (end < 0) return fail('UNSUPPORTED');
  const count = bytes.readUInt16LE(end + 10),
    centralSize = bytes.readUInt32LE(end + 12),
    central = bytes.readUInt32LE(end + 16);
  if (
    bytes.readUInt16LE(end + 4) ||
    bytes.readUInt16LE(end + 6) ||
    bytes.readUInt16LE(end + 8) !== count ||
    count === 0xffff ||
    central === 0xffffffff
  )
    return fail('UNSUPPORTED');
  if (count > 4096) return fail('LIMIT');
  if (central + centralSize !== end) return fail('INVALID');
  const entries: Entry[] = [];
  let position = central;
  for (let index = 0; index < count; index++) {
    if (position + 46 > end || bytes.readUInt32LE(position) !== 0x02014b50) return fail('INVALID');
    const nameLength = bytes.readUInt16LE(position + 28),
      extra = bytes.readUInt16LE(position + 30),
      comment = bytes.readUInt16LE(position + 32);
    const next = position + 46 + nameLength + extra + comment;
    if (next > end || bytes.readUInt16LE(position + 34)) return fail('INVALID');
    entries.push({
      name: bytes.subarray(position + 46, position + 46 + nameLength).toString('utf8'),
      flags: bytes.readUInt16LE(position + 8),
      method: bytes.readUInt16LE(position + 10),
      crc: bytes.readUInt32LE(position + 16),
      compressed: bytes.readUInt32LE(position + 20),
      size: bytes.readUInt32LE(position + 24),
      offset: bytes.readUInt32LE(position + 42),
    });
    position = next;
  }
  if (position !== end) return fail('INVALID');
  const flow = entries.filter((entry) => entry.name === 'flow');
  const nested = entries.filter((entry) => /\.tfl$/i.test(entry.name));
  const candidates = flow.length ? flow : nested;
  if (candidates.length !== 1) return fail('UNSUPPORTED');
  const readEntry = (entry: Entry, limit: number): Buffer => {
    if (entry.flags & 1 || ![0, 8].includes(entry.method)) return fail('UNSUPPORTED');
    if (entry.size > limit || entry.compressed > MAX_FLOW_FILE_BYTES) return fail('LIMIT');
    const local = entry.offset;
    if (local + 30 > central || bytes.readUInt32LE(local) !== 0x04034b50) return fail('INVALID');
    const nameLength = bytes.readUInt16LE(local + 26),
      extra = bytes.readUInt16LE(local + 28);
    const start = local + 30 + nameLength + extra,
      finish = start + entry.compressed;
    if (
      finish > central ||
      start > central ||
      bytes.readUInt16LE(local + 6) !== entry.flags ||
      bytes.readUInt16LE(local + 8) !== entry.method ||
      bytes.subarray(local + 30, local + 30 + nameLength).toString('utf8') !== entry.name
    )
      return fail('INVALID');
    let content: Buffer;
    try {
      const compressed = bytes.subarray(start, finish);
      content =
        entry.method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: limit });
    } catch {
      return fail('INVALID');
    }
    if (content.length !== entry.size || crc32(content) !== entry.crc) return fail('INVALID');
    return content;
  };
  const content = readEntry(candidates[0], MAX_FLOW_JSON_BYTES);
  return flow.length
    ? {
        json: content,
        member: (name, limit) => {
          const selected = entries.filter((entry) => entry.name === name);
          return selected.length === 1 ? readEntry(selected[0], limit) : undefined;
        },
      }
    : nativeJson(content, depth + 1);
}

/** Decode only the native `flow` JSON, retaining a hash of the original file
 * as evidence. Package wrappers are not interpreted as flow documents. */
export function parseFlowPackage(content: Buffer): FlowPackageDocument {
  if (content.length > MAX_FLOW_FILE_BYTES) return fail('LIMIT');
  let document: FlowDocument;
  let native: ReturnType<typeof nativeJson>;
  try {
    native = nativeJson(content, 0);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(native.json);
    const value = JSON.parse(text);
    if (!value?.nodes || typeof value.nodes !== 'object' || Array.isArray(value.nodes))
      return fail('UNSUPPORTED');
    document = flowDocumentSchema.parse(value);
  } catch (error) {
    if (error instanceof FlowPackageError) throw error;
    return fail('INVALID');
  }
  const sha256 = createHash('sha256').update(content).digest('hex');
  const references = packagedScriptReferences(document);
  const scriptContext: PrepScriptContext = { scripts: {}, packageSha256: sha256, unavailable: {} };
  let scriptBytes = 0;
  for (const ref of references) {
    try {
      if (scriptBytes >= 8 * MAX_PREP_SCRIPT_BYTES) {
        Object.defineProperty(scriptContext.unavailable!, ref.nodeId, {
          value: 'limited',
          enumerable: true,
        });
        continue;
      }
      const script = native.member?.(ref.entry, MAX_PREP_SCRIPT_BYTES);
      if (!script) {
        Object.defineProperty(scriptContext.unavailable!, ref.nodeId, {
          value: 'missing',
          enumerable: true,
        });
        continue;
      }
      scriptBytes += script.length;
      if (scriptBytes > 8 * MAX_PREP_SCRIPT_BYTES) {
        Object.defineProperty(scriptContext.unavailable!, ref.nodeId, {
          value: 'limited',
          enumerable: true,
        });
        continue;
      }
      Object.defineProperty(scriptContext.scripts, ref.nodeId, {
        value: analyzePrepScript(script, ref.language),
        enumerable: true,
      });
    } catch (error) {
      Object.defineProperty(scriptContext.unavailable!, ref.nodeId, {
        value: error instanceof FlowPackageError && error.code === 'LIMIT' ? 'limited' : 'invalid',
        enumerable: true,
      });
    }
  }
  return {
    document,
    ...(references.length ? { scriptContext } : {}),
    source: {
      kind: 'native-flow-file',
      sha256,
      byteLength: content.length,
    },
  };
}
