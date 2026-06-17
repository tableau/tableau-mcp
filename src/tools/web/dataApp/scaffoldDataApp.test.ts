import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { mkdtemp, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { DataAppResource } from './dataAppShared.js';
import { getScaffoldDataAppTool } from './scaffoldDataApp.js';

type ScaffoldArgs = {
  appName: string;
  datasourceLuid?: string;
  resources?: DataAppResource[];
  framework?: 'html' | 'react';
  appTitle?: string;
  outDir?: string;
  overwrite?: boolean;
};

function fullArgs(args: ScaffoldArgs): Required<{
  appName: string;
  datasourceLuid: string | undefined;
  resources: DataAppResource[] | undefined;
  framework: 'html' | 'react' | undefined;
  appTitle: string | undefined;
  outDir: string | undefined;
  overwrite: boolean | undefined;
}> {
  return {
    appName: args.appName,
    datasourceLuid: args.datasourceLuid,
    resources: args.resources,
    framework: args.framework,
    appTitle: args.appTitle,
    outDir: args.outDir,
    overwrite: args.overwrite,
  };
}

describe('scaffoldDataAppTool', () => {
  let baseDir: string;

  beforeEach(async () => {
    stubDefaultEnvVars();
    baseDir = await mkdtemp(join(tmpdir(), 'tmcp-scaffold-'));
    vi.stubEnv('TABLEAU_DATA_APPS_DIR', baseDir);
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it('has the expected name and is not read-only', async () => {
    const tool = getScaffoldDataAppTool(new WebMcpServer());
    const annotations = await Provider.from(tool.annotations);
    expect(tool.name).toBe('scaffold-data-app');
    expect(annotations?.readOnlyHint).toBe(false);
  });

  it('writes the project skeleton to disk', async () => {
    const result = await runScaffold({ appName: 'Sales Overview', datasourceLuid: 'ds-1' });
    expect(result.isError).toBeFalsy();

    const appDir = join(baseDir, 'sales-overview');
    for (const rel of [
      'index.html',
      'src/app.js',
      'src/tableauData.js',
      'src/config.js',
      'server.js',
      'dataapp.json',
      'manifest.trex',
    ]) {
      expect((await stat(join(appDir, rel))).isFile()).toBe(true);
    }

    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(appDir);
  });

  it('accepts an arbitrary array of mixed-type resources', async () => {
    const result = await runScaffold({
      appName: 'Multi Source',
      resources: [
        { type: 'datasource', luid: 'ds-1', name: 'primary' },
        { type: 'view', luid: 'v-1' },
        { type: 'workbook', luid: 'wb-1' },
        { type: 'metric', luid: 'm-1' },
      ],
    });
    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toMatch(/4 resource/);
  });

  it('rejects an outDir that does not exist on this machine (sandbox path)', async () => {
    const result = await runScaffold({
      appName: 'Sandbox Path',
      datasourceLuid: 'ds-1',
      outDir: '/home/user/some-nonexistent-root-xyz/app',
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('not your sandbox');
    expect(result.content[0].text).toContain('Omit outDir');
  });

  it('errors when neither datasourceLuid nor resources are provided', async () => {
    const result = await runScaffold({ appName: 'No Resources' });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toMatch(/resources/i);
  });

  it('refuses to scaffold over an existing non-empty directory', async () => {
    await runScaffold({ appName: 'Dupe', datasourceLuid: 'ds-1' });
    const second = await runScaffold({ appName: 'Dupe', datasourceLuid: 'ds-1' });
    expect(second.isError).toBe(true);
    invariant(second.content[0].type === 'text');
    expect(second.content[0].text).toContain('overwrite');
  });

  it('scaffolds over an existing directory when overwrite is true', async () => {
    await runScaffold({ appName: 'Dupe', datasourceLuid: 'ds-1' });
    const second = await runScaffold({ appName: 'Dupe', datasourceLuid: 'ds-1', overwrite: true });
    expect(second.isError).toBeFalsy();
  });

  it('rejects passthrough authentication', async () => {
    const tool = getScaffoldDataAppTool(new WebMcpServer());
    const callback = await Provider.from(tool.callback);
    const extra = getMockRequestHandlerExtra();
    extra.tableauAuthInfo = {
      type: 'Passthrough',
      username: 'u',
      userId: 'id',
      server: 'https://my-tableau-server.com',
      siteId: 'site',
      raw: 'session-token',
    };
    const result = await callback(fullArgs({ appName: 'Blocked', datasourceLuid: 'ds-1' }), extra);
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('passthrough');
  });
});

async function runScaffold(args: ScaffoldArgs): Promise<CallToolResult> {
  const tool = getScaffoldDataAppTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(fullArgs(args), getMockRequestHandlerExtra());
}
