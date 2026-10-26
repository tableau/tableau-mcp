import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { resolveTemplatePackageDir } from '../tools/desktop/authoring/dataApps/scaffoldDataApp.js';
import { prepareDesktopDataApp } from './prepareDesktopDataApp.js';

const datasources = [
  { id: 'Sales%20West', name: 'Sales West' },
  { id: '%E5%A3%B2%E4%B8%8A', name: '売上' },
  { id: '100%25', name: '100%' },
];

describe('prepareDesktopDataApp', () => {
  let workspace: string;
  let cache: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'data-app-ws-'));
    cache = await mkdtemp(join(tmpdir(), 'data-app-cache-'));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
    await rm(cache, { recursive: true, force: true });
  });

  it('binds the selected datasource and does not pick the first source', async () => {
    const template = resolveTemplatePackageDir();
    expect(template).toBeTruthy();
    const result = await prepareDesktopDataApp({
      workspaceRoot: workspace,
      worksheetFile: join(cache, 'sheet.xml'),
      templatePackageDir: template!,
      datappName: 'Sales Demo',
      datasourceId: '100%25',
      datasources,
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.datasourceId).toBe('100%');
    expect(result.value.packageId).toMatch(/^com\.tableau\.mcp\.sales-demo\.[0-9a-f]+$/);
    expect(result.value.sourceDir.startsWith(workspace)).toBe(true);
    const xml = await readFile(result.value.worksheetFile, 'utf8');
    expect(xml).toContain("name='100%'");
    expect(xml).toContain('tableauunzippedpackagesrc:///');
    expect(xml).not.toContain('simple-id');
    expect(xml).toContain(result.value.sourceDir.replace(/\\/g, '/'));
    const appJs = await readFile(join(result.value.sourceDir, 'content', 'src', 'app.js'), 'utf8');
    expect(appJs).toContain('var BOUND_DATASOURCE_ID = "100%";');
    expect(appJs).toContain('AUTHOR YOUR APP HERE');
  });

  it('keeps a second app when the display name collides', async () => {
    const template = resolveTemplatePackageDir()!;
    const first = await prepareDesktopDataApp({
      workspaceRoot: workspace,
      worksheetFile: join(cache, 'a.xml'),
      templatePackageDir: template,
      datappName: 'Sales Demo',
      datasourceId: 'Sales%20West',
      datasources,
    });
    const second = await prepareDesktopDataApp({
      workspaceRoot: workspace,
      worksheetFile: join(cache, 'b.xml'),
      templatePackageDir: template,
      datappName: 'Sales Demo',
      datasourceId: '%E5%A3%B2%E4%B8%8A',
      datasources,
    });
    expect(first.isOk() && second.isOk()).toBe(true);
    if (first.isErr() || second.isErr()) return;
    expect(first.value.sourceDir).not.toBe(second.value.sourceDir);
    expect(first.value.packageId).not.toBe(second.value.packageId);
    expect(second.value.datasourceId).toBe('売上');
  });

  it('rejects a relative workspace and an unknown datasource', async () => {
    const template = resolveTemplatePackageDir()!;
    const relative = await prepareDesktopDataApp({
      workspaceRoot: 'relative/dir',
      worksheetFile: join(cache, 'sheet.xml'),
      templatePackageDir: template,
      datappName: 'Sales Demo',
      datasourceId: 'Sales%20West',
      datasources,
    });
    expect(relative.isErr()).toBe(true);
    const missing = await prepareDesktopDataApp({
      workspaceRoot: workspace,
      worksheetFile: join(cache, 'sheet.xml'),
      templatePackageDir: template,
      datappName: 'Sales Demo',
      datasourceId: 'not-a-source',
      datasources,
    });
    expect(missing.isErr()).toBe(true);
    if (missing.isOk()) return;
    expect(missing.error.message).toContain('not-a-source');
    expect(missing.error.message).toContain('Available:');
  });
});
