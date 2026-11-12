import { access, mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Ok } from 'ts-results-es';

import { makeExecutorMock } from '../desktop/externalApi/executor.mock.js';
import { tryApplyViaPerSheetRoute } from '../desktop/wrappers/perSheetDocumentApply.js';
import { resolveTemplatePackageDir } from '../tools/desktop/authoring/dataApps/scaffoldDataApp.js';
import { prepareDesktopDataApp } from './prepareDesktopDataApp.js';

const datasources = [
  { id: 'Sales%20West', name: 'Sales West', caption: 'Sales West' },
  { id: '%E5%A3%B2%E4%B8%8A', name: '売上', caption: '売上' },
  { id: '100%25', name: '100%', caption: 'One Hundred Percent' },
];

const worksheets = [
  { id: '{SHEET-GUID-1}', name: 'Sheet 1' },
  { id: '{SHEET-GUID-A}', name: 'Sheet A' },
  { id: '{SHEET-GUID-B}', name: 'Sheet B' },
];

const NO_FOCUS = { navigate: 'none', reason: 'intermediate-leg' } as const;

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
    const template = await resolveTemplatePackageDir();
    expect(template).toBeTruthy();
    const result = await prepareDesktopDataApp({
      workspaceRoot: workspace,
      worksheetFile: join(cache, 'sheet.xml'),
      templatePackageDir: template!,
      datappName: 'Sales Demo',
      worksheetId: '{SHEET-GUID-1}',
      datasourceId: '100%25',
      datasources,
      worksheets,
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.extensionsDatasourceId).toBe('100%');
    expect(result.value.worksheetId).toBe('{SHEET-GUID-1}');
    expect(result.value.worksheetName).toBe('Sheet 1');
    expect(result.value.packageId).toMatch(/^com\.tableau\.mcp\.sales-demo\.[0-9a-f]+$/);
    expect(result.value.sourceDir.startsWith(workspace)).toBe(true);
    const xml = await readFile(result.value.worksheetFile, 'utf8');
    expect(xml).toContain("name='Sheet 1'");
    expect(xml).toContain("caption='One Hundred Percent'");
    expect(xml).toContain("name='100%'");
    expect(xml).toContain('tableauunzippedpackagesrc:///');
    expect(xml).toContain("<simple-id uuid='{SHEET-GUID-1}' />");
    expect(xml).toContain(result.value.sourceDir.replace(/\\/g, '/'));
    const appJs = await readFile(join(result.value.sourceDir, 'content', 'src', 'app.js'), 'utf8');
    expect(appJs).toContain('var BOUND_DATASOURCE_ID = "100%";');
    expect(appJs).toContain('AUTHOR YOUR APP HERE');
    const manifest = await readFile(join(result.value.sourceDir, 'manifest.json'), 'utf8');
    expect(manifest).toContain('Sales Demo');
  });

  it('splits a long name into package id parts and writes the same id everywhere', async () => {
    const template = (await resolveTemplatePackageDir())!;
    const result = await prepareDesktopDataApp({
      workspaceRoot: workspace,
      worksheetFile: join(cache, 'sheet.xml'),
      templatePackageDir: template,
      datappName: 'Superstore Regional Sales and Profit Trends-long-app-name-default-r01-1d42',
      worksheetId: '{SHEET-GUID-1}',
      datasourceId: 'Sales%20West',
      datasources,
      worksheets,
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const { packageId, sourceDir, worksheetFile } = result.value;
    expect(packageId).toMatch(
      /^com\.tableau\.mcp\.superstore\.regional-sales-and-profit-trends\.long-app-name-default-r01-1d42\.[0-9a-f]{8}$/,
    );
    expect(await readFile(worksheetFile, 'utf8')).toContain(`add-in-id='${packageId}'`);
    expect(await readFile(join(sourceDir, 'manifest.json'), 'utf8')).toContain(
      `"id": "${packageId}"`,
    );
    expect(await readFile(join(sourceDir, 'extensions', 'data-app.trex'), 'utf8')).toContain(
      `<worksheet-extension id="${packageId}"`,
    );
  });

  it('writes the live sheet name so apply-worksheet does not hit name-differs', async () => {
    const template = (await resolveTemplatePackageDir())!;
    const result = await prepareDesktopDataApp({
      workspaceRoot: workspace,
      worksheetFile: join(cache, 'sheet.xml'),
      templatePackageDir: template,
      datappName: 'Sales Demo',
      worksheetId: '{SHEET-GUID-1}',
      datasourceId: 'Sales%20West',
      datasources,
      worksheets,
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    expect(result.value.worksheetName).toBe('Sheet 1');
    const xml = await readFile(result.value.worksheetFile, 'utf8');
    expect(xml).toMatch(/^<worksheet name='Sheet 1'>/);
    expect(xml).not.toContain("name='Sales Demo'");

    const apply = vi
      .fn()
      .mockResolvedValue(Ok({ command_id: 'cmd-apply', status: 'completed', submitted_at: '' }));
    const liveXml =
      "<worksheet name='Sheet 1'><table><view><datasources /></view><rows /><cols /></table>" +
      "<simple-id uuid='{SHEET-GUID-1}' /></worksheet>";
    const executor = makeExecutorMock({
      listWorksheets: vi
        .fn()
        .mockResolvedValue(Ok({ worksheets: [{ id: '{SHEET-GUID-1}', name: 'Sheet 1' }] })),
      getWorksheetDocument: vi.fn().mockResolvedValue(Ok({ xml: liveXml })),
      listDashboards: vi.fn().mockResolvedValue(Ok({ dashboards: [] })),
      applyWorksheetDocument: apply,
    });

    const applied = await tryApplyViaPerSheetRoute({
      kind: 'worksheet',
      sheetName: '{SHEET-GUID-1}',
      fragmentXml: xml,
      focus: NO_FOCUS,
      executor,
      signal: new AbortController().signal,
    });

    expect(applied.isOk()).toBe(true);
    if (applied.isOk()) {
      expect(applied.value).toMatchObject({
        status: 'applied',
        id: '{SHEET-GUID-1}',
        name: 'Sheet 1',
      });
    }
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('rejects an unknown worksheet id before writing files', async () => {
    const template = (await resolveTemplatePackageDir())!;
    const worksheetFile = join(cache, 'missing-sheet.xml');
    const result = await prepareDesktopDataApp({
      workspaceRoot: workspace,
      worksheetFile,
      templatePackageDir: template,
      datappName: 'Sales Demo',
      worksheetId: '{MISSING}',
      datasourceId: 'Sales%20West',
      datasources,
      worksheets,
    });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.message).toContain('{MISSING}');
    expect(result.error.message).toContain('Available:');
    await expect(access(worksheetFile)).rejects.toThrow();
  });

  it('rejects a datasource that has no caption', async () => {
    const template = (await resolveTemplatePackageDir())!;
    const result = await prepareDesktopDataApp({
      workspaceRoot: workspace,
      worksheetFile: join(cache, 'sheet.xml'),
      templatePackageDir: template,
      datappName: 'Sales Demo',
      worksheetId: '{SHEET-GUID-1}',
      datasourceId: 'Sales%20West',
      datasources: [{ id: 'Sales%20West', name: 'Sales West' }],
      worksheets,
    });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.message).toContain('Sales%20West');
  });

  it('keeps a second app when the display name collides', async () => {
    const template = (await resolveTemplatePackageDir())!;
    const first = await prepareDesktopDataApp({
      workspaceRoot: workspace,
      worksheetFile: join(cache, 'a.xml'),
      templatePackageDir: template,
      datappName: 'Sales Demo',
      worksheetId: '{SHEET-GUID-A}',
      datasourceId: 'Sales%20West',
      datasources,
      worksheets,
    });
    const second = await prepareDesktopDataApp({
      workspaceRoot: workspace,
      worksheetFile: join(cache, 'b.xml'),
      templatePackageDir: template,
      datappName: 'Sales Demo',
      worksheetId: '{SHEET-GUID-B}',
      datasourceId: '%E5%A3%B2%E4%B8%8A',
      datasources,
      worksheets,
    });
    expect(first.isOk() && second.isOk()).toBe(true);
    if (first.isErr() || second.isErr()) return;
    expect(first.value.sourceDir).not.toBe(second.value.sourceDir);
    expect(first.value.packageId).not.toBe(second.value.packageId);
    expect(second.value.extensionsDatasourceId).toBe('売上');
    expect(first.value.worksheetName).toBe('Sheet A');
    expect(second.value.worksheetName).toBe('Sheet B');
  });

  it('rejects a relative workspace and an unknown datasource', async () => {
    const template = (await resolveTemplatePackageDir())!;
    const relative = await prepareDesktopDataApp({
      workspaceRoot: 'relative/dir',
      worksheetFile: join(cache, 'sheet.xml'),
      templatePackageDir: template,
      datappName: 'Sales Demo',
      worksheetId: '{SHEET-GUID-1}',
      datasourceId: 'Sales%20West',
      datasources,
      worksheets,
    });
    expect(relative.isErr()).toBe(true);
    const missing = await prepareDesktopDataApp({
      workspaceRoot: workspace,
      worksheetFile: join(cache, 'sheet.xml'),
      templatePackageDir: template,
      datappName: 'Sales Demo',
      worksheetId: '{SHEET-GUID-1}',
      datasourceId: 'not-a-source',
      datasources,
      worksheets,
    });
    expect(missing.isErr()).toBe(true);
    if (missing.isOk()) return;
    expect(missing.error.message).toContain('not-a-source');
    expect(missing.error.message).toContain('Available:');
  });
});
