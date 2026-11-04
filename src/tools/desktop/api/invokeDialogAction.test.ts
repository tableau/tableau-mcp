import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import {
  MockExternalApiServer,
  startMockExternalApiServer,
} from '../../../desktop/externalApi/mockExternalApiServer.js';
import {
  DialogActionInvocation,
  DialogRequestStatus,
  ExternalApiInstance,
  InvokeDialogActionRequest,
  InvokeDialogActionResult,
} from '../../../desktop/externalApi/types.js';
import * as sessionResolution from '../../../desktop/session/sessionResolution.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getInvokeDialogActionTool } from './invokeDialogAction.js';

vi.mock('../../../desktop/session/sessionResolution.js');

const exactButtonLabel = '  Discard & Close  ';

const defaultRequest: InvokeDialogActionRequest = {
  requestId: 'request-1',
  dialog: {
    objectName: 'saveChangesDialog',
    title: 'Save Changes',
    className: 'QMessageBox',
    sessionId: 'dialog-session-1',
    revision: 1,
  },
  action: { kind: 'button', label: 'Discard' },
};

const exactStringRequest: InvokeDialogActionRequest = {
  requestId: 'exact-request-1',
  dialog: {
    objectName: ' dialog object ',
    title: 'Café & Save?',
    className: 'Custom::Dialog',
    sessionId: 'exact-dialog-session',
    revision: 2,
  },
  action: { kind: 'button', label: exactButtonLabel },
};

function requestStatus(
  request: InvokeDialogActionRequest,
  state = 'completed',
  effect = 'dialog-dismissed',
): DialogRequestStatus {
  return {
    sessionId: request.dialog.sessionId,
    revision: request.dialog.revision,
    requestId: request.requestId,
    state,
    effect,
  };
}

const successCases: Array<[string, InvokeDialogActionResult]> = [
  [
    'no active dialog',
    {
      outcome: 'failed',
      dialog: exactStringRequest.dialog,
      status: {
        ...requestStatus(exactStringRequest, 'failed', 'none'),
        code: 'dialog-session-inactive',
      },
      uiSnapshotAvailable: false,
      dialogs: [],
    },
  ],
  [
    'a click that dismisses the selected dialog',
    {
      outcome: 'completed',
      dialog: exactStringRequest.dialog,
      status: requestStatus(exactStringRequest),
      uiSnapshotAvailable: true,
      dialogs: [
        {
          objectName: 'nextDialog',
          title: 'Next decision',
          className: 'QMessageBox',
          messageText: 'Continue?',
          informativeText: 'A second dialog is now active.',
          detailedText: 'Details stay intact.',
          detailedTextTruncated: true,
          iconLevel: 'question',
          buttons: ['No', 'Yes'],
        },
      ],
    },
  ],
  [
    'an action after which the selected dialog remains',
    {
      outcome: 'dispatched-pending',
      dialog: exactStringRequest.dialog,
      status: requestStatus(exactStringRequest, 'pending', 'none'),
      uiSnapshotAvailable: true,
      dialogs: [
        {
          ...exactStringRequest.dialog,
          messageText: 'Validation is still running.',
          buttons: ['  Discard & Close  ', 'Cancel'],
        },
        {
          objectName: '',
          title: '',
          className: 'QDialog',
        },
      ],
    },
  ],
  ...['canceled', 'expired', 'indeterminate'].map((outcome): [string, InvokeDialogActionResult] => [
    outcome,
    {
      outcome,
      dialog: exactStringRequest.dialog,
      status: requestStatus(exactStringRequest, outcome, 'none'),
      uiSnapshotAvailable: false,
      dialogs: [],
    },
  ]),
];

const nativeActions: DialogActionInvocation[] = [
  { kind: 'cancel' },
  { kind: 'choose-file', path: 'C:\\data\\input.csv', filterId: 'csv-filter' },
  { kind: 'choose-files', paths: ['C:\\data\\a.csv', 'C:\\data\\b.csv'], filterId: 'csv-filter' },
  { kind: 'choose-directory', path: 'C:\\data\\exports' },
  {
    kind: 'save-file',
    path: 'C:\\data\\report.twb',
    filterId: 'twb-filter',
    overwriteConfirmed: true,
  },
  { kind: 'choose-color', red: 141, green: 94, blue: 33, alpha: 77 },
  {
    kind: 'submit-print',
    printerId: 'private-printer-id',
    range: 'page-range',
    sheetScope: 'selected-sheets',
    firstPage: 2,
    lastPage: 4,
    copies: 3,
    collate: true,
    exportSelection: true,
    outputPath: 'C:\\data\\report.pdf',
  },
];

