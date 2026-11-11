import { createHash } from 'crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { ensureNodeDist, type NodeDistOptions } from './seaNodeDist.js';

describe('ensureNodeDist', () => {
  const root = mkdtempSync(join(tmpdir(), 'sea-dist-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const bytes = Buffer.from('archive bytes');
  const digest = createHash('sha256').update(bytes).digest('hex');
  const distName = 'node-v1.0.0-linux-x64';
  const archiveFileName = `${distName}.tar.gz`;

  function options(
    dir: string,
    freshDirs = new Set<string>(),
  ): {
    extract: ReturnType<typeof vi.fn>;
    download: ReturnType<typeof vi.fn>;
    opts: NodeDistOptions;
  } {
    const extract = vi.fn((_archive: string, intoDir: string) => {
      mkdirSync(join(intoDir, distName, 'bin'), { recursive: true });
      writeFileSync(join(intoDir, distName, 'bin', 'node'), 'fresh');
    });
    const download = vi.fn(async (destination: string) => writeFileSync(destination, bytes));
    return {
      extract,
      download,
      opts: {
        archivePath: join(dir, archiveFileName),
        archiveFileName,
        distDir: join(dir, distName),
        distName,
        shasums: async () => `${digest}  ${archiveFileName}\n`,
        download,
        extract,
        freshDirs,
      },
    };
  }

  it('replaces a partial dist dir left by an earlier run, once per run', async () => {
    const dir = mkdtempSync(join(root, 'a-'));
    mkdirSync(join(dir, distName), { recursive: true });
    writeFileSync(join(dir, distName, 'partial'), 'half');
    writeFileSync(join(dir, archiveFileName), bytes);
    const freshDirs = new Set<string>();
    const { opts, extract } = options(dir, freshDirs);

    await ensureNodeDist(opts);

    expect(existsSync(join(dir, distName, 'partial'))).toBe(false);
    expect(readFileSync(join(dir, distName, 'bin', 'node'), 'utf8')).toBe('fresh');
    await ensureNodeDist(opts);
    expect(extract).toHaveBeenCalledTimes(1);
  });

  it('downloads to a .part file and never leaves a bad download at the final path', async () => {
    const dir = mkdtempSync(join(root, 'b-'));
    const { opts, download } = options(dir);
    opts.shasums = async () => `${'a'.repeat(64)}  ${archiveFileName}\n`;

    await expect(ensureNodeDist(opts)).rejects.toThrow(/SHA-256 mismatch/);

    expect(download).toHaveBeenCalledWith(join(dir, `${archiveFileName}.part`));
    expect(existsSync(join(dir, archiveFileName))).toBe(false);
  });
});
