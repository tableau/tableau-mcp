import * as cacheFingerprintModule from '../../../../desktop/wrappers/cacheFingerprint.js';
import {
  clearStickyWorksheetFile,
  getStickyWorksheetFile,
  setStickyWorksheetFile,
} from './worksheetEditBuffer.js';

vi.mock('../../../../desktop/wrappers/cacheFingerprint.js');
vi.mock('fs');

const SESSION = '12345';
const WORKSHEET_NAME = 'Sheet 1';
const TARGET_FILE = '/cache/worksheet-Sheet_1-abc123.xml';

describe('worksheetEditBuffer', () => {
  // In-memory stand-in for the fs mock so pointer read/write/unlink round-trip like a
  // real filesystem within one test.
  let files: Map<string, string>;

  beforeEach(async () => {
    vi.clearAllMocks();
    files = new Map();
    const fs = await import('fs');
    vi.mocked(fs.existsSync).mockImplementation((path) => files.has(String(path)));
    vi.mocked(fs.readFileSync).mockImplementation((path) => {
      const content = files.get(String(path));
      if (content === undefined) {
        throw new Error(`ENOENT: ${String(path)}`);
      }
      return content;
    });
    vi.mocked(fs.writeFileSync).mockImplementation((path, data) => {
      files.set(String(path), String(data));
    });
    vi.mocked(fs.unlinkSync).mockImplementation((path) => {
      files.delete(String(path));
    });
    vi.mocked(cacheFingerprintModule.checkSidecar).mockReturnValue({ ok: true });
  });

  it('returns undefined when no sticky buffer has been opened for this sheet+session', () => {
    expect(getStickyWorksheetFile({ session: SESSION, worksheetName: WORKSHEET_NAME })).toBe(
      undefined,
    );
  });

  it('round-trips: set then get returns the same file', () => {
    files.set(TARGET_FILE, '<worksheet/>');

    setStickyWorksheetFile({ session: SESSION, worksheetName: WORKSHEET_NAME, file: TARGET_FILE });

    expect(getStickyWorksheetFile({ session: SESSION, worksheetName: WORKSHEET_NAME })).toBe(
      TARGET_FILE,
    );
  });

  it('keys the pointer by worksheet name — a different sheet name sees no buffer', () => {
    files.set(TARGET_FILE, '<worksheet/>');
    setStickyWorksheetFile({ session: SESSION, worksheetName: WORKSHEET_NAME, file: TARGET_FILE });

    expect(
      getStickyWorksheetFile({ session: SESSION, worksheetName: 'Some Other Sheet' }),
    ).toBeUndefined();
  });

  it('ignores a pointer recorded under a different session (fail-open to a fresh fetch)', () => {
    files.set(TARGET_FILE, '<worksheet/>');
    setStickyWorksheetFile({ session: '99999', worksheetName: WORKSHEET_NAME, file: TARGET_FILE });

    // Same worksheetName, different session — pointer file path differs, so this is
    // already a miss; this test pins that behavior rather than a session_id check.
    expect(
      getStickyWorksheetFile({ session: SESSION, worksheetName: WORKSHEET_NAME }),
    ).toBeUndefined();
  });

  it('closes the recorded session_id gap when two sessions sanitize to the same cache key', () => {
    // 'abc:1' and 'abc/1' both sanitize to 'abc_1' (safeWorksheetCacheId), so they would
    // collide on the same pointer file path — the recorded session_id inside the pointer
    // is what stops one session's buffer from bleeding into the other's.
    files.set(TARGET_FILE, '<worksheet/>');
    setStickyWorksheetFile({ session: 'abc:1', worksheetName: WORKSHEET_NAME, file: TARGET_FILE });

    expect(
      getStickyWorksheetFile({ session: 'abc/1', worksheetName: WORKSHEET_NAME }),
    ).toBeUndefined();
    expect(getStickyWorksheetFile({ session: 'abc:1', worksheetName: WORKSHEET_NAME })).toBe(
      TARGET_FILE,
    );
  });

  it('ignores a pointer whose target file no longer exists', () => {
    setStickyWorksheetFile({ session: SESSION, worksheetName: WORKSHEET_NAME, file: TARGET_FILE });
    // TARGET_FILE was never added to `files` — simulates the cache file being deleted
    // out from under the pointer.

    expect(
      getStickyWorksheetFile({ session: SESSION, worksheetName: WORKSHEET_NAME }),
    ).toBeUndefined();
  });

  it('ignores a pointer when the sidecar fingerprint no longer matches the session', () => {
    files.set(TARGET_FILE, '<worksheet/>');
    setStickyWorksheetFile({ session: SESSION, worksheetName: WORKSHEET_NAME, file: TARGET_FILE });
    vi.mocked(cacheFingerprintModule.checkSidecar).mockReturnValue({
      ok: false,
      reason: 'session-mismatch',
    } as never);

    expect(
      getStickyWorksheetFile({ session: SESSION, worksheetName: WORKSHEET_NAME }),
    ).toBeUndefined();
  });

  it('fails open (returns undefined) when the pointer file is unreadable JSON', async () => {
    const fs = await import('fs');
    const pointerPath = pointerPathFor();
    files.set(pointerPath, 'not json');
    vi.mocked(fs.existsSync).mockImplementation((path) => String(path) === pointerPath);

    expect(
      getStickyWorksheetFile({ session: SESSION, worksheetName: WORKSHEET_NAME }),
    ).toBeUndefined();
  });

  it('clear removes the pointer so a later get sees no buffer', () => {
    files.set(TARGET_FILE, '<worksheet/>');
    setStickyWorksheetFile({ session: SESSION, worksheetName: WORKSHEET_NAME, file: TARGET_FILE });
    expect(getStickyWorksheetFile({ session: SESSION, worksheetName: WORKSHEET_NAME })).toBe(
      TARGET_FILE,
    );

    clearStickyWorksheetFile({ session: SESSION, worksheetName: WORKSHEET_NAME });

    expect(
      getStickyWorksheetFile({ session: SESSION, worksheetName: WORKSHEET_NAME }),
    ).toBeUndefined();
  });

  it('clear is a no-op when there is no open buffer', async () => {
    const fs = await import('fs');

    clearStickyWorksheetFile({ session: SESSION, worksheetName: WORKSHEET_NAME });

    expect(fs.unlinkSync).not.toHaveBeenCalled();
  });

  function pointerPathFor(): string {
    // set once with a throwaway file just to capture the deterministic pointer path
    // writeFileSync mock records the path it was called with.
    setStickyWorksheetFile({ session: SESSION, worksheetName: WORKSHEET_NAME, file: TARGET_FILE });
    const [path] = [...files.keys()].filter((p) => p !== TARGET_FILE);
    files.clear();
    return path!;
  }
});
