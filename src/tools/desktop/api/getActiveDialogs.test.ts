import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import {
  MockExternalApiServer,
  startMockExternalApiServer,
} from '../../../desktop/externalApi/mockExternalApiServer.js';
import { DialogList, ExternalApiInstance } from '../../../desktop/externalApi/types.js';
import * as sessionResolution from '../../../desktop/session/sessionResolution.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getActiveDialogsTool } from './getActiveDialogs.js';

vi.mock('../../../desktop/session/sessionResolution.js');

const completeDialogList: DialogList = {
  dialogs: [
    {
      objectName: 'saveChangesDialog',
      title: 'Save Changes',
      className: 'QMessageBox',
      messageText: 'Save the workbook?',
      informativeText: 'Unsaved work may be lost.',
      detailedText: 'Workbook: Regional Sales',
      detailedTextTruncated: true,
      iconLevel: 'warning',
      buttons: ['Save', 'Discard', 'Cancel'],
      actions: [
        { kind: 'button', label: 'Save' },
        { kind: 'button', label: 'Discard' },
        { kind: 'button', label: 'Cancel' },
      ],
    },
    {
      objectName: '',
      title: 'Second dialog',
      className: 'QDialog',
      buttons: ['  Keep spaces  ', 'Café'],
      actions: [
        { kind: 'button', label: '  Keep spaces  ' },
        { kind: 'button', label: 'Café' },
        { kind: 'close' },
      ],
    },
  ],
};

describe('get-active-dialogs tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('declares the read contract and 0.2.13 API floor', () => {
    const tool = getActiveDialogsTool(new DesktopMcpServer());

    expect(tool.name).toBe('get-active-dialogs');
    expect(tool.minApiVersion).toBe('0.2.13');
    expect(tool.description).toContain('visible message and diagnostic text');
    expect(tool.description).toContain('semantic actions such as close');
    expect(tool.paramsSchema).toMatchObject({ session: expect.any(Object) });
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it.each([
    ['an optional unique session', undefined, '101'],
    ['a pinned session', undefined, '202'],
    ['an explicit session', '303', '303'],
  ])('forwards %s through canonical session resolution', async (_label, session, resolved) => {
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok(resolved));
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ session });

      expect(result.isError).toBe(false);
      expect(sessionResolution.resolveSession).toHaveBeenCalledWith(session);
      expect(harness.extra.getExecutor).toHaveBeenCalledWith(resolved);
    } finally {
      await harness.close();
    }
  });

  it('preserves dialog order, button order, all optional fields, and required-only items', async () => {
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
    const harness = await startHarness();
    harness.server.setOverride('GET /v0/app/dialogs', {
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(completeDialogList),
    });

    try {
      const result = await harness.callTool({ session: undefined });

      expect(result.isError).toBe(false);
      expect(parseResult(result)).toEqual(completeDialogList);
      expect(dialogGets(harness.server)).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });

  it('returns an explicit empty dialog list unchanged', async () => {
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
    const harness = await startHarness();
    harness.server.setOverride('GET /v0/app/dialogs', {
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ dialogs: [] }),
    });

    try {
      const result = await harness.callTool({ session: undefined });

      expect(result.isError).toBe(false);
      expect(parseResult(result)).toEqual({ dialogs: [] });
      expect(dialogGets(harness.server)).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });

  it('maps a translated stable 404 to the endpoint-unavailable read error', async () => {
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
    const harness = await startHarness();
    harness.server.setOverride('GET /v0/app/dialogs', {
      status: 404,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        type: 'problem',
        title: 'Introuvable',
        status: 404,
        instance: '/v0/app/dialogs',
        code: 'not-found',
        detail: 'Aucune route ne correspond à GET /v0/app/dialogs',
      }),
    });

    try {
      const result = await harness.callTool({ session: undefined });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('active dialogs endpoint');
      expect(result.content[0].text).toContain('too old for this read');
      expect(result.content[0].text).toContain('Do not retry');
      expect(dialogGets(harness.server)).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });
});

function dialogGets(server: MockExternalApiServer): MockExternalApiServer['requests'] {
  return server.requests.filter(
    (request) => request.method === 'GET' && request.path === '/v0/app/dialogs',
  );
}

function parseResult(result: CallToolResult): DialogList {
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text) as DialogList;
}

async function startHarness(): Promise<{
  server: MockExternalApiServer;
  extra: ReturnType<typeof getMockRequestHandlerExtra>;
  callTool: (args: { session: string | undefined }) => Promise<CallToolResult>;
  close: () => Promise<void>;
}> {
  const server = await startMockExternalApiServer();
  const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
  await executor.start();
  const tool = getActiveDialogsTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: vi.fn().mockResolvedValue(executor),
  };

  return {
    server,
    extra,
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
    instanceId: 'inst-get-active-dialogs',
    apiVersion: '0.2.13',
  };
}