describe('invoke-dialog-action tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('declares the destructive, idempotent 0.2.26 request contract', () => {
    const tool = getInvokeDialogActionTool(new DesktopMcpServer());
    const schema = z.object(tool.paramsSchema as z.ZodRawShape);

    expect(tool.name).toBe('invoke-dialog-action');
    expect(tool.minApiVersion).toBe('0.2.26');
    expect(tool.description).toContain('get-active-dialogs');
    expect(tool.description).toContain('context');
    expect(tool.description).toContain('Never guess');
    expect(tool.description).toContain('requestId');
    expect(tool.description).toContain('recentActions');
    expect(tool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(schema.safeParse(defaultRequest).success).toBe(true);
    expect(schema.safeParse({ ...defaultRequest, action: { kind: 'close' } }).success).toBe(true);
    expect(
      schema.safeParse({ ...defaultRequest, action: { kind: 'close', label: 'X' } }).success,
    ).toBe(false);
    expect(schema.safeParse({ ...defaultRequest, action: { kind: 'button' } }).success).toBe(false);
    expect(
      schema.safeParse({ ...defaultRequest, action: { kind: 'button', label: '' } }).success,
    ).toBe(false);
    expect(schema.safeParse({ action: defaultRequest.action }).success).toBe(false);
    expect(
      schema.safeParse({ dialog: defaultRequest.dialog, action: defaultRequest.action }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ dialog: { title: 'Save Changes' }, action: defaultRequest.action })
        .success,
    ).toBe(false);
  });

  it('identifies an empty button label without asking for a path', () => {
    const tool = getInvokeDialogActionTool(new DesktopMcpServer());
    const parsed = z.object(tool.paramsSchema as z.ZodRawShape).safeParse({
      ...defaultRequest,
      action: { kind: 'button', label: '' },
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error('Expected the empty button label to be rejected.');
    expect(parsed.error.issues).toEqual([
      expect.objectContaining({
        path: ['action', 'label'],
        message: 'A nonempty value is required.',
      }),
    ]);
  });

  it('rejects invalid compact-schema inputs through MCP before dispatching the tool', async () => {
    const tool = getInvokeDialogActionTool(new DesktopMcpServer());
    const { McpServer: RealMcpServer } = await vi.importActual<
      typeof import('@modelcontextprotocol/sdk/server/mcp.js')
    >('@modelcontextprotocol/sdk/server/mcp.js');
    const sdkServer = new RealMcpServer({ name: 'dialog-validation-test', version: '1.0.0' });
    const client = new Client({ name: 'dialog-validation-client', version: '1.0.0' });
    const dispatch = vi.fn(async (_args: unknown) => ({
      content: [{ type: 'text' as const, text: 'accepted' }],
    }));
    sdkServer.registerTool(
      tool.name,
      { inputSchema: tool.paramsSchema as z.ZodRawShape },
      dispatch,
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await sdkServer.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      for (const arguments_ of [
        { ...defaultRequest, requestId: 'contains a space' },
        { ...defaultRequest, dialog: { objectName: 'missing-identity' } },
        { ...defaultRequest, dialog: { ...defaultRequest.dialog, revision: -1 } },
        { ...defaultRequest, action: { kind: 'button', label: 'Discard', enabled: true } },
        {
          ...defaultRequest,
          action: { kind: 'save-file', path: 'C:\\report.twb', filterId: 'twb' },
        },
        { ...defaultRequest, action: { kind: 'choose-color', red: 999, green: 0, blue: 0 } },
      ]) {
        const result = await client.callTool({ name: tool.name, arguments: arguments_ });
        expect(result.isError).toBe(true);
      }
      expect(dispatch).not.toHaveBeenCalled();
      expect(
        (await client.callTool({ name: tool.name, arguments: defaultRequest })).isError,
      ).not.toBe(true);
      expect(dispatch).toHaveBeenCalledOnce();
      expect(dispatch.mock.calls[0][0]).toEqual({ ...defaultRequest, session: undefined });
    } finally {
      await Promise.all([client.close(), sdkServer.close()]);
    }
  });

  it('redacts invocation logging while forwarding the exact sensitive request once', async () => {
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('321'));
    const response: InvokeDialogActionResult = {
      outcome: 'completed',
      dialog: exactStringRequest.dialog,
      status: requestStatus(exactStringRequest),
      uiSnapshotAvailable: true,
      dialogs: [],
    };
    const harness = await startHarness();
    setSuccess(harness.server, response);
    const notifyInvocation = vi.spyOn(harness.tool, 'notifyInvocation');

    try {
      const result = await harness.callTool({
        session: 'desktop-window-321',
        ...exactStringRequest,
      });

      expect(result.isError).toBe(false);
      expect(parseSuccess(result)).toEqual(response);
      expect(sessionResolution.resolveSession).toHaveBeenCalledWith('desktop-window-321');
      expect(harness.extra.getExecutor).toHaveBeenCalledWith('321');
      expect(notifyInvocation).toHaveBeenCalledWith({
        requestId: harness.extra.requestId,
        args: {
          session: 'desktop-window-321',
          requestId: '[redacted]',
          dialog: {
            objectName: '[redacted]',
            title: '[redacted]',
            className: '[redacted]',
            sessionId: '[redacted]',
            revision: 0,
          },
          action: { kind: 'button', label: '[redacted]' },
        },
      });
      const invocation = JSON.stringify(notifyInvocation.mock.calls[0][0]);
      expect(invocation).not.toContain(exactStringRequest.dialog.objectName);
      expect(invocation).not.toContain(exactStringRequest.dialog.title);
      expect(invocation).not.toContain(exactStringRequest.dialog.className);
      expect(invocation).not.toContain(exactStringRequest.dialog.sessionId);
      expect(invocation).not.toContain(exactStringRequest.requestId);
      expect(invocation).not.toContain(exactButtonLabel);
      const posts = dialogPosts(harness.server);
      expect(posts).toHaveLength(1);
      expect(posts[0].contentType).toBe('application/json');
      expect(posts[0].body).toBe(JSON.stringify(exactStringRequest));
    } finally {
      await harness.close();
    }
  });

  it('forwards a semantic close action without inventing a visible label', async () => {
    const request: InvokeDialogActionRequest = {
      requestId: 'close-request-1',
      dialog: {
        objectName: 'UnifiedDetailedErrorDialog',
        title: 'Unable to complete action',
        className: 'UnifiedDetailedErrorDialog',
        sessionId: 'error-dialog-session',
        revision: 3,
      },
      action: { kind: 'close' },
    };
    const response: InvokeDialogActionResult = {
      outcome: 'completed',
      dialog: request.dialog,
      status: requestStatus(request),
      uiSnapshotAvailable: true,
      dialogs: [],
    };
    const harness = await startHarness();
    setSuccess(harness.server, response);

    try {
      const result = await harness.callTool({ session: undefined, ...request });

      expect(result.isError).toBe(false);
      expect(parseSuccess(result)).toEqual(response);
      const posts = dialogPosts(harness.server);
      expect(posts).toHaveLength(1);
      expect(posts[0].body).toBe(JSON.stringify(request));
      expect(posts[0].body).not.toContain('"label"');
      expect(posts[0].body).not.toContain('"X"');
    } finally {
      await harness.close();
    }
  });

  it('rejects unknown invocation properties before forwarding a request', async () => {
    const requestWithUnknownActionProperty = {
      session: undefined,
      ...defaultRequest,
      action: {
        ...defaultRequest.action,
        futureProperty: 'not part of the current invocation contract',
      },
    };
    const harness = await startHarness();

    try {
      const schema = z.object(harness.tool.paramsSchema as z.ZodRawShape);
      expect(schema.safeParse(requestWithUnknownActionProperty).success).toBe(false);
      const posts = dialogPosts(harness.server);
      expect(posts).toHaveLength(0);
    } finally {
      await harness.close();
    }
  });

  it('uses the contract-faithful endpoint and returns its completed status unchanged', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ session: undefined, ...defaultRequest });

      expect(result.isError).toBe(false);
      expect(parseSuccess(result)).toEqual({
        outcome: 'completed',
        dialog: defaultRequest.dialog,
        status: requestStatus(defaultRequest),
        uiSnapshotAvailable: true,
        dialogs: [],
      });
      expect(dialogPosts(harness.server)).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });

  it.each(successCases)(
    'preserves the complete %s response without retrying',
    async (_label, response) => {
      const harness = await startHarness();
      setSuccess(harness.server, response);

      try {
        const result = await harness.callTool({ session: undefined, ...exactStringRequest });

        expect(result.isError).toBe(false);
        expect(parseSuccess(result)).toEqual(response);
        expect(dialogPosts(harness.server)).toHaveLength(1);
      } finally {
        await harness.close();
      }
    },
  );

  it.each(nativeActions)(
    'forwards $kind values exactly once without logging selections',
    async (action) => {
      const harness = await startHarness();
      const request = { ...exactStringRequest, action };
      const response: InvokeDialogActionResult = {
        outcome: 'dispatched-pending',
        dialog: request.dialog,
        status: requestStatus(request, 'pending', 'none'),
        uiSnapshotAvailable: false,
        dialogs: [],
      };
      setSuccess(harness.server, response);
      const notifyInvocation = vi.spyOn(harness.tool, 'notifyInvocation');
      try {
        const schema = z.object(harness.tool.paramsSchema as z.ZodRawShape);
        expect(schema.safeParse(request).success).toBe(true);
        const result = await harness.callTool({ session: undefined, ...request });
        expect(result.isError).toBe(false);
        expect(parseSuccess(result)).toEqual(response);
        expect(parseSuccess(result)).not.toHaveProperty('action');
        const posts = dialogPosts(harness.server);
        expect(posts).toHaveLength(1);
        expect(posts[0].body).toBe(JSON.stringify(request));
        const logged = notifyInvocation.mock.calls[0][0];
        expect(logged.args).toMatchObject({
          requestId: '[redacted]',
          dialog: { sessionId: '[redacted]' },
          action: { kind: action.kind },
        });
        const loggedText = JSON.stringify(logged);
        for (const [key, value] of Object.entries(action)) {
          if (['path', 'paths', 'filterId', 'printerId', 'outputPath'].includes(key)) {
            for (const selection of Array.isArray(value) ? value : [value]) {
              expect(loggedText).not.toContain(JSON.stringify(selection).slice(1, -1));
            }
          }
        }
        if (action.kind === 'choose-color') {
          expect(logged.args).toHaveProperty('action', {
            kind: 'choose-color',
            red: 0,
            green: 0,
            blue: 0,
          });
        }
      } finally {
        await harness.close();
      }
    },
  );

  it.each([
    { requestId: '' },
    { requestId: 'contains a space' },
    { requestId: 'x'.repeat(129) },
    { requestId: 'nonascii-é' },
    { dialog: { ...defaultRequest.dialog, revision: -1 } },
    { dialog: { ...defaultRequest.dialog, revision: 1.5 } },
    { dialog: { ...defaultRequest.dialog, revision: Number.MAX_SAFE_INTEGER + 1 } },
    { action: { kind: 'choose-files', paths: [] } },
    { action: { kind: 'choose-file', path: 'C:\\bad\0path' } },
    { action: { kind: 'save-file', path: 'C:\\report.twb', filterId: 'twb' } },
    { action: { kind: 'choose-color', red: 256, green: 0, blue: 0 } },
    { action: { kind: 'choose-color', red: 1.5, green: 0, blue: 0 } },
    { action: { kind: 'submit-print', printerId: 'printer' } },
  ])('rejects invalid session-safe invocation input %j', (change) => {
    const tool = getInvokeDialogActionTool(new DesktopMcpServer());
    expect(
      z.object(tool.paramsSchema as z.ZodRawShape).safeParse({ ...defaultRequest, ...change })
        .success,
    ).toBe(false);
  });

  it('reuses an identical request ID without invoking twice and rejects a conflicting action', async () => {
    const harness = await startHarness();
    try {
      const args = { session: undefined, ...defaultRequest };
      const first = parseSuccess(await harness.callTool(args));
      const repeated = parseSuccess(await harness.callTool(args));
      expect(first.outcome).toBe('completed');
      expect(repeated).toEqual(first);
      expect(first).not.toHaveProperty('action');
      const executor = await harness.extra.getExecutor('999');
      const snapshot = (await executor.getActiveDialogs(new AbortController().signal)).unwrap();
      expect(snapshot).toEqual({
        dialogs: [],
        uiSnapshotAvailable: true,
        recentActions: [first.status],
      });
      const conflicting = parseSuccess(
        await harness.callTool({ ...args, action: { kind: 'button', label: 'Save' } }),
      );
      expect(conflicting.status).toMatchObject({
        state: 'failed',
        effect: 'none',
        code: 'dialog-request-conflict',
      });
      expect(
        (await executor.getActiveDialogs(new AbortController().signal)).unwrap().recentActions,
      ).toEqual(snapshot.recentActions);
      expect(dialogPosts(harness.server)).toHaveLength(3);
    } finally {
      await harness.close();
    }
  });

  it.each([
    [
      { ...defaultRequest, dialog: { ...defaultRequest.dialog, revision: 0 } },
      'dialog-session-stale',
    ],
    [
      { ...defaultRequest, dialog: { ...defaultRequest.dialog, sessionId: 'bogus-session' } },
      'dialog-session-inactive',
    ],
    [
      { ...defaultRequest, action: { kind: 'button', label: 'Bogus' } },
      'dialog-action-unsupported',
    ],
  ] as const)(
    'returns a rejected request status without dismissing the dialog',
    async (request, code) => {
      const harness = await startHarness();
      try {
        const response = parseSuccess(await harness.callTool({ session: undefined, ...request }));
        expect(response.outcome).toBe('failed');
        expect(response.status).toMatchObject({ state: 'failed', effect: 'none', code });
        expect(response.dialogs).toHaveLength(1);
        expect(dialogPosts(harness.server)).toHaveLength(1);
      } finally {
        await harness.close();
      }
    },
  );

  it.each([
    [400, 'invalid-request-body'],
    [409, 'dialog-not-found'],
    [409, 'dialog-ambiguous'],
    [409, 'dialog-action-not-found'],
    [409, 'dialog-action-ambiguous'],
    [409, 'dialog-action-disabled'],
  ])('propagates HTTP %i %s and sends no retry', async (status, code) => {
    const harness = await startHarness();
    harness.server.setOverride('POST /v0/app:invokeDialogAction', {
      status,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        type: 'problem',
        title: 'Dialog request rejected.',
        status,
        instance: '/v0/app:invokeDialogAction',
        code,
      }),
    });

    try {
      const result = await harness.callTool({ session: undefined, ...defaultRequest });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('Dialog request rejected.');
      expect(result.content[0].text).toContain(`tableau-error-code: ${code}`);
      expect(dialogPosts(harness.server)).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });

  it('maps a translated stable route 404 to action-specific no-retry guidance', async () => {
    const harness = await startHarness();
    harness.server.setOverride('POST /v0/app:invokeDialogAction', {
      status: 404,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        type: 'problem',
        title: 'Nicht gefunden',
        status: 404,
        instance: '/v0/app:invokeDialogAction',
        code: 'not-found',
        detail: 'Keine Route stimmt mit POST /v0/app:invokeDialogAction überein',
      }),
    });

    try {
      const result = await harness.callTool({ session: undefined, ...defaultRequest });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('POST /v0/app:invokeDialogAction');
      expect(result.content[0].text).toContain('No dialog action ran');
      expect(result.content[0].text).toContain('Do not retry invoke-dialog-action');
      expect(result.content[0].text).toContain('Ask the user to handle the dialog');
      expect(result.content[0].text).toContain('update Tableau Desktop');
      expect(result.content[0].text).not.toContain('too old for this read');
      expect(dialogPosts(harness.server)).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });
});

