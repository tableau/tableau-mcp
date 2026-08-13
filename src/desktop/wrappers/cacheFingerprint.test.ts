import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as loggerModule from '../../logging/logger.js';
import type { FingerprintResolver, InstanceFingerprint } from './cacheFingerprint.js';
import * as cacheFingerprintModule from './cacheFingerprint.js';

const { checkSidecar, sidecarPath, sourceSha256, writeSidecar } = cacheFingerprintModule;

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
    const fingerprint = { pid: 1, instanceId: 'inst-a' };
    const resolve = resolver(fingerprint);

    writeSidecar(file, '1', resolve);

    const meta = JSON.parse(readFileSync(sidecarPath(file), 'utf-8')) as Record<string, unknown>;
    expect(meta).toMatchObject({ session_id: '1', ...fingerprint });
    expect(checkSidecar(file, '1', 'worksheet', resolve)).toEqual({ ok: true });
  });

  it('stores a fetched source hash and returns it for a matching apply', () => {
    const file = tempFile();
    writeFileSync(file, '<workbook/>', 'utf-8');
    const resolve = resolver({ pid: 1, instanceId: 'inst-a' });
    const sourceHash = 'f'.repeat(64);

    writeSidecar(file, '1', sourceHash, resolve);

    const meta = JSON.parse(readFileSync(sidecarPath(file), 'utf-8')) as Record<string, unknown>;
    expect(meta.source_sha256).toBe(sourceHash);
    expect(checkSidecar(file, '1', 'workbook', resolve)).toEqual({ ok: true, sourceHash });
  });

  it('drops an old source hash when a fresh write omits one', () => {
    const file = tempFile();
    writeFileSync(file, '<workbook/>', 'utf-8');
    const resolve = resolver({ pid: 1, instanceId: 'inst-a' });
    const sourceHash = 'a'.repeat(64);
    writeSidecar(file, '1', sourceHash, resolve);

    writeSidecar(file, '1', resolve);

    const meta = JSON.parse(readFileSync(sidecarPath(file), 'utf-8')) as Record<string, unknown>;
    expect(meta.source_sha256).toBeUndefined();
  });

  it('replaces source A with fresh source B and preserves B across an edit restamp', () => {
    const file = tempFile();
    const resolve = resolver({ pid: 1, instanceId: 'inst-a' });
    const sourceA = '<workbook revision="A"/>';
    const sourceB = '<workbook revision="B"/>';
    writeFileSync(file, sourceA, 'utf-8');
    writeSidecar(file, '1', sourceSha256(sourceA), resolve);

    writeFileSync(file, sourceB, 'utf-8');
    writeSidecar(file, '1', sourceSha256(sourceB), resolve);
    writeFileSync(file, '<workbook revision="B" edited="true"/>', 'utf-8');
    const restampSidecarAfterEdit = (
      cacheFingerprintModule as typeof cacheFingerprintModule & {
        restampSidecarAfterEdit?: (
          cacheFile: string,
          sessionId: string,
          resolve: FingerprintResolver,
        ) => void;
      }
    ).restampSidecarAfterEdit;
    expect(restampSidecarAfterEdit).toBeTypeOf('function');
    if (restampSidecarAfterEdit === undefined) return;
    restampSidecarAfterEdit(file, '1', resolve);

    expect(checkSidecar(file, '1', 'workbook', resolve)).toEqual({
      ok: true,
      sourceHash: sourceSha256(sourceB),
    });
  });

  it('refuses when the sidecar fingerprint differs from the current session', () => {
    const file = tempFile();
    writeFileSync(file, '<worksheet/>', 'utf-8');
    writeFileSync(
      sidecarPath(file),
      JSON.stringify({
        session_id: '1',
        pid: 1,
        instanceId: 'inst-a',
        created_at: '2026-07-15T01:00:00Z',
      }),
      'utf-8',
    );

    const result = checkSidecar(file, '2', 'worksheet', resolver({ pid: 2, instanceId: 'inst-b' }));

    expect(result.ok).toBe(false);
    expect(result.message).toContain('Refusing to apply worksheet cache file');
    expect(result.message).toContain('get-worksheet-xml');
  });

  it('refuses a same-pid cache when Desktop restarted (instanceId changed)', () => {
    const file = tempFile();
    writeFileSync(file, '<worksheet/>', 'utf-8');
    writeFileSync(
      sidecarPath(file),
      JSON.stringify({ session_id: '1', pid: 1, instanceId: 'inst-old', created_at: 'x' }),
      'utf-8',
    );
    const result = checkSidecar(
      file,
      '1',
      'worksheet',
      resolver({ pid: 1, instanceId: 'inst-new' }),
    );
    expect(result.ok).toBe(false);
  });

  it('warns and proceeds when the sidecar is missing (pre-sidecar caches stay valid)', () => {
    const file = tempFile();
    writeFileSync(file, '<worksheet/>', 'utf-8');
    const logSpy = vi.spyOn(loggerModule, 'log').mockImplementation(() => undefined);

    expect(
      checkSidecar(file, '1', 'worksheet', resolver({ pid: 1, instanceId: 'inst-a' })),
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
      checkSidecar(file, '1', 'worksheet', resolver({ pid: 1, instanceId: 'inst-a' })),
    ).toEqual({ ok: true });
  });

  it('warns and proceeds on a legacy sidecar without an instanceId (agent-manifest era)', () => {
    const file = tempFile();
    writeFileSync(file, '<worksheet/>', 'utf-8');
    writeFileSync(
      sidecarPath(file),
      JSON.stringify({ session_id: '1', pid: 1, port: 8765, start_time: 'old', created_at: 'x' }),
      'utf-8',
    );
    const logSpy = vi.spyOn(loggerModule, 'log').mockImplementation(() => undefined);
    expect(
      checkSidecar(file, '1', 'worksheet', resolver({ pid: 1, instanceId: 'inst-a' })),
    ).toEqual({ ok: true });
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('legacy fingerprint') }),
    );
  });

  it('proceeds when no current fingerprint can be resolved (never blocks blind)', () => {
    const file = tempFile();
    writeFileSync(file, '<worksheet/>', 'utf-8');
    writeFileSync(
      sidecarPath(file),
      JSON.stringify({ session_id: '1', pid: 1, instanceId: 'inst-a', created_at: 'x' }),
      'utf-8',
    );
    vi.spyOn(loggerModule, 'log').mockImplementation(() => undefined);
    expect(checkSidecar(file, 'abc', 'worksheet', resolver(undefined))).toEqual({ ok: true });
  });
});
