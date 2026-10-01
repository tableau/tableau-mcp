import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

import * as configModule from '../../../../config.desktop.js';
import { DesktopCache } from '../../../../desktop/cache.js';
import * as discoveryModule from '../../../../desktop/externalApi/discovery.js';
import {
  checkSidecar,
  sidecarPath,
  writeSidecar,
} from '../../../../desktop/wrappers/cacheFingerprint.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import { Provider } from '../../../../utils/provider.js';
import { runApplyPreamble } from '../../api/applyPreamble.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { getReadCachedXmlTool } from './readCachedXml.js';
import { getWriteCachedXmlTool } from './writeCachedXml.js';

vi.mock('../../../../logging/notification.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../logging/notification.js')>();
  return { ...actual, notifier: { ...actual.notifier, debug: vi.fn() } };
});

describe('strict cache scope integration', () => {
  const pid = 4242;
  const instanceId = 'owned-instance';
  const cleanup: string[] = [];
  let configSpy: { mockRestore(): void };
  let discoverySpy: { mockRestore(): void };

  beforeEach(() => {
    const base = new configModule.Config();
    configSpy = vi.spyOn(configModule, 'getDesktopConfig').mockReturnValue({
      ...base,
      desktopSessionId: String(pid),
      desktopSessionScope: 'strict',
    } as configModule.Config);
    discoverySpy = vi
      .spyOn(discoveryModule, 'discoverInstances')
      .mockReturnValue([
        { pid, instanceId } as ReturnType<typeof discoveryModule.discoverInstances>[number],
      ]);
  });

  afterEach(() => {
    configSpy.mockRestore();
    discoverySpy.mockRestore();
    for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true });
  });

  function ownedFile(label: string): string {
    const file = new DesktopCache().getCacheFilePath({
      prefix: `strict-scope-${label}-${Date.now()}`,
    });
    cleanup.push(file, sidecarPath(file));
    return file;
  }

  function matchingSidecar(): string {
    return JSON.stringify({
      session_id: String(pid),
      pid,
      instanceId,
      created_at: '2026-09-25T00:00:00.000Z',
    });
  }

  async function read(filePath: string): Promise<CallToolResult> {
    const callback = await Provider.from(getReadCachedXmlTool(new DesktopMcpServer()).callback);
    return await callback(
      {
        filePath,
        worksheetName: undefined,
        worksheet: undefined,
        dashboardName: undefined,
        dashboard: undefined,
        startByte: undefined,
        endByte: undefined,
      },
      getMockRequestHandlerExtra(),
    );
  }

  async function write(filePath: string, xmlContent: string): Promise<CallToolResult> {
    const callback = await Provider.from(getWriteCachedXmlTool(new DesktopMcpServer()).callback);
    return await callback(
      {
        session: String(pid),
        filePath,
        xmlContent,
        worksheetName: undefined,
        worksheet: undefined,
        dashboardName: undefined,
        dashboard: undefined,
      },
      getMockRequestHandlerExtra(),
    );
  }

  it('reads, edits, and prepares apply only for a current owned-instance file', async () => {
    const file = ownedFile('current');
    writeFileSync(file, '<workbook name="before"/>');
    writeFileSync(sidecarPath(file), matchingSidecar());

    const readResult = await read(file);
    expect(readResult.isError).toBeFalsy();
    expect(JSON.stringify(readResult.content)).toContain('before');

    const writeResult = await write(file, '<workbook name="after"/>');
    expect(writeResult.isError).toBeFalsy();
    expect(readFileSync(file, 'utf-8')).toContain('after');

    const apply = runApplyPreamble({
      kind: 'workbook',
      file,
      session: String(pid),
      emptyPathGuidance: 'Read it first.',
      notFoundGuidance: 'Read it first.',
    });
    expect(apply.isOk()).toBe(true);
    expect(apply.unwrap().xml).toContain('after');
  });

  it('rejects ordinary-root, old-instance, dangling-symlink, and undiscoverable paths', async () => {
    const current = ownedFile('anchor');
    writeFileSync(current, '<current/>');
    const legacyRoot = dirname(dirname(current));
    const ordinary = join(legacyRoot, `strict-foreign-${Date.now()}.xml`);
    writeFileSync(ordinary, '<ordinary-secret/>');
    cleanup.push(ordinary);

    vi.mocked(discoveryModule.discoverInstances).mockReturnValue([
      { pid, instanceId: 'old-instance' } as ReturnType<
        typeof discoveryModule.discoverInstances
      >[number],
    ]);
    const oldInstance = ownedFile('old');
    writeFileSync(oldInstance, '<old-secret/>');
    vi.mocked(discoveryModule.discoverInstances).mockReturnValue([
      { pid, instanceId } as ReturnType<typeof discoveryModule.discoverInstances>[number],
    ]);

    const outside = join(tmpdir(), `strict-cache-outside-${Date.now()}.xml`);
    const dangling = ownedFile('dangling');
    rmSync(dangling, { force: true });
    symlinkSync(outside, dangling);
    cleanup.push(outside);

    for (const foreign of [ordinary, oldInstance, dangling]) {
      const readResult = await read(foreign);
      expect(readResult.isError).toBe(true);
      expect(JSON.stringify(readResult.content)).not.toContain('secret');
      const writeResult = await write(foreign, '<overwrite/>');
      expect(writeResult.isError).toBe(true);
    }
    expect(existsSync(outside)).toBe(false);
    expect(readFileSync(ordinary, 'utf-8')).toContain('ordinary-secret');
    expect(readFileSync(oldInstance, 'utf-8')).toContain('old-secret');

    vi.mocked(discoveryModule.discoverInstances).mockReturnValue([]);
    const unavailable = await read(current);
    expect(unavailable.isError).toBe(true);
    expect(JSON.stringify(unavailable.content)).not.toContain('current');
  });

  it('never reads or writes through a strict-cache sidecar symlink', () => {
    const file = ownedFile('sidecar-symlink');
    writeFileSync(file, '<workbook/>');
    const outside = join(tmpdir(), `strict-sidecar-outside-${Date.now()}.json`);
    writeFileSync(outside, 'outside-secret');
    cleanup.push(outside);
    symlinkSync(outside, sidecarPath(file));

    expect(checkSidecar(file, String(pid), 'workbook')).toMatchObject({ ok: false });
    writeSidecar(file, String(pid));

    expect(readFileSync(outside, 'utf-8')).toBe('outside-secret');
  });
});
