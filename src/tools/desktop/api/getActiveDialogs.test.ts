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
      sessionId: 'session-save',
      revision: 1,
      family: 'qt',
      status: 'active',
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
      sessionId: 'session-second',
      revision: 2,
      family: 'file',
      mode: 'open-file',
      status: 'active',
      buttons: ['  Keep spaces  ', 'Café'],
      actions: [
        { kind: 'button', label: '  Keep spaces  ' },
        { kind: 'button', label: 'Café' },
        { kind: 'close' },
      ],
    },
    {
      objectName: 'formatDialog',
      title: 'Choose Color',
      className: 'QColorDialog',
      sessionId: 'session-color',
      revision: 3,
      family: 'color',
      status: 'active',
      actions: [{ kind: 'choose-color', alphaSupported: true }],
    },
    {
      objectName: 'sourceFileDialog',
      title: 'Locate data source',
      className: 'QFileDialog',
      sessionId: 'session-file',
      revision: 4,
      family: 'file',
      mode: 'save-file',
      status: 'active',
      actions: [
        {
          kind: 'choose-file',
          filters: [{ id: 'tds', label: 'Data source', patterns: ['*.tds'] }],
          defaultFilterId: 'tds',
        },
        {
          kind: 'save-file',
          filters: [{ id: 'twb', label: 'Workbook', patterns: ['*.twb'] }],
          defaultFilterId: 'twb',
          overwriteConfirmationRequired: false,
        },
      ],
    },
    {
      objectName: 'printDialog',
      title: 'Print',
      className: 'QPrintDialog',
      sessionId: 'session-print',
      revision: 5,
      family: 'print',
      status: 'active',
      actions: [
        {
          kind: 'submit-print',
          printers: [{ id: 'printer-1', label: 'Office printer' }],
          minimumPage: 0,
          maximumPage: 10,
          minimumCopies: 1,
          maximumCopies: 5,
          ranges: ['all-pages', 'page-range'],
          sheetScopes: ['entire-workbook', 'active-sheet'],
          supportsCollation: true,
          supportsPrintToFile: true,
          supportsExportSelection: true,
        },
      ],
    },
  ],
  uiSnapshotAvailable: true,
  recentActions: [],
};

describe('get-active-dialogs tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('declares the read contract and 0.2.23 API floor', () => {
    const tool = getActiveDialogsTool(new DesktopMcpServer());

    expect(tool.name).toBe('get-active-dialogs');
    expect(tool.minApiVersion).toBe('0.2.23');
    expect(tool.description).toContain('Only active dialogs advertise actions');
    expect(tool.description).toContain('recentActions');
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

  it('preserves dialog data and returns invocation fields for native action capabilities', async () => {
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
    const harness = await startHarness('0.2.23');
    harness.server.setOverride('GET /v0/app/dialogs', {
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(completeDialogList),
    });

    try {
      const result = await harness.callTool({ session: undefined });

      expect(result.isError).toBe(false);
      const dialogs = parseResult(result);
      expect(dialogs).toMatchObject(completeDialogList);
      expect(dialogs.dialogs[2].actions).toEqual([
        {
          kind: 'choose-color',
          alphaSupported: true,
          input: {
            fields: [
              { name: 'red', type: 'integer', required: true, minimum: 0, maximum: 255 },
              { name: 'green', type: 'integer', required: true, minimum: 0, maximum: 255 },
              { name: 'blue', type: 'integer', required: true, minimum: 0, maximum: 255 },
              { name: 'alpha', type: 'integer', required: false, minimum: 0, maximum: 255 },
            ],
          },
        },
      ]);
      expect(dialogs.dialogs[3].actions).toEqual([
        expect.objectContaining({
          kind: 'choose-file',
          input: {
            fields: [
              { name: 'path', type: 'string', required: true },
              { name: 'filterId', type: 'string', required: false },
            ],
          },
        }),
        expect.objectContaining({
          kind: 'save-file',
          overwriteConfirmationRequired: false,
          input: {
            fields: [
              { name: 'path', type: 'string', required: true },
              { name: 'filterId', type: 'string', required: true },
              {
                name: 'overwriteConfirmed',
                type: 'boolean',
                required: true,
                condition: 'true when the final destination exists',
              },
            ],
          },
        }),
      ]);
      expect(dialogs.dialogs[4].actions).toEqual([
        expect.objectContaining({
          kind: 'submit-print',
          input: {
            fields: expect.arrayContaining([
              { name: 'printerId', type: 'string', required: true },
              {
                name: 'range',
                type: 'string',
                required: true,
                allowedValues: ['all-pages', 'page-range', 'current-page', 'selection'],
              },
              {
                name: 'sheetScope',
                type: 'string',
                required: true,
                allowedValues: ['entire-workbook', 'active-sheet', 'selected-sheets'],
              },
              { name: 'exportSelection', type: 'boolean', required: true },
            ]),
          },
        }),
      ]);
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
      body: JSON.stringify({ dialogs: [], uiSnapshotAvailable: true, recentActions: [] }),
    });

    try {
      const result = await harness.callTool({ session: undefined });

      expect(result.isError).toBe(false);
      expect(parseResult(result)).toEqual({
        dialogs: [],
        uiSnapshotAvailable: true,
        recentActions: [],
      });
      expect(dialogGets(harness.server)).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });

  it('rejects an older pinned Desktop before reading dialogs', async () => {
    const harness = await startHarness('0.2.22');
    try {
      const result = await harness.callTool({ session: undefined });
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('0.2.23');
      expect(dialogGets(harness.server)).toHaveLength(0);
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

async function startHarness(apiVersion = '0.2.23'): Promise<{
  server: MockExternalApiServer;
  extra: ReturnType<typeof getMockRequestHandlerExtra>;
  callTool: (args: { session: string | undefined }) => Promise<CallToolResult>;
  close: () => Promise<void>;
}> {
  const server = await startMockExternalApiServer();
  const executor = new ExternalApiToolExecutor({
    discover: () => [instanceFor(server, apiVersion)],
  });
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

function instanceFor(server: MockExternalApiServer, apiVersion = '0.2.23'): ExternalApiInstance {
  return {
    baseUrl: server.baseUrl,
    token: 'valid-token',
    pid: 999,
    instanceId: 'inst-get-active-dialogs',
    apiVersion,
  };
}
