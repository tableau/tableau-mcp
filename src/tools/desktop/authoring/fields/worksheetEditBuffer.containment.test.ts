import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { DesktopCache } from '../../../../desktop/cache.js';
import { getStickyWorksheetFile, setStickyWorksheetFile } from './worksheetEditBuffer.js';

const state = vi.hoisted(() => ({ cacheDir: '', log: vi.fn() }));

vi.mock('../../../../logging/logger.js', () => ({ log: state.log }));

vi.mock('../../../../desktop/cache.js', () => ({
  DesktopCache: class {
    getCacheFilePath({ prefix, id }: { prefix: string; id?: string }): string {
      return join(state.cacheDir, `${prefix}-${id ?? 'default'}.xml`);
    }
  },
}));

describe.skipIf(process.platform === 'win32')('worksheet edit buffer pointer write', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'edit-buffer-'));
    state.cacheDir = join(root, 'cache');
    mkdirSync(state.cacheDir);
    state.log.mockClear();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('refuses a symlink planted at the pointer path and leaves the target untouched', () => {
    const victim = join(root, 'victim.txt');
    writeFileSync(victim, 'precious');
    const pointerFile = new DesktopCache().getCacheFilePath({
      prefix: 'worksheet-edit-buffer',
      id: 'sheet_1-12345',
      extension: 'json',
    });
    symlinkSync(victim, pointerFile);

    expect(() =>
      setStickyWorksheetFile({
        session: '12345',
        worksheetId: 'sheet-1',
        file: join(state.cacheDir, 'worksheet.xml'),
      }),
    ).not.toThrow();
    expect(readFileSync(victim, 'utf-8')).toBe('precious');
  });

  it('refuses a symlink planted at the pointer path on read and logs none of its content', () => {
    const secret = join(root, 'secret.txt');
    writeFileSync(secret, 'TOPSECRET-CONTENT');
    const pointerFile = new DesktopCache().getCacheFilePath({
      prefix: 'worksheet-edit-buffer',
      id: 'sheet_1-777',
      extension: 'json',
    });
    symlinkSync(secret, pointerFile);

    expect(getStickyWorksheetFile({ session: '777', worksheetId: 'sheet-1' })).toBeUndefined();
    expect(JSON.stringify(state.log.mock.calls)).not.toContain('TOPSECRET');
  });
});
