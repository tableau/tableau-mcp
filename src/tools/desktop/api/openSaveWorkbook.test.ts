import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import {
  MockExternalApiServer,
  startMockExternalApiServer,
} from '../../../desktop/externalApi/mockExternalApiServer.js';
import { ExternalApiInstance } from '../../../desktop/externalApi/types.js';
import * as sessionResolution from '../../../desktop/session/sessionResolution.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { DesktopTool } from '../tool.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getOpenFileTool } from './openFile.js';
import { getSaveWorkbookTool } from './saveWorkbook.js';

vi.mock('../../../desktop/session/sessionResolution.js');

function messageOf(result: CallToolResult): string {
  invariant(result.content[0].type === 'text');
  return (JSON.parse(result.content[0].text) as { message: string }).message;
}

describe('open-file / save-workbook tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('open-file POSTs the absolute path and reports success', async () => {
    const harness = await startHarness(getOpenFileTool);
    try {
      const result = await harness.callTool({ filePath: '/Users/me/Book.twbx' });
      expect(result.isError).toBeFalsy();
      expect(messageOf(result)).toBe('Opened "/Users/me/Book.twbx".');

      const posted = harness.server.requests.filter(
        (r) => r.method === 'POST' && r.path === '/v0/app:openFile',
      );
      expect(posted).toHaveLength(1);
      expect(JSON.parse(posted[0].body)).toEqual({ filePath: '/Users/me/Book.twbx' });
    } finally {
      await harness.close();
    }
  });

  it('save-workbook without a path saves in place with an empty body', async () => {
    const harness = await startHarness(getSaveWorkbookTool);
    try {
      setSaved(harness.server);
      const result = await harness.callTool({});
      expect(result.isError).toBeFalsy();
      expect(messageOf(result)).toBe('Saved the open workbook.');

      const posted = harness.server.requests.filter(
        (r) => r.method === 'POST' && r.path === '/v0/workbook:save',
      );
      expect(posted).toHaveLength(1);
      expect(JSON.parse(posted[0].body)).toEqual({});
    } finally {
      await harness.close();
    }
  });

  it('save-workbook with a path saves a copy there', async () => {
    const harness = await startHarness(getSaveWorkbookTool);
    try {
      setSaved(harness.server);
      const result = await harness.callTool({ filePath: '/Users/me/Copy.twbx' });
      expect(result.isError).toBeFalsy();
      expect(messageOf(result)).toBe('Saved a copy to "/Users/me/Copy.twbx".');

      const posted = harness.server.requests.filter(
        (r) => r.method === 'POST' && r.path === '/v0/workbook:save',
      );
      expect(posted).toHaveLength(1);
      expect(JSON.parse(posted[0].body)).toEqual({ filePath: '/Users/me/Copy.twbx' });
    } finally {
      await harness.close();
    }
  });

  it('save-workbook reports an in place save that left unsaved changes as an error', async () => {
    const harness = await startHarness(getSaveWorkbookTool);
    try {
      setUnsaved(harness.server);
      const result = await harness.callTool({});
      expect(result.isError).toBe(true);
      const message = messageOf(result);
      expect(message).toContain('The save did not complete');
      expect(message).toContain('A Save dialog may have been dismissed');
      expect(message).toContain('Do not retry without filePath unless the user is at the machine');
      expect(message).not.toContain('Saved the open workbook');
      expect(result.structuredContent).toMatchObject({ nextAction: { kind: 'prefill' } });
      expect(result.structuredContent).toMatchObject({
        message: expect.stringContaining('did not complete'),
      });
    } finally {
      await harness.close();
    }
  });

  it('save-workbook with a path trusts the completed status even when the workbook stays dirty', async () => {
    const harness = await startHarness(getSaveWorkbookTool);
    try {
      setUnsaved(harness.server);
      const result = await harness.callTool({ filePath: '/Users/me/Copy.twbx' });
      expect(result.isError).toBeFalsy();
      expect(messageOf(result)).toBe('Saved a copy to "/Users/me/Copy.twbx".');
    } finally {
      await harness.close();
    }
  });

  it('save-workbook is marked destructive because an in place save overwrites the file', () => {
    expect(getSaveWorkbookTool(new DesktopMcpServer()).annotations).toMatchObject({
      destructiveHint: true,
    });
  });
});

function setWorkbookUnsavedChanges(server: MockExternalApiServer, unsavedChanges: boolean): void {
  server.setOverride('GET /v0/workbook', {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ title: 'Book1', unsavedChanges }),
  });
}
const setSaved = (server: MockExternalApiServer): void => setWorkbookUnsavedChanges(server, false);
const setUnsaved = (server: MockExternalApiServer): void => setWorkbookUnsavedChanges(server, true);

async function startHarness(makeTool: (server: DesktopMcpServer) => DesktopTool<any>): Promise<{
  server: MockExternalApiServer;
  callTool: (args: Record<string, unknown>) => Promise<CallToolResult>;
  close: () => Promise<void>;
}> {
  const server = await startMockExternalApiServer();
  const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
  await executor.start();
  const tool = makeTool(new DesktopMcpServer());
  const callback = (await Provider.from(tool.callback)) as (
    args: Record<string, unknown>,
    extra: ReturnType<typeof getMockRequestHandlerExtra>,
  ) => Promise<CallToolResult>;
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: vi.fn().mockResolvedValue(executor),
  };

  return {
    server,
    callTool: async (args) => await callback(args, extra),
    close: async () => {
      executor.stop();
      await server.close();
    },
  };
}

function instanceFor(server: MockExternalApiServer): ExternalApiInstance {
  return {
    baseUrl: server.baseUrl,
    token: 'valid-token',
    pid: 999,
    instanceId: 'inst-open-save',
    apiVersion: '1.0',
  };
}
