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
import { DesktopTool } from '../tool.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getStoryboardXmlTool } from './getStoryboardXml.js';

vi.mock('../../../desktop/session/sessionResolution.js');

describe('External API coverage tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('gets a storyboard document by name after resolving it to an id', async () => {
    const harness = await startHarness(getStoryboardXmlTool);
    try {
      // A storyboard serializes as a `<dashboard type="storyboard">`; its /document route returns
      // that bare fragment directly, so the tool returns it as-is.
      const result = await harness.callTool({ storyboardName: 'QBR Story', mode: 'inline' });

      expect(result.isError).toBe(false);
      const storyboardXml = z
        .object({ storyboardXml: z.string() })
        .parse(parseResult(result)).storyboardXml;
      expect(storyboardXml).toContain('name="QBR Story"');
      expect(storyboardXml).toContain('type="storyboard"');
      expect(harness.server.requests.map((request) => request.path)).toEqual([
        '/v0/workbook/storyboards',
        '/v0/workbook/storyboards/story-qbr/document',
      ]);
    } finally {
      await harness.close();
    }
  });

  it.each([
    {
      makeTool: getStoryboardXmlTool,
      args: { storyboardName: 'story-qbr' },
      overrideKey: 'GET /v0/workbook/storyboards/story-qbr/document',
      expectedMessage: 'does not serve the storyboard document endpoint',
    },
  ])(
    '$toolName reports an honest too-new endpoint 404',
    async ({ makeTool, args, overrideKey, expectedMessage }) => {
      const harness = await startHarness(makeTool, (server) => {
        server.setOverride(overrideKey, {
          status: 404,
          body: JSON.stringify({
            code: 'not-found',
            status: 404,
            instance: '/v0/mock',
            title: `No route matches ${overrideKey}`,
            detail: `No route matches ${overrideKey}`,
          }),
        });
      });
      try {
        const result = await harness.callTool(args);

        expect(result.isError).toBe(true);
        invariant(result.content[0].type === 'text');
        expect(result.content[0].text).toContain(expectedMessage);
        expect(result.content[0].text).toContain('Do not retry');
      } finally {
        await harness.close();
      }
    },
  );
});

async function startHarness(
  makeTool: (server: DesktopMcpServer) => DesktopTool<any>,
  configure?: (server: MockExternalApiServer) => void,
): Promise<{
  server: MockExternalApiServer;
  callTool: (args: Record<string, unknown>) => Promise<CallToolResult>;
  close: () => Promise<void>;
}> {
  const server = await startMockExternalApiServer();
  configure?.(server);
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
    instanceId: 'inst-external-api-tools',
    apiVersion: '1.0',
  };
}

function parseResult(result: CallToolResult): unknown {
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text);
}
