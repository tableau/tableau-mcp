import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getWriteDataAppFileTool } from './dataAppFiles.js';
import { getPackageDataAppTool } from './packageDataApp.js';
import { getScaffoldDataAppTool } from './scaffoldDataApp.js';

describe('packageDataAppTool', () => {
  let baseDir: string;

  beforeEach(async () => {
    stubDefaultEnvVars();
    baseDir = await mkdtemp(join(tmpdir(), 'tmcp-package-'));
    vi.stubEnv('TABLEAU_DATA_APPS_DIR', baseDir);
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it('packages a freshly scaffolded app as ready', async () => {
    await scaffold('Clean App');
    const appDir = join(baseDir, 'clean-app');
    const result = await runPackage(appDir);
    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('ready to deploy');
  });

  it('reads and reports a multi-resource manifest', async () => {
    const tool = getScaffoldDataAppTool(new WebMcpServer());
    const callback = await Provider.from(tool.callback);
    await callback(
      {
        appName: 'Multi App',
        datasourceLuid: undefined,
        resources: [
          { type: 'datasource', luid: 'ds-9', name: 'primary' },
          { type: 'view', luid: 'v-9', name: 'trend' },
        ],
        framework: undefined,
        appTitle: undefined,
        outDir: undefined,
        overwrite: undefined,
      },
      getMockRequestHandlerExtra(),
    );
    const result = await runPackage(join(baseDir, 'multi-app'));
    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('ds-9');
    expect(result.content[0].text).toContain('v-9');
  });

  it('packages even when the app inlines data (no hardcoded-data gate)', async () => {
    await scaffold('Inline App');
    const appDir = join(baseDir, 'inline-app');
    const writeTool = getWriteDataAppFileTool(new WebMcpServer());
    const writeCallback = await Provider.from(writeTool.callback);
    await writeCallback(
      {
        appDir,
        path: 'src/app.js',
        content: 'const data = [{ a: 1 }, { a: 2 }, { a: 3 }]; render(data);',
        allowProtected: undefined,
      },
      getMockRequestHandlerExtra(),
    );
    const result = await runPackage(appDir);
    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('ready to deploy');
  });

  it('errors when appDir is missing required files', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'tmcp-empty-'));
    try {
      const result = await runPackage(empty);
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('Missing required file');
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});

async function scaffold(appName: string): Promise<void> {
  const tool = getScaffoldDataAppTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  await callback(
    {
      appName,
      datasourceLuid: 'ds-1',
      resources: undefined,
      framework: undefined,
      appTitle: undefined,
      outDir: undefined,
      overwrite: undefined,
    },
    getMockRequestHandlerExtra(),
  );
}

async function runPackage(appDir: string): Promise<CallToolResult> {
  const tool = getPackageDataAppTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback({ appDir }, getMockRequestHandlerExtra());
}
