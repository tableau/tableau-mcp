import { cpSync, mkdtempSync, readdirSync, rmSync } from 'fs';
import { mkdir, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildTemplateZip, copyFileAtomically, TEMPLATE_ZIP_FILENAME } from './buildTemplateZip.js';

const EOCD_SIGNATURE = 0x06054b50;

describe('buildTemplateZip', () => {
  const originalCwd = process.cwd();
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tmcp-zip-'));
    cpSync(
      resolve(originalCwd, 'src/templates/Data App Name'),
      join(tmp, 'src/templates/Data App Name'),
      { recursive: true },
    );
    process.chdir(tmp);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.useRealTimers();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('never exposes a missing or partial zip to concurrent readers', async () => {
    const zipPath = await buildTemplateZip();
    const finalSize = (await readFile(zipPath)).length;

    let building = true;
    const failures: string[] = [];
    const reader = (async () => {
      while (building) {
        try {
          const buf = await readFile(zipPath);
          if (buf.length !== finalSize || buf.readUInt32LE(buf.length - 22) !== EOCD_SIGNATURE) {
            failures.push(`partial zip: ${buf.length} bytes`);
          }
        } catch (e) {
          failures.push(String(e));
        }
      }
    })();

    await Promise.all(Array.from({ length: 8 }, () => buildTemplateZip())).finally(() => {
      building = false;
    });
    await reader;

    expect(failures).toEqual([]);
  });

  it('produces identical bytes for the same template tree at different times', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const zipPath = await buildTemplateZip();
    const first = await readFile(zipPath);

    vi.setSystemTime(new Date('2026-01-01T00:00:05Z'));
    await buildTemplateZip();
    const second = await readFile(zipPath);

    expect(second.equals(first)).toBe(true);
  });

  it('leaves no temp files in the templates dir', async () => {
    await buildTemplateZip();
    expect(readdirSync(join(tmp, 'src/templates')).sort()).toEqual([
      'Data App Name',
      TEMPLATE_ZIP_FILENAME,
    ]);
  });

  it('rejects and leaves no temp files when the template tree is missing', async () => {
    rmSync(join(tmp, 'src/templates/Data App Name'), { recursive: true });
    for (let i = 0; i < 10; i++) {
      await expect(buildTemplateZip()).rejects.toThrow();
    }
    await new Promise((r) => setTimeout(r, 100));
    expect(readdirSync(join(tmp, 'src/templates'))).toEqual([]);
  });

  it('copyFileAtomically copies the file and leaves no temp files', async () => {
    const src = await buildTemplateZip();
    const destDir = join(tmp, 'dest');
    const dest = join(destDir, TEMPLATE_ZIP_FILENAME);
    await mkdir(destDir);
    await copyFileAtomically(src, dest);

    expect((await readFile(dest)).equals(await readFile(src))).toBe(true);
    expect(readdirSync(destDir)).toEqual([TEMPLATE_ZIP_FILENAME]);
  });
});