function setSuccess(server: MockExternalApiServer, response: InvokeDialogActionResult): void {
  server.setOverride('POST /v0/app:invokeDialogAction', {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(response),
  });
}

function dialogPosts(server: MockExternalApiServer): MockExternalApiServer['requests'] {
  return server.requests.filter(
    (request) => request.method === 'POST' && request.path === '/v0/app:invokeDialogAction',
  );
}

function parseSuccess(result: CallToolResult): InvokeDialogActionResult {
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text) as InvokeDialogActionResult;
}

async function startHarness(): Promise<{
  server: MockExternalApiServer;
  tool: ReturnType<typeof getInvokeDialogActionTool>;
  extra: ReturnType<typeof getMockRequestHandlerExtra>;
  callTool: (args: InvokeDialogActionToolArgs) => Promise<CallToolResult>;
  close: () => Promise<void>;
}> {
  const server = await startMockExternalApiServer();
  const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
  await executor.start();
  const tool = getInvokeDialogActionTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: vi.fn().mockResolvedValue(executor),
  };

  return {
    server,
    tool,
    extra,
    callTool: async (args) => await callback(args, extra),
    close: async () => {
      executor.stop();
      await server.close();
    },
  };
}

type InvokeDialogActionToolArgs = InvokeDialogActionRequest & {
  session: string | undefined;
};

function instanceFor(server: MockExternalApiServer): ExternalApiInstance {
  return {
    baseUrl: server.baseUrl,
    token: 'valid-token',
    pid: 999,
    instanceId: 'inst-invoke-dialog-action',
    apiVersion: '0.2.26',
  };
}
