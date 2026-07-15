import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as loggerModule from '../../../logging/logger.js';
import {
  checkSidecar,
  type FingerprintResolver,
  type InstanceFingerprint,
  sidecarPath,
  writeSidecar,
} from './cacheFingerprint.js';

const dirs: string[] = [];

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tableau-cache-fingerprint-'));
  dirs.push(dir);
  return join(dir, 'worksheet.xml');
}

/** A resolver that returns a fixed fingerprint (or undefined) regardless of session id. */
function resolver(instance: InstanceFingerprint | undefined): FingerprintResolver {
  return () => instance;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('cache fingerprint sidecars', () => {
  it('writes sidecar metadata and accepts the same current instance', () => {
    const file = tempFile();
    writeFileSync(file, '<worksheet/>', 'utf-8');
    const fingerprint = { pid: 1, port: 8765, start_time: '2026-07-15T01:00:00Z' };
    const resolve = resolver(fingerprint);

    writeSidecar(file, '1', resolve);

    const meta = JSON.parse(readFileSync(sidecarPath(file), 'utf-8')) as Record<string, unknown>;
    expect(meta).toMatchObject({ session_id: '1', ...fingerprint });
    expect(checkSidecar(file, '1', 'worksheet', resolve)).toEqual({ ok: true });
  });

  it('refuses when the sidecar fingerprint differs from the current session', () => {
    const file = tempFile();
    writeFileSync(file, '<worksheet/>', 'utf-8');
    writeFileSync(
      sidecarPath(file),
      JSON.stringify({
        session_id: '1',
        pid: 1,
        port: 8765,
        start_time: 'old',
        created_at: '2026-07-15T01:00:00Z',
      }),
      'utf-8',
    );

    const result = checkSidecar(
      file,
      '2',
      'worksheet',
      resolver({ pid: 2, port: 8766, start_time: 'new' }),
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain('Refusing to apply worksheet cache file');
    expect(result.message).toContain('get-worksheet-xml');
  });

  it('refuses a same-pid cache when Desktop restarted (start_time changed)', () => {
    const file = tempFile();
    writeFileSync(file, '<worksheet/>', 'utf-8');
    writeFileSync(
      sidecarPath(file),
      JSON.stringify({ session_id: '1', pid: 1, port: 8765, start_time: 'old', created_at: 'x' }),
      'utf-8',
    );
    const result = checkSidecar(
      file,
      '1',
      'worksheet',
      resolver({ pid: 1, port: 8765, start_time: 'new' }),
    );
    expect(result.ok).toBe(false);
  });

  it('warns and proceeds when the sidecar is missing (pre-sidecar caches stay valid)', () => {
    const file = tempFile();
    writeFileSync(file, '<worksheet/>', 'utf-8');
    const logSpy = vi.spyOn(loggerModule, 'log').mockImplementation(() => undefined);

    expect(
      checkSidecar(file, '1', 'worksheet', resolver({ pid: 1, port: 8765, start_time: 's' })),
    ).toEqual({ ok: true });
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('cache sidecar missing') }),
    );
  });

  it('warns and proceeds when the sidecar is unreadable JSON', () => {
    const file = tempFile();
    writeFileSync(file, '<worksheet/>', 'utf-8');
    writeFileSync(sidecarPath(file), 'not json', 'utf-8');
    vi.spyOn(loggerModule, 'log').mockImplementation(() => undefined);
    expect(
      checkSidecar(file, '1', 'worksheet', resolver({ pid: 1, port: 8765, start_time: 's' })),
    ).toEqual({ ok: true });
  });

  it('proceeds when no current fingerprint can be resolved (never blocks blind)', () => {
    const file = tempFile();
    writeFileSync(file, '<worksheet/>', 'utf-8');
    writeFileSync(
      sidecarPath(file),
      JSON.stringify({ session_id: '1', pid: 1, port: 8765, start_time: 'old', created_at: 'x' }),
      'utf-8',
    );
    vi.spyOn(loggerModule, 'log').mockImplementation(() => undefined);
    expect(checkSidecar(file, 'abc', 'worksheet', resolver(undefined))).toEqual({ ok: true });
  });
});
