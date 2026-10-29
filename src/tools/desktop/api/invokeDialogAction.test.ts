import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import {
  MockExternalApiServer,
  startMockExternalApiServer,
} from '../../../desktop/externalApi/mockExternalApiServer.js';
import {
  DialogIdentity,
  DialogRequestStatus,
  ExternalApiInstance,
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

type DialogRequest = {
  dialog: DialogIdentity;
  action: { kind: 'button' | 'close' | 'cancel'; label?: string };
};

const defaultRequest: DialogRequest = {
  dialog: {
    objectName: 'saveChangesDialog',
    title: 'Save Changes',
    className: 'QMessageBox',
    sessionId: 'dialog-session-1',
    revision: 0,
  },
  action: { kind: 'button', label: 'Discard' },
};

const exactStringRequest: DialogRequest = {
  dialog: {
    objectName: ' dialog object ',
    title: 'Café & Save?',
    className: 'Custom::Dialog',
    sessionId: 'dialog-session-7',
    revision: 3,
  },
  action: { kind: 'button', label: exactButtonLabel },
};

function statusFor(
  request: DialogRequest,
  state: DialogRequestStatus['state'],
  effect: DialogRequestStatus['effect'],
  code?: string,
): DialogRequestStatus {
  return {
    sessionId: request.dialog.sessionId,
    revision: request.dialog.revision,
    requestId: 'request-1',
    state,
    effect,
    ...(code === undefined ? {} : { code }),
  };
}

const successCases: Array<[string, InvokeDialogActionResult]> = [
  [
    'a click that dismisses the selected dialog',
    {
      outcome: 'completed',
      dialog: exactStringRequest.dialog,
      status: statusFor(exactStringRequest, 'completed', 'dialog-dismissed'),
      uiSnapshotAvailable: true,
      dialogs: [
        {
          objectName: 'nextDialog',
          title: 'Next decision',
          className: 'QMessageBox',
          sessionId: 'dialog-session-8',
          revision: 0,
          family: 'qt',
          status: 'active',
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
      outcome: 'completed',
      dialog: exactStringRequest.dialog,
      status: statusFor(exactStringRequest, 'completed', 'dialog-remains'),
      uiSnapshotAvailable: true,
      dialogs: [
        {
          ...exactStringRequest.dialog,
          revision: 4,
          messageText: 'Validation is still running.',
          buttons: ['  Discard & Close  ', 'Cancel'],
        },
      ],
    },
  ],
  [
    'a stale session identity',
    {
      outcome: 'failed',
      dialog: exactStringRequest.dialog,
      status: statusFor(exactStringRequest, 'failed', 'none', 'dialog-session-stale'),
      uiSnapshotAvailable: true,
      dialogs: [],
    },
  ],
  [
    'a dispatched native action whose result is still pending',
    {
      outcome: 'dispatched-pending',
      dialog: exactStringRequest.dialog,
      status: statusFor(exactStringRequest, 'pending', 'none'),
      uiSnapshotAvailable: true,
      dialogs: [],
    },
  ],
];

describe('invoke-dialog-action tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('declares the destructive, non-idempotent 0.2.26 action contract', () => {
    const tool = getInvokeDialogActionTool(new DesktopMcpServer());
    const schema = z.object(tool.paramsSchema as z.ZodRawShape);

    expect(tool.name).toBe('invoke-dialog-action');
    expect(tool.minApiVersion).toBe('0.2.26');
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
    ).toBe(false);
    expect(
      schema.safeParse({ dialog: defaultRequest.dialog, action: { kind: 'button' } }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ dialog: defaultRequest.dialog, action: { kind: 'button', label: '' } })
        .success,
    ).toBe(false);
    expect(schema.safeParse({ action: defaultRequest.action }).success).toBe(false);
    expect(
      schema.safeParse({ dialog: { title: 'Save Changes' }, action: defaultRequest.action })
        .success,
    ).toBe(false);
    expect(
      schema.safeParse({
        dialog: { objectName: 'd', title: 't', className: 'c' },
        action: defaultRequest.action,
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        dialog: defaultRequest.dialog,
        action: { ...defaultRequest.action, futureProperty: 'x' },
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ dialog: defaultRequest.dialog, action: { kind: 'cancel' } }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        dialog: defaultRequest.dialog,
        action: { kind: 'choose-file', path: '/Users/tableau/Orders.csv' },
      }).success,
    ).toBe(false);
  });

  it('redacts invocation logging while forwarding the exact sensitive request once', async () => {
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('321'));
    const response = successCases[0][1];
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
            sessionId: exactStringRequest.dialog.sessionId,
            revision: exactStringRequest.dialog.revision,
          },
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
      expectPostedRequest(posts[0].body, exactStringRequest);
    } finally {
      await harness.close();
    }
  });

  it('forwards a semantic close action without inventing a visible label', async () => {
    const request: DialogRequest = {
      dialog: {
        objectName: 'UnifiedDetailedErrorDialog',
        title: 'Unable to complete action',
        className: 'UnifiedDetailedErrorDialog',
        sessionId: 'dialog-session-2',
        revision: 1,
      },
      action: { kind: 'close' },
    };
    const response: InvokeDialogActionResult = {
      outcome: 'completed',
      dialog: request.dialog,
      status: statusFor(request, 'completed', 'dialog-dismissed'),
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
      expectPostedRequest(posts[0].body, request);
      expect(posts[0].body).not.toContain('"label"');
      expect(posts[0].body).not.toContain('"X"');
    } finally {
      await harness.close();
    }
  });

  it('sends a fresh request id on every call', async () => {
    const harness = await startHarness();
    setSuccess(harness.server, successCases[0][1]);

    try {
      await harness.callTool({ session: undefined, ...defaultRequest });
      await harness.callTool({ session: undefined, ...defaultRequest });

      const [first, second] = dialogPosts(harness.server).map(
        (post) => (JSON.parse(post.body) as { requestId: string }).requestId,
      );
      expect(first).toMatch(/^[!-~]{1,128}$/);
      expect(second).toMatch(/^[!-~]{1,128}$/);
      expect(first).not.toBe(second);
    } finally {
      await harness.close();
    }
  });

  it('uses the contract-faithful endpoint and returns its dismissed result unchanged', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ session: undefined, ...defaultRequest });

      expect(result.isError).toBe(false);
      expect(parseSuccess(result)).toMatchObject({
        outcome: 'completed',
        dialog: defaultRequest.dialog,
        status: { state: 'completed', effect: 'dialog-dismissed' },
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

  it.each([
    [400, 'invalid-request-body'],
    [403, 'origin-not-allowed'],
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

function expectPostedRequest(body: string, request: DialogRequest): void {
  const { requestId, ...rest } = JSON.parse(body) as { requestId: string };
  expect(requestId).toMatch(/^[!-~]{1,128}$/);
  expect(rest).toEqual(request);
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

type InvokeDialogActionToolArgs = DialogRequest & {
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
