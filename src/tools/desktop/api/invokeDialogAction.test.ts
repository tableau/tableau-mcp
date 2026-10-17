import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { createCallDeadline } from '../../../desktop/callDeadline.js';
import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import {
  MockExternalApiServer,
  startMockExternalApiServer,
} from '../../../desktop/externalApi/mockExternalApiServer.js';
import {
  DialogActionInvocation,
  dialogActionInvocationSchema,
  ExternalApiInstance,
  InvokeDialogActionRequest,
  InvokeDialogActionResult,
} from '../../../desktop/externalApi/types.js';
import * as sessionResolution from '../../../desktop/session/sessionResolution.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import type { TableauDesktopRequestHandlerExtra } from '../toolContext.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getInvokeDialogActionTool } from './invokeDialogAction.js';

vi.mock('../../../desktop/session/sessionResolution.js');

const exactButtonLabel = '  Discard & Close  ';

const defaultRequest: InvokeDialogActionRequest = {
  dialog: {
    objectName: 'saveChangesDialog',
    title: 'Save Changes',
    className: 'QMessageBox',
    sessionId: 'dialog-session-save-changes',
    revision: 1,
  },
  requestId: 'request-qt',
  action: { kind: 'button', label: 'Discard' },
};

const exactStringRequest: InvokeDialogActionRequest = {
  dialog: {
    objectName: ' dialog object ',
    title: 'Café & Save?',
    className: 'Custom::Dialog',
    sessionId: 'session-exact-string',
    revision: 2,
  },
  requestId: 'request-exact-string',
  action: { kind: 'button', label: exactButtonLabel },
};

function settledResult(
  request: InvokeDialogActionRequest,
  effect: 'dialog-dismissed' | 'dialog-remains' = 'dialog-dismissed',
): InvokeDialogActionResult {
  return {
    outcome: 'completed',
    dialog: request.dialog,
    status: {
      sessionId: request.dialog.sessionId,
      revision: request.dialog.revision,
      requestId: request.requestId,
      state: 'completed',
      effect,
    },
    dialogs:
      effect === 'dialog-remains' ? [{ ...request.dialog, family: 'qt', status: 'active' }] : [],
  };
}

const successCases: Array<[string, InvokeDialogActionResult]> = [
  ['a click that dismisses the selected dialog', settledResult(exactStringRequest)],
  [
    'a completed action after which the selected dialog remains',
    settledResult(exactStringRequest, 'dialog-remains'),
  ],
  [
    'a rejected action with a precise status code',
    {
      outcome: 'failed',
      dialog: exactStringRequest.dialog,
      status: {
        sessionId: exactStringRequest.dialog.sessionId,
        revision: exactStringRequest.dialog.revision,
        requestId: exactStringRequest.requestId,
        state: 'failed',
        effect: 'none',
        code: 'dialog-not-found',
      },
      dialogs: [],
    },
  ],
];

