import { Err, Ok } from 'ts-results-es';

import * as cachePathModule from '../../../../desktop/cachePath.js';
import * as cacheFingerprintModule from '../../../../desktop/wrappers/cacheFingerprint.js';
import { CacheFileOutsideCacheError } from '../../../../errors/mcpToolError.desktop.js';
import {
  clearStickyWorksheetFile,
  getStickyWorksheetFile,
  setStickyWorksheetFile,
} from './worksheetEditBuffer.js';

vi.mock('../../../../desktop/wrappers/cacheFingerprint.js');
vi.mock('../../../../desktop/cachePath.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../desktop/cachePath.js')>()),
  checkCacheFileArg: vi.fn(),
  readContainedCacheTextFile: vi.fn(),
  writeCacheTextFile: vi.fn(),
}));
vi.mock('fs');

const SESSION = '12345';
const WORKSHEET_ID = 'sheet-1-uuid';
const TARGET_FILE = '/cache/worksheet-Sheet_1-abc123.xml';

describe('worksheetEditBuffer', () => {
  // In-memory stand-in for the fs mock so pointer read/write/unlink round-trip like a
  // real filesystem within one test.
  let files: Map<string, string>;
  let symlinks: Set<string>;

  beforeEach(async () => {
    vi.clearAllMocks();
    files = new Map();
    symlinks = new Set();
    vi.mocked(cachePathModule.checkCacheFileArg).mockImplementation((argName, raw) =>
      raw.startsWith('/cache/') && files.has(raw) && !symlinks.has(raw)
        ? Ok(raw)
        : Err(new CacheFileOutsideCacheError(argName)),
    );
    const fs = await import('fs');
    vi.mocked(fs.existsSync).mockImplementation((path) => files.has(String(path)));
    vi.mocked(fs.readFileSync).mockImplementation((path) => {
      const content = files.get(String(path));
      if (content === undefined) {
        throw new Error(`ENOENT: ${String(path)}`);
      }
      return content;
    });
    vi.mocked(cachePathModule.readContainedCacheTextFile).mockImplementation((path) => {
      const text = files.get(String(path));
      return text === undefined
        ? { ok: false, issue: 'missing' }
        : { ok: true, path: String(path), text };
    });
    vi.mocked(cachePathModule.writeCacheTextFile).mockImplementation((path, data) => {
      files.set(String(path), String(data));
    });
    vi.mocked(fs.unlinkSync).mockImplementation((path) => {
      files.delete(String(path));
    });
    vi.mocked(cacheFingerprintModule.checkSidecar).mockReturnValue({ ok: true });
  });

  it('returns undefined when no sticky buffer has been opened for this sheet+session', () => {
    expect(getStickyWorksheetFile({ session: SESSION, worksheetId: WORKSHEET_ID })).toBe(undefined);
  });

  it('round-trips: set then get returns the same file', () => {
    files.set(TARGET_FILE, '<worksheet/>');

    setStickyWorksheetFile({ session: SESSION, worksheetId: WORKSHEET_ID, file: TARGET_FILE });

    expect(getStickyWorksheetFile({ session: SESSION, worksheetId: WORKSHEET_ID })).toBe(
      TARGET_FILE,
    );
  });

  it('ignores a pointer whose file is outside the cache directory', () => {
    files.set('/etc/outside.xml', '<worksheet/>');
    setStickyWorksheetFile({
      session: SESSION,
      worksheetId: WORKSHEET_ID,
      file: '/etc/outside.xml',
    });

    expect(getStickyWorksheetFile({ session: SESSION, worksheetId: WORKSHEET_ID })).toBeUndefined();
  });

  it('ignores a pointer whose file was replaced by a symlink, so the caller mints a fresh file', () => {
    files.set(TARGET_FILE, '<worksheet/>');
    setStickyWorksheetFile({ session: SESSION, worksheetId: WORKSHEET_ID, file: TARGET_FILE });
    symlinks.add(TARGET_FILE);

    expect(getStickyWorksheetFile({ session: SESSION, worksheetId: WORKSHEET_ID })).toBeUndefined();
  });

  it('keys the pointer by worksheet id — a different sheet id sees no buffer', () => {
    files.set(TARGET_FILE, '<worksheet/>');
    setStickyWorksheetFile({ session: SESSION, worksheetId: WORKSHEET_ID, file: TARGET_FILE });

    expect(
      getStickyWorksheetFile({ session: SESSION, worksheetId: 'some-other-sheet-uuid' }),
    ).toBeUndefined();
  });

  it('ignores a pointer recorded under a different session (fail-open to a fresh fetch)', () => {
    files.set(TARGET_FILE, '<worksheet/>');
    setStickyWorksheetFile({ session: '99999', worksheetId: WORKSHEET_ID, file: TARGET_FILE });

    // Same worksheetId, different session — pointer file path differs, so this is already
    // a miss; this test pins that behavior rather than a session_id check.
    expect(getStickyWorksheetFile({ session: SESSION, worksheetId: WORKSHEET_ID })).toBeUndefined();
  });

  it('closes the recorded session_id gap when two sessions sanitize to the same cache key', () => {
    // 'abc:1' and 'abc/1' both sanitize to 'abc_1' (safeWorksheetCacheId), so they would
    // collide on the same pointer file path — the recorded session_id inside the pointer
    // is what stops one session's buffer from bleeding into the other's.
    files.set(TARGET_FILE, '<worksheet/>');
    setStickyWorksheetFile({ session: 'abc:1', worksheetId: WORKSHEET_ID, file: TARGET_FILE });

    expect(getStickyWorksheetFile({ session: 'abc/1', worksheetId: WORKSHEET_ID })).toBeUndefined();
    expect(getStickyWorksheetFile({ session: 'abc:1', worksheetId: WORKSHEET_ID })).toBe(
      TARGET_FILE,
    );
  });

  it('closes the recorded worksheet_id gap when two sheet ids sanitize to the same cache key', () => {
    // 'sheet:1' and 'sheet/1' both sanitize to 'sheet_1', so they would collide on the
    // same pointer file path — the recorded worksheet_id inside the pointer is what stops
    // one sheet's buffer from bleeding into the other's.
    files.set(TARGET_FILE, '<worksheet/>');
    setStickyWorksheetFile({ session: SESSION, worksheetId: 'sheet:1', file: TARGET_FILE });

    expect(getStickyWorksheetFile({ session: SESSION, worksheetId: 'sheet/1' })).toBeUndefined();
    expect(getStickyWorksheetFile({ session: SESSION, worksheetId: 'sheet:1' })).toBe(TARGET_FILE);
  });

  it('trims worksheetId so set/get/clear agree when the caller passes surrounding whitespace', () => {
    files.set(TARGET_FILE, '<worksheet/>');
    setStickyWorksheetFile({
      session: SESSION,
      worksheetId: `${WORKSHEET_ID} `,
      file: TARGET_FILE,
    });

    expect(getStickyWorksheetFile({ session: SESSION, worksheetId: ` ${WORKSHEET_ID}` })).toBe(
      TARGET_FILE,
    );

    clearStickyWorksheetFile({ session: SESSION, worksheetId: `${WORKSHEET_ID}  ` });

    expect(getStickyWorksheetFile({ session: SESSION, worksheetId: WORKSHEET_ID })).toBeUndefined();
  });

  it('ignores a pointer whose target file no longer exists', () => {
    setStickyWorksheetFile({ session: SESSION, worksheetId: WORKSHEET_ID, file: TARGET_FILE });
    // TARGET_FILE was never added to `files` — simulates the cache file being deleted
    // out from under the pointer.

    expect(getStickyWorksheetFile({ session: SESSION, worksheetId: WORKSHEET_ID })).toBeUndefined();
  });

  it('ignores a pointer when the sidecar fingerprint no longer matches the session', () => {
    files.set(TARGET_FILE, '<worksheet/>');
    setStickyWorksheetFile({ session: SESSION, worksheetId: WORKSHEET_ID, file: TARGET_FILE });
    vi.mocked(cacheFingerprintModule.checkSidecar).mockReturnValue({
      ok: false,
      reason: 'session-mismatch',
    } as never);

    expect(getStickyWorksheetFile({ session: SESSION, worksheetId: WORKSHEET_ID })).toBeUndefined();
  });

  it('fails open (returns undefined) when the pointer file is unreadable JSON', async () => {
    const fs = await import('fs');
    const pointerPath = pointerPathFor();
    files.set(pointerPath, 'not json');
    vi.mocked(fs.existsSync).mockImplementation((path) => String(path) === pointerPath);

    expect(getStickyWorksheetFile({ session: SESSION, worksheetId: WORKSHEET_ID })).toBeUndefined();
  });

  it('clear removes the pointer so a later get sees no buffer', () => {
    files.set(TARGET_FILE, '<worksheet/>');
    setStickyWorksheetFile({ session: SESSION, worksheetId: WORKSHEET_ID, file: TARGET_FILE });
    expect(getStickyWorksheetFile({ session: SESSION, worksheetId: WORKSHEET_ID })).toBe(
      TARGET_FILE,
    );

    clearStickyWorksheetFile({ session: SESSION, worksheetId: WORKSHEET_ID });

    expect(getStickyWorksheetFile({ session: SESSION, worksheetId: WORKSHEET_ID })).toBeUndefined();
  });

  it('clear is a no-op when there is no open buffer', async () => {
    const fs = await import('fs');

    clearStickyWorksheetFile({ session: SESSION, worksheetId: WORKSHEET_ID });

    expect(fs.unlinkSync).not.toHaveBeenCalled();
  });

  function pointerPathFor(): string {
    // set once with a throwaway file just to capture the deterministic pointer path
    // writeFileSync mock records the path it was called with.
    setStickyWorksheetFile({ session: SESSION, worksheetId: WORKSHEET_ID, file: TARGET_FILE });
    const [path] = [...files.keys()].filter((p) => p !== TARGET_FILE);
    files.clear();
    return path!;
  }
});
