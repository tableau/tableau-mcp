import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { mkdtemp, readFile, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getDeployDataAppTool, redactSecrets } from './deployDataApp.js';
import { getScaffoldDataAppTool } from './scaffoldDataApp.js';

describe('deployDataAppTool', () => {
  let baseDir: string;
  let downloadsDir: string;

  beforeEach(async () => {
    stubDefaultEnvVars();
    baseDir = await mkdtemp(join(tmpdir(), 'tmcp-deploy-apps-'));
    downloadsDir = await mkdtemp(join(tmpdir(), 'tmcp-deploy-dl-'));
    vi.stubEnv('TABLEAU_DATA_APPS_DIR', baseDir);
    vi.stubEnv('TABLEAU_DOWNLOADS_DIR', downloadsDir);
    // Stub the deploy health check so tests don't hit the network.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200 } as unknown as Response),
    );
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(baseDir, { recursive: true, force: true });
    await rm(downloadsDir, { recursive: true, force: true });
  });

  it('finalizes the .trex and writes it to Downloads when appUrl is provided', async () => {
    await scaffold('Deploy Me');
    const appDir = join(baseDir, 'deploy-me');

    const result = await runDeploy({ appDir, appUrl: 'https://deploy-me.herokuapp.com' });
    expect(result.isError).toBeFalsy();

    const downloadPath = join(downloadsDir, 'deploy-me.trex');
    expect((await stat(downloadPath)).isFile()).toBe(true);

    const trex = await readFile(downloadPath, 'utf-8');
    // The .trex points at the hosted URL; the resource list lives in the deployed
    // bundle (dataapp.json / config.js), so it is NOT bloating the URL.
    expect(trex).toContain('<url>https://deploy-me.herokuapp.com/</url>');
    expect(trex).not.toContain('resources=');
    expect(trex).not.toContain('REPLACE_AT_DEPLOY_TIME');

    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(downloadPath);
    // Verifies the live app and reports the shipped manifest.
    expect(result.content[0].text).toContain('Health check: OK');
    expect(result.content[0].text).toContain('Shipped');
    expect(result.content[0].text).toContain('server.js');
    expect(fetch).toHaveBeenCalledWith(
      'https://deploy-me.herokuapp.com/healthz',
      expect.anything(),
    );
  });

  it('redacts PAT_VALUE and secret-shaped values from log lines', () => {
    expect(redactSecrets('heroku config:set PAT_VALUE=abc123 -a my-app')).toBe(
      'heroku config:set PAT_VALUE=<redacted> -a my-app',
    );
    expect(redactSecrets('CONNECTED_APP_SECRET=xyz OTHER=keep')).toBe(
      'CONNECTED_APP_SECRET=<redacted> OTHER=keep',
    );
    expect(redactSecrets('PAT_NAME=svc-account')).toBe('PAT_NAME=svc-account');
  });

  it('errors when backend is manual and no appUrl is given', async () => {
    await scaffold('No Url');
    const appDir = join(baseDir, 'no-url');
    const result = await runDeploy({ appDir, backend: 'manual' });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('requires appUrl');
  });

  it('errors when appDir is not a directory', async () => {
    const result = await runDeploy({
      appDir: join(baseDir, 'does-not-exist'),
      appUrl: 'https://x.example.com',
    });
    expect(result.isError).toBe(true);
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

async function runDeploy(args: {
  appDir: string;
  appUrl?: string;
  backend?: 'heroku' | 'manual';
}): Promise<CallToolResult> {
  const tool = getDeployDataAppTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    {
      appDir: args.appDir,
      backend: args.backend,
      appUrl: args.appUrl,
      herokuAppName: undefined,
      queryEndpoint: undefined,
    },
    getMockRequestHandlerExtra(),
  );
}
