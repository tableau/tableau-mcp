import * as fs from 'node:fs';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CeppLogger } from './sdkTypes.js';
import { SITE_EVENT_FILE_NAME, SiteEventFileSink } from './siteEventFileSink.js';

// Pass-through spies, so a test can make one fs call fail the way a full disk would.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    appendFileSync: vi.fn(actual.appendFileSync),
    renameSync: vi.fn(actual.renameSync),
    truncateSync: vi.fn(actual.truncateSync),
  };
});

// Writes the first few bytes of the data, then fails, like an append interrupted by ENOSPC.
function failPartway(): void {
  vi.mocked(fs.appendFileSync).mockImplementationOnce((path, data) => {
    writeFileSync(path, String(data).slice(0, 4), { flag: 'a' });
    throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
  });
}

describe('SiteEventFileSink', () => {
  let directory: string;
  let diagnostics: { [K in keyof CeppLogger]: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'activity-log-'));
    diagnostics = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  const read = (path: string): string[] => readFileSync(path, 'utf8').split('\n').filter(Boolean);

  it('appends each record as one line of the site event file', () => {
    const sink = new SiteEventFileSink({ directory, diagnostics });

    sink.info('{"a":1}');
    sink.info('{"b":2}');

    expect(sink.filePath).toBe(join(directory, 'tableau-mcp-cepp-site.log'));
    expect(readFileSync(sink.filePath, 'utf8')).toBe('{"a":1}\n{"b":2}\n');
  });

  it('creates the directory when it does not exist', () => {
    const nested = join(directory, 'logs', 'cepp');

    const sink = new SiteEventFileSink({ directory: nested, diagnostics });
    sink.info('{}');

    expect(existsSync(join(nested, SITE_EVENT_FILE_NAME))).toBe(true);
  });

  it('drops a line over the byte limit instead of writing part of it, and reports it', () => {
    const sink = new SiteEventFileSink({ directory, diagnostics, maxLineBytes: 10 });

    sink.info('{"ok":1}'); // 9 bytes with the newline
    sink.info('{"too":"long"}');

    expect(read(sink.filePath)).toEqual(['{"ok":1}']);
    expect(diagnostics.warn).toHaveBeenCalledWith(expect.stringContaining('15 bytes'));
  });

  it('counts the line limit in bytes, not characters', () => {
    const sink = new SiteEventFileSink({ directory, diagnostics, maxLineBytes: 10 });

    sink.info('ééééé'); // 5 characters, 11 bytes with the newline

    expect(existsSync(sink.filePath)).toBe(false);
    expect(diagnostics.warn).toHaveBeenCalledTimes(1);
  });

  it('rotates to .1 when the next line would go over the file size limit', () => {
    const sink = new SiteEventFileSink({ directory, diagnostics, maxFileBytes: 20 });

    sink.info('{"n":1}'); // 8 bytes
    sink.info('{"n":2}'); // 16 bytes
    sink.info('{"n":3}'); // would be 24: rotate first

    expect(read(`${sink.filePath}.1`)).toEqual(['{"n":1}', '{"n":2}']);
    expect(read(sink.filePath)).toEqual(['{"n":3}']);
  });

  it('keeps only the configured number of rotated files', () => {
    const sink = new SiteEventFileSink({
      directory,
      diagnostics,
      maxFileBytes: 8,
      maxRotatedFiles: 2,
    });

    for (let n = 1; n <= 4; n++) {
      sink.info(`{"n":${n}}`); // 8 bytes each, so every line after the first rotates
    }

    expect(read(sink.filePath)).toEqual(['{"n":4}']);
    expect(read(`${sink.filePath}.1`)).toEqual(['{"n":3}']);
    expect(read(`${sink.filePath}.2`)).toEqual(['{"n":2}']);
    expect(existsSync(`${sink.filePath}.3`)).toBe(false);
  });

  it('counts an existing file toward the size limit after a restart', () => {
    writeFileSync(join(directory, SITE_EVENT_FILE_NAME), '{"old":1}\n'); // 10 bytes

    const sink = new SiteEventFileSink({ directory, diagnostics, maxFileBytes: 15 });
    sink.info('{"n":1}');

    expect(read(`${sink.filePath}.1`)).toEqual(['{"old":1}']);
    expect(read(sink.filePath)).toEqual(['{"n":1}']);
  });

  it('throws when the append fails, so the SDK recorder can suppress and report it', () => {
    const sink = new SiteEventFileSink({ directory, diagnostics });
    rmSync(directory, { recursive: true, force: true });

    expect(() => sink.info('{}')).toThrow();
  });

  it('removes the partial line a failed append leaves, then rethrows', () => {
    const sink = new SiteEventFileSink({ directory, diagnostics });
    sink.info('{"n":1}');

    failPartway();
    expect(() => sink.info('{"n":2}')).toThrow('ENOSPC');
    sink.info('{"n":3}');

    expect(readFileSync(sink.filePath, 'utf8')).toBe('{"n":1}\n{"n":3}\n');
  });

  it('starts the next record on a new line when the partial line cannot be removed', () => {
    const sink = new SiteEventFileSink({ directory, diagnostics });
    sink.info('{"n":1}');

    failPartway();
    vi.mocked(fs.truncateSync).mockImplementationOnce(() => {
      throw new Error('EIO');
    });
    expect(() => sink.info('{"n":2}')).toThrow('ENOSPC');
    sink.info('{"n":3}');
    sink.info('{"n":4}');

    // The fragment is its own (malformed) line; the records after it are intact.
    expect(readFileSync(sink.filePath, 'utf8')).toBe('{"n":1}\n{"n"\n{"n":3}\n{"n":4}\n');
  });

  it('keeps appending after a failed rotation, and retries only after another full file', () => {
    const sink = new SiteEventFileSink({ directory, diagnostics, maxFileBytes: 16 });
    sink.info('{"n":1}');
    sink.info('{"n":2}'); // 16 bytes: the next line rotates

    vi.mocked(fs.renameSync).mockImplementationOnce(() => {
      throw new Error('EBUSY');
    });
    sink.info('{"n":3}'); // rotation fails; 24 bytes, next retry once over 32
    sink.info('{"n":4}'); // 32 bytes, no retry yet

    expect(diagnostics.error).toHaveBeenCalledTimes(1);
    expect(existsSync(`${sink.filePath}.1`)).toBe(false);
    expect(read(sink.filePath)).toHaveLength(4);

    sink.info('{"n":5}'); // would be 40: retry succeeds

    expect(read(`${sink.filePath}.1`)).toHaveLength(4);
    expect(read(sink.filePath)).toEqual(['{"n":5}']);
    expect(diagnostics.error).toHaveBeenCalledTimes(1);
  });

  it('passes warn and error through to the diagnostics logger', () => {
    const sink = new SiteEventFileSink({ directory, diagnostics });

    sink.warn('w');
    sink.error('e');

    expect(diagnostics.warn).toHaveBeenCalledWith('w');
    expect(diagnostics.error).toHaveBeenCalledWith('e');
  });
});
