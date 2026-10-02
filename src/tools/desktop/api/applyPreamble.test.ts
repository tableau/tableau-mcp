import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import * as configModule from '../../../config.desktop.js';
import { getCacheDir } from '../../../desktop/cachePath.js';
import * as externalDiscovery from '../../../desktop/externalApi/discovery.js';
import { sidecarPath } from '../../../desktop/wrappers/cacheFingerprint.js';
import { runApplyPreamble } from './applyPreamble.js';

describe('runApplyPreamble secure contained cache read', () => {
  const temporaryPaths: string[] = [];

  beforeEach(() => {
    const base = new configModule.Config();
    vi.spyOn(configModule, 'getDesktopConfig').mockReturnValue({
      ...base,
      desktopSessionId: '7',
    } as configModule.Config);
    vi.spyOn(externalDiscovery, 'discoverInstances').mockReturnValue([
      {
        pid: 7,
        instanceId: 'inst-current',
      } as ReturnType<typeof externalDiscovery.discoverInstances>[number],
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const path of temporaryPaths.splice(0)) {
      rmSync(path, { recursive: true, force: true });
    }
  });

  function cacheDirectory(label: string): string {
    const directory = mkdtempSync(join(getCacheDir(), `apply-preamble-${label}-`));
    temporaryPaths.push(directory);
    return directory;
  }

  function outsideDirectory(label: string): string {
    const directory = mkdtempSync(join(tmpdir(), `apply-preamble-outside-${label}-`));
    temporaryPaths.push(directory);
    return directory;
  }

  function run(
    file: string,
    kind: 'workbook' | 'worksheet' | 'dashboard' | 'storyboard' | 'datasource' = 'datasource',
  ): ReturnType<typeof runApplyPreamble> {
    return runApplyPreamble({
      kind,
      file,
      session: '7',
      emptyPathGuidance: `Read the ${kind} document first.`,
      notFoundGuidance: 'Provide its cached path.',
    });
  }

  function matchingSidecar(sourceHash = 'a'.repeat(64)): string {
    return JSON.stringify({
      session_id: '7',
      pid: 7,
      instanceId: 'inst-current',
      created_at: '2026-08-31T00:00:00Z',
      source_sha256: sourceHash,
    });
  }

  it('returns only descriptor-read datasource and sidecar content for valid cache files', () => {
    const directory = cacheDirectory('valid');
    const file = join(directory, 'datasource.xml');
    const xml = '<datasource name="sales"/>';
    const sourceHash = 'b'.repeat(64);
    writeFileSync(file, xml);
    writeFileSync(sidecarPath(file), matchingSidecar(sourceHash));

    const result = run(file);

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({ xml, resolvedSession: '7', sourceHash });
  });

  it('rejects final-component and intermediate-directory primary-file symlink escapes', () => {
    const directory = cacheDirectory('primary-symlinks');
    const outside = outsideDirectory('primary-symlinks');
    const outsideFile = join(outside, 'outside.xml');
    writeFileSync(outsideFile, '<outside-secret/>');

    const finalSymlink = join(directory, 'final.xml');
    symlinkSync(outsideFile, finalSymlink);
    const finalResult = run(finalSymlink);
    expect(finalResult.isErr()).toBe(true);
    expect(finalResult.unwrapErr().type).toBe('args-validation');

    symlinkSync(outside, join(directory, 'linked'));
    const intermediateResult = run(join(directory, 'linked', 'outside.xml'));
    expect(intermediateResult.isErr()).toBe(true);
    expect(intermediateResult.unwrapErr().type).toBe('args-validation');
  });

  it('rejects lexical escapes and preserves the existing missing-file error', () => {
    const outside = outsideDirectory('lexical');
    const outsideFile = join(outside, 'outside.xml');
    writeFileSync(outsideFile, '<datasource/>');

    const outsideResult = run(outsideFile);
    expect(outsideResult.isErr()).toBe(true);
    expect(outsideResult.unwrapErr().type).toBe('args-validation');

    const missingResult = run(join(cacheDirectory('missing'), 'missing.xml'));
    expect(missingResult.isErr()).toBe(true);
    expect(missingResult.unwrapErr().type).toBe('workbook-not-found');
  });

  it('fails open for a missing sidecar', () => {
    const file = join(cacheDirectory('missing-sidecar'), 'datasource.xml');
    writeFileSync(file, '<datasource/>');

    const result = run(file);

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({
      xml: '<datasource/>',
      resolvedSession: '7',
      sourceHash: undefined,
    });
  });

  it('fails open for safely read but unreadable sidecar content', () => {
    const file = join(cacheDirectory('unreadable-sidecar'), 'datasource.xml');
    writeFileSync(file, '<datasource/>');
    writeFileSync(sidecarPath(file), 'not json');

    const result = run(file);

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({
      xml: '<datasource/>',
      resolvedSession: '7',
      sourceHash: undefined,
    });
  });

  it('fails open for an unsafe sidecar without consuming its external fingerprint', () => {
    const directory = cacheDirectory('unsafe-sidecar');
    const file = join(directory, 'datasource.xml');
    const outside = outsideDirectory('unsafe-sidecar');
    const outsideSidecar = join(outside, 'escaped.meta.json');
    writeFileSync(file, '<datasource/>');
    writeFileSync(outsideSidecar, matchingSidecar('c'.repeat(64)));
    symlinkSync(outsideSidecar, sidecarPath(file));

    const result = run(file);

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({
      xml: '<datasource/>',
      resolvedSession: '7',
      sourceHash: undefined,
    });
  });

  it('refuses a fingerprint mismatch from safely read sidecar text', () => {
    const file = join(cacheDirectory('mismatch'), 'datasource.xml');
    writeFileSync(file, '<datasource/>');
    writeFileSync(
      sidecarPath(file),
      JSON.stringify({
        session_id: '8',
        pid: 8,
        instanceId: 'inst-old',
        created_at: '2026-08-31T00:00:00Z',
      }),
    );

    const result = run(file);

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr().type).toBe('cache-session-mismatch');
    expect(result.unwrapErr().message).toContain('get-datasource-xml');
  });

  it.each(['workbook', 'worksheet', 'dashboard', 'storyboard', 'datasource'] as const)(
    'rejects an outside-cache path for the %s apply preamble',
    (kind) => {
      const file = join(outsideDirectory(`all-kinds-${kind}`), `${kind}.xml`);
      writeFileSync(file, `<${kind}/>`);

      const result = run(file, kind);

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr().type).toBe('args-validation');
    },
  );
});
