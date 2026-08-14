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
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getWorkbookExportAsTool } from './workbookExportAs.js';

vi.mock('../../../desktop/session/sessionResolution.js');

const EXPORT_AS_PATH = '/v0/workbook:exportAs';

function messageOf(result: CallToolResult): string {
  invariant(result.content[0].type === 'text');
  return (JSON.parse(result.content[0].text) as { message: string }).message;
}

function exportPosts(server: MockExternalApiServer): Array<{ body: string }> {
  return server.requests.filter((r) => r.method === 'POST' && r.path === EXPORT_AS_PATH);
}

describe('workbook-export-as tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('exports a pdf: POSTs format + filePath (no targetVersion) and reports the written path', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ format: 'pdf', filePath: '/Users/me/Book.pdf' });
      expect(result.isError).toBeFalsy();
      expect(messageOf(result)).toBe('Exported the workbook to "/Users/me/Book.pdf".');

      const posted = exportPosts(harness.server);
      expect(posted).toHaveLength(1);
      expect(JSON.parse(posted[0].body)).toEqual({ format: 'pdf', filePath: '/Users/me/Book.pdf' });
    } finally {
      await harness.close();
    }
  });

  it('exports a prior version: forwards targetVersion in the body', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({
        format: 'prior-version',
        filePath: '/Users/me/Old.twbx',
        targetVersion: '2024.1',
      });
      expect(result.isError).toBeFalsy();
      expect(messageOf(result)).toBe('Exported the workbook to "/Users/me/Old.twbx".');

      const posted = exportPosts(harness.server);
      expect(posted).toHaveLength(1);
      expect(JSON.parse(posted[0].body)).toEqual({
        format: 'prior-version',
        filePath: '/Users/me/Old.twbx',
        targetVersion: '2024.1',
      });
    } finally {
      await harness.close();
    }
  });

  it('refuses a prior-version export with no targetVersion and never calls the API', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({
        format: 'prior-version',
        filePath: '/Users/me/Old.twbx',
      });
      expect(result.isError).toBeFalsy();
      expect(messageOf(result)).toBe(
        'Exporting to a prior version requires targetVersion (e.g. "2024.1").',
      );
      expect(exportPosts(harness.server)).toHaveLength(0);
    } finally {
      await harness.close();
    }
  });

  it('surfaces the server error when the extension does not match the format', async () => {
    const harness = await startHarness();
    try {
      // .pdf with format powerpoint trips the host's extension↔format matrix (400).
      const result = await harness.callTool({
        format: 'powerpoint',
        filePath: '/Users/me/Book.pdf',
      });
      expect(result.isError).toBe(true);

      // The request was still dispatched — the rejection is the server's, not a pre-flight guard.
      expect(exportPosts(harness.server)).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });
});

async function startHarness(): Promise<{
  server: MockExternalApiServer;
  callTool: (args: Record<string, unknown>) => Promise<CallToolResult>;
  close: () => Promise<void>;
}> {
  const server = await startMockExternalApiServer();
  const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
  await executor.start();
  const tool = getWorkbookExportAsTool(new DesktopMcpServer());
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
    instanceId: 'inst-export',
    apiVersion: '1.0',
  };
}
