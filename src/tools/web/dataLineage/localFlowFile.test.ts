import { mkdtempSync, readFileSync, realpathSync, rmSync, Stats, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';

import { MAX_FLOW_FILE_BYTES } from '../../../sdks/tableau/methods/flowPackage.js';
import fixtures from '../../../sdks/tableau/methods/flowPackage.test.fixtures.json';
import { FileSystem, NODE_FILE_SYSTEM } from '../../../utils/fileSystem.js';
import { LocalFlowAccessError, readLocalFlowFile } from './localFlowFile.js';

describe('local flow access boundary', () => {
  let root: string;
  let path: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'tableau-lineage-')));
    path = join(root, 'input.tfl');
    writeFileSync(path, '{"nodes":{}}');
  });
  afterEach(() => {
    const rel = relative(realpathSync(tmpdir()), root);
    if (!rel.startsWith('tableau-lineage-') || rel.includes(sep))
      throw new Error('Unexpected temporary directory.');
    rmSync(root, { recursive: true });
  });
  const config = (): { transport: string; localFlowRoots: string[] } => ({
    transport: 'stdio',
    localFlowRoots: [root],
  });

  it.each(['http', 'sse', 'streamable-http'])(
    'rejects %s before any filesystem access',
    (transport) => {
      const realpath = vi.fn();
      expect(() =>
        readLocalFlowFile(path, { ...config(), transport }, { realpath } as unknown as FileSystem),
      ).toThrow(LocalFlowAccessError);
      expect(realpath).not.toHaveBeenCalled();
    },
  );

  it('requires opt-in roots, absolute local paths and the native extension', () => {
    const realpath = vi.fn();
    const fs = { realpath } as unknown as FileSystem;
    for (const [target, roots] of [
      [path, []],
      ['input.tfl', [root]],
      [join(root, 'private.json'), [root]],
      [join(root, '..', 'outside.tfl'), [root]],
      [root + '-sibling/flow.tfl', [root]],
      ['\\\\server\\share\\input.tfl', [root]],
      ['//server/share/input.tfl', [root]],
    ] as Array<[string, string[]]>) {
      expect(() =>
        readLocalFlowFile(target, { transport: 'stdio', localFlowRoots: roots }, fs),
      ).toThrow(LocalFlowAccessError);
    }
    expect(realpath).not.toHaveBeenCalled();
  });

  it('reads real TFL and packaged TFLX bytes without returning row data or absolute paths', () => {
    const native = readLocalFlowFile(path, config());
    expect(native.document.nodes).toEqual({});
    const packed = join(root, 'input.tflx');
    writeFileSync(packed, Buffer.from(fixtures.nested, 'base64'));
    const result = readLocalFlowFile(packed, config());
    expect(result.document.nodes?.calc.expression).toBe('[Amount] * 1.1');
    expect(result.source.byteLength).toBe(readFileSync(packed).length);
    expect(result.name).toBe('input.tflx');
    expect(JSON.stringify(result)).not.toContain('ROW_SECRET');
    expect(JSON.stringify(result.source)).not.toContain(root);
  });

  it('rejects canonical parent escapes even when the lexical path is inside a root', () => {
    const fs = {
      ...NODE_FILE_SYSTEM,
      realpath: (target: string) =>
        target === path ? resolve(root, '..', 'private.tfl') : NODE_FILE_SYSTEM.realpath(target),
    };
    expect(() => readLocalFlowFile(path, config(), fs)).toThrow(LocalFlowAccessError);
  });

  it.each(['symlink', 'hardlink', 'directory', 'oversize', 'empty'])(
    'rejects %s files before opening',
    (kind) => {
      const original = NODE_FILE_SYSTEM.lstat(path);
      const lstat = (): Stats => ({
        ...original,
        isFile: () => kind !== 'directory',
        isSymbolicLink: () => kind === 'symlink',
        nlink: kind === 'hardlink' ? 2 : 1,
        size: kind === 'oversize' ? MAX_FLOW_FILE_BYTES + 1 : kind === 'empty' ? 0 : original.size,
      });
      const open = vi.fn();
      expect(() => readLocalFlowFile(path, config(), { ...NODE_FILE_SYSTEM, lstat, open })).toThrow(
        LocalFlowAccessError,
      );
      expect(open).not.toHaveBeenCalled();
    },
  );

  it.each(['before-open', 'during-read', 'after-read'])(
    'rejects a file replaced %s and closes its handle',
    (when) => {
      const original = NODE_FILE_SYSTEM.lstat(path);
      let calls = 0;
      const fstat = vi.fn(() => {
        calls++;
        return when === 'before-open' || (when === 'during-read' && calls > 1)
          ? { ...original, mtimeMs: original.mtimeMs + 10 }
          : original;
      });
      const close = vi.fn(NODE_FILE_SYSTEM.close);
      const fs = {
        ...NODE_FILE_SYSTEM,
        fstat,
        close,
        stat: (target: string) =>
          when === 'after-read' && target === path
            ? { ...original, mtimeMs: original.mtimeMs + 1 }
            : NODE_FILE_SYSTEM.stat(target),
      };
      expect(() => readLocalFlowFile(path, config(), fs)).toThrow(LocalFlowAccessError);
      expect(close).toHaveBeenCalledOnce();
    },
  );

  it('masks raw parser, filesystem and close error details', () => {
    writeFileSync(path, 'PRIVATE_INVALID_JSON');
    expect(() => readLocalFlowFile(path, config())).toThrow(
      /^The local flow source could not be read within the configured access boundary\.$/,
    );
    const close = (fd: number): void => {
      NODE_FILE_SYSTEM.close(fd);
      throw new Error('PRIVATE_PATH');
    };
    writeFileSync(path, '{"nodes":{}}');
    expect(() => readLocalFlowFile(path, config(), { ...NODE_FILE_SYSTEM, close })).toThrow(
      LocalFlowAccessError,
    );
  });
});