describe('invoke-dialog-action tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('declares the destructive, non-idempotent 0.2.23 action contract', () => {
    const tool = getInvokeDialogActionTool(new DesktopMcpServer());
    const schema = z.object(tool.paramsSchema as z.ZodRawShape);

    expect(tool.name).toBe('invoke-dialog-action');
    expect(tool.minApiVersion).toBe('0.2.23');
    expect(tool.description).toContain('get-active-dialogs');
    expect(tool.description).toContain('context');
    expect(tool.description).toContain('exact action');
    expect(tool.description).toContain('Never guess or retry');
    expect(tool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    });
    expect(
      schema.safeParse({ dialog: defaultRequest.dialog, action: defaultRequest.action }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ dialog: defaultRequest.dialog, action: { kind: 'close' } }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ dialog: defaultRequest.dialog, action: { kind: 'close', label: 'X' } })
        .success,
    ).toBe(true);
    expect(
      schema.safeParse({ dialog: defaultRequest.dialog, action: { kind: 'button' } }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ dialog: defaultRequest.dialog, action: { kind: 'button', label: '' } })
        .success,
    ).toBe(true);
    expect(dialogActionInvocationSchema.safeParse({ kind: 'close', label: 'X' }).success).toBe(
      false,
    );
    expect(dialogActionInvocationSchema.safeParse({ kind: 'button' }).success).toBe(false);
    expect(dialogActionInvocationSchema.safeParse({ kind: 'button', label: '' }).success).toBe(
      false,
    );
    expect(schema.safeParse({ action: defaultRequest.action }).success).toBe(false);
    expect(
      schema.safeParse({ dialog: { title: 'Save Changes' }, action: defaultRequest.action })
        .success,
    ).toBe(false);
    expect(
      schema.safeParse({
        dialog: defaultRequest.dialog,
        action: { kind: 'choose-color', red: 0, green: 0, blue: 256 },
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        dialog: defaultRequest.dialog,
        action: { kind: 'submit-print', printerId: 'printer-1' },
      }).success,
    ).toBe(true);
  });

  it('redacts invocation logging while forwarding the exact sensitive request once', async () => {
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('321'));
    const response = settledResult(exactStringRequest);
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
          dialog: {
            objectName: '[redacted]',
            title: '[redacted]',
            className: '[redacted]',
            sessionId: '[redacted]',
            revision: 0,
          },
          requestId: '[redacted]',
          action: { kind: 'button', label: '[redacted]' },
        },
      });
      const invocation = JSON.stringify(notifyInvocation.mock.calls[0][0]);
      expect(invocation).not.toContain(exactStringRequest.dialog.objectName);
      expect(invocation).not.toContain(exactStringRequest.dialog.title);
      expect(invocation).not.toContain(exactStringRequest.dialog.className);
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
      dialog: {
        objectName: 'UnifiedDetailedErrorDialog',
        title: 'Unable to complete action',
        className: 'UnifiedDetailedErrorDialog',
        sessionId: 'session-error',
        revision: 3,
      },
      requestId: 'request-close',
      action: { kind: 'close' },
    };
    const response = settledResult(request);
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

  it.each(['button', 'close', 'cancel'] as const)(
    'requires session identity for every %s action',
    async (kind) => {
      const harness = await startHarness();
      try {
        const tupleOnly = {
          objectName: 'saveChangesDialog',
          title: 'Save Changes',
          className: 'QMessageBox',
        };
        const schema = z.object(harness.tool.paramsSchema as z.ZodRawShape);
        expect(schema.safeParse({ dialog: tupleOnly, action: { kind } }).success).toBe(false);
        const result = await harness.callTool({
          session: undefined,
          dialog: tupleOnly as typeof defaultRequest.dialog,
          action: kind === 'button' ? { kind, label: 'Discard' } : { kind },
        });
        expect(result.isError).toBe(true);
        expect(dialogPosts(harness.server)).toHaveLength(0);
      } finally {
        await harness.close();
      }
    },
  );

  it('rejects dialog identities with fields outside the fresh inspection result', async () => {
    const harness = await startHarness();

    try {
      const dialog = { ...defaultRequest.dialog, unsupportedField: 'not copied from inspection' };
      const result = await harness.callTool({
        session: undefined,
        dialog,
        action: defaultRequest.action,
      });

      expect(result.isError).toBe(true);
      expect(dialogPosts(harness.server)).toHaveLength(0);
    } finally {
      await harness.close();
    }
  });

  it('rejects malformed native action fields inside the normal execution funnel', async () => {
    const malformedColor = {
      session: undefined,
      dialog: {
        objectName: 'colorDialog',
        title: 'Choose Color',
        className: 'QColorDialog',
        sessionId: 'native-session',
        revision: 1,
      },
      requestId: 'request-1',
      action: { kind: 'choose-color' as const, red: 0, green: 0, blue: 256 },
    };
    const harness = await startHarness('0.2.23');

    try {
      const result = await harness.callTool(malformedColor);

      expect(result.isError).toBe(true);
      expect(dialogPosts(harness.server)).toHaveLength(0);
    } finally {
      await harness.close();
    }
  });

  it.each(['', 'request with spaces', 'r'.repeat(129), 'request-非ascii'])(
    'rejects malformed requestId without posting or echoing it: %s',
    async (requestId) => {
      const harness = await startHarness();
      try {
        const result = await harness.callTool({ session: undefined, ...defaultRequest, requestId });
        expect(result.isError).toBe(true);
        invariant(result.content[0].type === 'text');
        expect(result.content[0].text).toContain('printable opaque identifier');
        if (requestId !== '') expect(result.content[0].text).not.toContain(requestId);
        expect(dialogPosts(harness.server)).toHaveLength(0);
      } finally {
        await harness.close();
      }
    },
  );

  it('rejects unknown action properties so selection payloads stay in the closed invocation contract', async () => {
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
      const result = await harness.callTool(requestWithUnknownActionProperty);

      expect(result.isError).toBe(true);
      const posts = dialogPosts(harness.server);
      expect(posts).toHaveLength(0);
    } finally {
      await harness.close();
    }
  });

  it.each([
    { fields: [{ name: 'path', value: '/private/existing.twb' }] },
    { fields: { path: '/private/existing.twb', filterId: 'twb', overwriteConfirmed: false } },
  ])(
    'rejects nested action metadata before dispatch and explains the flat shape',
    async (input) => {
      const harness = await startHarness();

      try {
        const result = await harness.callTool({
          session: undefined,
          ...defaultRequest,
          action: { kind: 'save-file', input } as unknown as DialogActionInvocation,
        });

        expect(result.isError).toBe(true);
        invariant(result.content[0].type === 'text');
        expect(result.content[0].text).toContain('sibling keys');
        expect(result.content[0].text).toContain('no Desktop action was dispatched');
        expect(result.content[0].text).not.toContain('/private/existing.twb');
        expect(dialogPosts(harness.server)).toHaveLength(0);
      } finally {
        await harness.close();
      }
    },
  );

  it('does not down-convert a native Qt identity to an older Desktop tuple', async () => {
    const harness = await startHarness('0.2.22');

    try {
      const result = await harness.callTool({
        session: undefined,
        dialog: { ...defaultRequest.dialog, sessionId: 'native-session', revision: 8 },
        requestId: 'native-request',
        action: defaultRequest.action,
      });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('Dialog tools require External Client API 0.2.23');
      expect(dialogPosts(harness.server)).toHaveLength(0);
    } finally {
      await harness.close();
    }
  });

  it('uses the contract-faithful endpoint and returns its current completion status unchanged', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ session: undefined, ...defaultRequest });

      expect(result.isError).toBe(false);
      expect(parseSuccess(result)).toEqual(settledResult(defaultRequest));
      expect(dialogPosts(harness.server)).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });

  it('uses the 0.2.23 native request shape, generates a request id, and does not log selection input', async () => {
    const request = {
      session: undefined,
      dialog: {
        objectName: 'native-file',
        title: 'Locate data source',
        className: 'QFileDialog',
        sessionId: 'native-session',
        revision: 7,
      },
      action: { kind: 'choose-file' as const, path: '/private/selected-source.tds' },
    };
    const response = {
      outcome: 'completed',
      dialog: request.dialog,
      status: {
        sessionId: 'native-session',
        revision: 7,
        requestId: 'generated',
        state: 'completed',
        effect: 'file-choice-returned',
      },
      dialogs: [],
    };
    const harness = await startHarness('0.2.23');
    harness.server.setOverride('POST /v0/app:invokeDialogAction', {
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
    const notifyInvocation = vi.spyOn(harness.tool, 'notifyInvocation');

    try {
      const result = await harness.callTool(request);
      expect(result.isError).toBe(false);
      const post = dialogPosts(harness.server).at(0);
      expect(post?.body).toContain('choose-file');
      expect(post?.body).toContain('/private/selected-source.tds');
      expect(JSON.parse(post?.body ?? '{}').requestId).toMatch(/^[!-~]{1,128}$/);
      expect(JSON.stringify(notifyInvocation.mock.calls[0][0])).not.toContain(
        '/private/selected-source.tds',
      );
      expect(JSON.stringify(parseSuccess(result))).not.toContain('/private/selected-source.tds');
    } finally {
      await harness.close();
    }
  });

  it('surfaces the same generated request id from the dispatched native POST after the outer deadline wins', async () => {
    const deadline = createCallDeadline({ budgetMs: 250 });
    const harness = await startHarness('0.2.23', deadline);
    harness.server.setOverride('POST /v0/app:invokeDialogAction', { status: 200, hang: true });

    try {
      const pending = harness.callTool({
        session: undefined,
        dialog: { ...defaultRequest.dialog, sessionId: 'native-session', revision: 8 },
        action: { kind: 'choose-file', path: '/private/selected-source.tds' },
      });
      await vi.waitFor(() => expect(dialogPosts(harness.server)).toHaveLength(1));
      const requestId = JSON.parse(dialogPosts(harness.server)[0].body ?? '{}').requestId;
      const result = await pending;

      expect(requestId).toMatch(/^[0-9a-f-]{36}$/i);
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain(`requestId=${requestId}`);
      expect(result.content[0].text).toContain('outcome is indeterminate');
      expect(result.content[0].text).not.toContain('/private/selected-source.tds');
    } finally {
      deadline.dispose();
      await harness.close();
    }
  });

  it('surfaces the generated request id after an indeterminate native response without replay or selection echo', async () => {
    const harness = await startHarness('0.2.23');
    harness.server.setOverride('POST /v0/app:invokeDialogAction', {
      status: 200,
      contentType: 'application/json',
      body: '{}',
    });

    try {
      const result = await harness.callTool({
        session: undefined,
        dialog: { ...defaultRequest.dialog, sessionId: 'native-session', revision: 7 },
        action: { kind: 'choose-file', path: '/private/selected-source.tds' },
      });
      const posts = dialogPosts(harness.server);
      expect(posts).toHaveLength(1);
      const requestId = JSON.parse(posts[0].body ?? '{}').requestId;
      expect(requestId).toMatch(/^[!-~]{1,128}$/);
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain(`requestId=${requestId}`);
      expect(result.content[0].text).toContain('recentActions');
      expect(result.content[0].text).not.toContain('/private/selected-source.tds');
    } finally {
      await harness.close();
    }
  });

  it.each([false, true])(
    'preserves a pending receipt and adds reconciliation guidance (visible dialog: %s)',
    async (visibleDialog) => {
      const response: InvokeDialogActionResult = {
        outcome: 'dispatched-pending',
        dialog: exactStringRequest.dialog,
        status: {
          sessionId: exactStringRequest.dialog.sessionId,
          revision: exactStringRequest.dialog.revision,
          requestId: exactStringRequest.requestId,
          state: 'pending',
          effect: 'none',
        },
        dialogs: visibleDialog
          ? [{ ...exactStringRequest.dialog, family: 'qt', status: 'active' }]
          : [],
      };
      const harness = await startHarness();
      setSuccess(harness.server, response);

      try {
        const result = await harness.callTool({ session: undefined, ...exactStringRequest });

        expect(result.isError).toBe(false);
        expect(parseSuccess(result)).toEqual(response);
        expect(result.content).toHaveLength(2);
        invariant(result.content[1].type === 'text');
        expect(result.content[1].text).toContain('read only get-active-dialogs');
        expect(result.content[1].text).toContain('status.requestId and status.sessionId');
        expect(result.content[1].text).toContain('empty dialogs array does not');
        expect(result.content[1].text).toContain('Do not replay this mutation');
        expect(result.content[1].text).toContain('stop mutations');
        expect(result.content[1].text).toContain('new requestId');
        expect(dialogPosts(harness.server)).toHaveLength(1);
        expect(
          harness.server.requests.filter((request) => request.path === '/v0/app/dialogs'),
        ).toHaveLength(0);
      } finally {
        await harness.close();
      }
    },
  );

  it.each(successCases)(
    'preserves the complete %s response without retrying',
    async (_label, response) => {
      const harness = await startHarness();
      setSuccess(harness.server, response);

      try {
        const result = await harness.callTool({ session: undefined, ...exactStringRequest });

        expect(result.isError).toBe(false);
        expect(parseSuccess(result)).toEqual(response);
        expect(result.content).toHaveLength(1);
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

async function startHarness(
  apiVersion = '0.2.23',
  deadline?: ReturnType<typeof createCallDeadline>,
): Promise<{
  server: MockExternalApiServer;
  tool: ReturnType<typeof getInvokeDialogActionTool>;
  extra: TableauDesktopRequestHandlerExtra;
  callTool: (args: InvokeDialogActionToolArgs) => Promise<CallToolResult>;
  close: () => Promise<void>;
}> {
  const server = await startMockExternalApiServer();
  const executor = new ExternalApiToolExecutor({
    discover: () => [instanceFor(server, apiVersion)],
  });
  await executor.start();
  const tool = getInvokeDialogActionTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  const baseExtra = getMockRequestHandlerExtra();
  const extra: TableauDesktopRequestHandlerExtra = {
    ...baseExtra,
    ...(deadline === undefined ? {} : { signal: deadline.signal, deadline }),
    getExecutor: vi.fn().mockResolvedValue(executor),
  };

  return {
    server,
    tool,
    extra,
    callTool: async (args) => await callback({ ...args, requestId: args.requestId }, extra),
    close: async () => {
      executor.stop();
      await server.close();
    },
  };
}

type InvokeDialogActionToolArgs = {
  session: string | undefined;
  dialog: {
    objectName: string;
    title: string;
    className: string;
    sessionId: string;
    revision: number;
  };
  requestId?: string;
  action: DialogActionInvocation;
};

function instanceFor(server: MockExternalApiServer, apiVersion = '0.2.23'): ExternalApiInstance {
  return {
    baseUrl: server.baseUrl,
    token: 'valid-token',
    pid: 999,
    instanceId: 'inst-invoke-dialog-action',
    apiVersion,
  };
}
