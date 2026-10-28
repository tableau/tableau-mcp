import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

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
import { getRenameSheetTool } from './renameSheet.js';

vi.mock('../../../desktop/session/sessionResolution.js');

const WORKSHEET_NAME = 'Sales by Region';

describe('rename-sheet tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('reports the old and new names after a real rename', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ sheet: WORKSHEET_NAME, name: 'Regional Sales' });
      expect(result.isError).toBeFalsy();
      expect(messageOf(result)).toBe('Renamed worksheet "Sales by Region" to "Regional Sales".');
    } finally {
      await harness.close();
    }
  });

  it('says nothing was renamed when the name matches the current one', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ sheet: WORKSHEET_NAME, name: WORKSHEET_NAME });
      expect(result.isError).toBeFalsy();
      const message = messageOf(result);
      expect(message).toContain('already named "Sales by Region"');
      expect(message).not.toContain('Renamed');
    } finally {
      await harness.close();
    }
  });

  it('treats a name that differs only by surrounding whitespace as unchanged', async () => {
    const tool = getRenameSheetTool(new DesktopMcpServer());
    const paramsSchema = z.object(await Provider.from(tool.paramsSchema));
    const args = paramsSchema.parse({ sheet: WORKSHEET_NAME, name: `  ${WORKSHEET_NAME} ` });
    const harness = await startHarness();
    try {
      const result = await harness.callTool(args);
      expect(messageOf(result)).toContain('nothing was renamed');
    } finally {
      await harness.close();
    }
  });

  it('rejects a blank name before calling Desktop', async () => {
    const tool = getRenameSheetTool(new DesktopMcpServer());
    const paramsSchema = await Provider.from(tool.paramsSchema);
    expect(paramsSchema.name.safeParse('   ').success).toBe(false);
    expect(paramsSchema.name.safeParse('').success).toBe(false);
  });

  it('returns an error when the sheet does not exist', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ sheet: 'No Such Sheet', name: 'Anything' });
      expect(result.isError).toBe(true);
      expect(harness.server.requests.filter((r) => r.path.endsWith(':rename'))).toHaveLength(0);
    } finally {
      await harness.close();
    }
  });
});

function messageOf(result: CallToolResult): string {
  invariant(result.content[0].type === 'text');
  return (JSON.parse(result.content[0].text) as { message: string }).message;
}

async function startHarness(): Promise<{
  server: MockExternalApiServer;
  callTool: (args: Record<string, unknown>) => Promise<CallToolResult>;
  close: () => Promise<void>;
}> {
  const server = await startMockExternalApiServer();
  const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
  await executor.start();
  const tool = getRenameSheetTool(new DesktopMcpServer());
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
    instanceId: 'inst-rename-sheet',
    apiVersion: '0.2.4',
  };
}
