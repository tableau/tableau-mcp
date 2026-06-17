import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import {
  getListDataAppFilesTool,
  getReadDataAppFileTool,
  getWriteDataAppFileTool,
} from './dataAppFiles.js';

describe('data app file tools', () => {
  let appDir: string;

  beforeEach(async () => {
    stubDefaultEnvVars();
    appDir = await mkdtemp(join(tmpdir(), 'tmcp-files-'));
  });

  afterEach(async () => {
    await rm(appDir, { recursive: true, force: true });
  });

  describe('write-data-app-file', () => {
    it('has the expected name and is not read-only', async () => {
      const tool = getWriteDataAppFileTool(new WebMcpServer());
      const annotations = await Provider.from(tool.annotations);
      expect(tool.name).toBe('write-data-app-file');
      expect(annotations?.readOnlyHint).toBe(false);
    });

    it('writes a file and creates parent directories', async () => {
      const result = await runWrite({ appDir, path: 'src/app.js', content: 'console.log(1);' });
      expect(result.isError).toBeFalsy();
      expect(await readFile(join(appDir, 'src/app.js'), 'utf-8')).toBe('console.log(1);');
    });

    it('rejects paths that escape the app directory', async () => {
      const result = await runWrite({ appDir, path: '../escape.js', content: 'x' });
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('within the app directory');
    });

    it('rejects absolute paths', async () => {
      const result = await runWrite({ appDir, path: '/etc/passwd', content: 'x' });
      expect(result.isError).toBe(true);
    });

    it('protects toolchain-managed files by default', async () => {
      const result = await runWrite({
        appDir,
        path: 'src/tableauData.js',
        content: 'malicious',
      });
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('toolchain-managed');
    });

    it('allows overwriting protected files with allowProtected', async () => {
      const result = await runWrite({
        appDir,
        path: 'server.js',
        content: '// custom',
        allowProtected: true,
      });
      expect(result.isError).toBeFalsy();
      expect(await readFile(join(appDir, 'server.js'), 'utf-8')).toBe('// custom');
    });

    it('errors when appDir is not a directory', async () => {
      const result = await runWrite({
        appDir: join(appDir, 'nope'),
        path: 'a.js',
        content: 'x',
      });
      expect(result.isError).toBe(true);
    });
  });

  describe('read-data-app-file', () => {
    it('reads a file back', async () => {
      await mkdir(join(appDir, 'src'), { recursive: true });
      await writeFile(join(appDir, 'src/app.js'), 'hello', 'utf-8');
      const result = await runRead({ appDir, path: 'src/app.js' });
      expect(result.isError).toBeFalsy();
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toBe('hello');
    });

    it('errors for a missing file', async () => {
      const result = await runRead({ appDir, path: 'missing.js' });
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('File not found');
    });

    it('rejects traversal paths', async () => {
      const result = await runRead({ appDir, path: '../../secret' });
      expect(result.isError).toBe(true);
    });
  });

  describe('list-data-app-files', () => {
    it('lists files and skips node_modules/.git', async () => {
      await mkdir(join(appDir, 'src'), { recursive: true });
      await mkdir(join(appDir, 'node_modules/pkg'), { recursive: true });
      await mkdir(join(appDir, '.git'), { recursive: true });
      await writeFile(join(appDir, 'index.html'), '<html></html>', 'utf-8');
      await writeFile(join(appDir, 'src/app.js'), 'x', 'utf-8');
      await writeFile(join(appDir, 'node_modules/pkg/index.js'), 'y', 'utf-8');
      await writeFile(join(appDir, '.git/config'), 'z', 'utf-8');

      const result = await runList({ appDir });
      expect(result.isError).toBeFalsy();
      invariant(result.content[0].type === 'text');
      const text = result.content[0].text;
      expect(text).toContain('index.html');
      expect(text).toContain('src/app.js');
      expect(text).not.toContain('node_modules');
      expect(text).not.toContain('.git/config');
    });
  });

  it('all three tools reject passthrough authentication', async () => {
    const extra = getMockRequestHandlerExtra();
    extra.tableauAuthInfo = {
      type: 'Passthrough',
      username: 'u',
      userId: 'id',
      server: 'https://my-tableau-server.com',
      siteId: 'site',
      raw: 'session-token',
    };

    const write = await Provider.from(getWriteDataAppFileTool(new WebMcpServer()).callback);
    const read = await Provider.from(getReadDataAppFileTool(new WebMcpServer()).callback);
    const list = await Provider.from(getListDataAppFilesTool(new WebMcpServer()).callback);

    for (const result of [
      await write({ appDir, path: 'a.js', content: 'x', allowProtected: undefined }, extra),
      await read({ appDir, path: 'a.js' }, extra),
      await list({ appDir }, extra),
    ]) {
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('passthrough');
    }
  });
});

async function runWrite(args: {
  appDir: string;
  path: string;
  content: string;
  allowProtected?: boolean;
}): Promise<CallToolResult> {
  const tool = getWriteDataAppFileTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    {
      appDir: args.appDir,
      path: args.path,
      content: args.content,
      allowProtected: args.allowProtected,
    },
    getMockRequestHandlerExtra(),
  );
}

async function runRead(args: { appDir: string; path: string }): Promise<CallToolResult> {
  const tool = getReadDataAppFileTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback({ appDir: args.appDir, path: args.path }, getMockRequestHandlerExtra());
}

async function runList(args: { appDir: string }): Promise<CallToolResult> {
  const tool = getListDataAppFilesTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback({ appDir: args.appDir }, getMockRequestHandlerExtra());
}
