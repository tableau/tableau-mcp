import { createHash } from 'node:crypto';

import {
  FlowPackageError,
  MAX_FLOW_FILE_BYTES,
  MAX_FLOW_JSON_BYTES,
  parseFlowPackage,
} from './flowPackage.js';
import fixtures from './flowPackage.test.fixtures.json';

// ZIP bytes were generated independently with Python's standard zipfile module.
const bytes = (name: keyof typeof fixtures): Buffer => Buffer.from(fixtures[name], 'base64');
const central = (content: Buffer): number => content.readUInt32LE(content.length - 6);

describe('native flow package reader', () => {
  it.each(['stored', 'deflated', 'nested'] as const)(
    'reads %s native JSON and preserves saved formulas without decoding embedded rows',
    (name) => {
      const content = bytes(name);
      const result = parseFlowPackage(content);
      expect(result.document.nodes?.calc.expression).toBe('[Amount] * 1.1');
      expect(result.source).toEqual({
        kind: 'native-flow-file',
        sha256: createHash('sha256').update(content).digest('hex'),
        byteLength: content.length,
      });
      expect(JSON.stringify(result)).not.toContain('ROW_SECRET');
    },
  );

  it('accepts native JSON but never unwraps an arbitrary package envelope', () => {
    expect(parseFlowPackage(Buffer.from('{"nodes":{}}')).document.nodes).toEqual({});
    expect(() => parseFlowPackage(Buffer.from('{"flow":{"nodes":{}}}'))).toThrow(FlowPackageError);
  });

  it.each(['ambiguous'] as const)(
    'rejects %s native documents instead of choosing the first member',
    (name) => {
      expect(() => parseFlowPackage(bytes(name))).toThrow(FlowPackageError);
    },
  );

  it.each([
    'crc',
    'local-name',
    'offset',
    'encrypted',
    'compression',
    'zip64',
    'disk',
    'oversize',
  ] as const)('rejects a ZIP with invalid/unsupported %s metadata', (mutation) => {
    const content = bytes('stored'),
      cd = central(content),
      end = content.length - 22;
    if (mutation === 'crc') content.writeUInt32LE(0, cd + 16);
    if (mutation === 'local-name') content[30] ^= 1;
    if (mutation === 'offset') content.writeUInt32LE(cd, cd + 42);
    if (mutation === 'encrypted') content.writeUInt16LE(1, cd + 8);
    if (mutation === 'compression') content.writeUInt16LE(99, cd + 10);
    if (mutation === 'zip64') content.writeUInt16LE(0xffff, end + 10);
    if (mutation === 'disk') content.writeUInt16LE(1, end + 4);
    if (mutation === 'oversize') content.writeUInt32LE(MAX_FLOW_JSON_BYTES + 1, cd + 24);
    expect(() => parseFlowPackage(content)).toThrow(FlowPackageError);
  });

  it('rejects truncated, invalid UTF-8, malformed JSON and oversized responses', () => {
    for (const content of [
      Buffer.from('PK'),
      Buffer.from('{"nodes":'),
      Buffer.from([123, 255, 125]),
      bytes('deflated').subarray(0, 50),
      Buffer.alloc(MAX_FLOW_FILE_BYTES + 1),
    ]) {
      expect(() => parseFlowPackage(content)).toThrow(FlowPackageError);
    }
  });

  it('bounds nested package recursion', () => {
    expect(() => parseFlowPackage(bytes('deep'))).toThrow('Flow package limit.');
  });
});
