import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

import {
  desktopStateSchema,
  type DialogAction,
  type DialogActionInvocation,
  dialogListSchema,
  type InvokeDialogActionRequest,
  type InvokeDialogActionResult,
  invokeDialogActionResultSchema,
  type WindowInfo,
} from '../../../src/desktop/externalApi/types.js';
import { buildVariant } from '../build.js';
import { McpClient } from '../mcpClient.js';

const INITIAL_TOKEN = 'fixture-desktop-state-token';
const REFRESHED_TOKEN = 'fixture-refreshed-state-token';
const DECOY_TOKEN = 'fixture-decoy-state-token';
const SESSION = String(process.pid);
const DECOY_PID = process.ppid;
const MISSING_PID = 99_999_991;
const DIALOG_REQUEST_ID = 'headless-discard-request';

const dialogIdentity = {
  objectName: 'saveChangesDialog',
  title: 'Save Changes',
  className: 'QMessageBox',
  sessionId: 'headless-dialog-session',
  revision: 1,
};
const completedDialogStatus = {
  sessionId: dialogIdentity.sessionId,
  revision: dialogIdentity.revision,
  requestId: DIALOG_REQUEST_ID,
  state: 'completed',
  effect: 'dialog-dismissed',
};
const dialog = {
  ...dialogIdentity,
  messageText: 'Save the workbook?',
  informativeText: 'Unsaved work may be lost.',
  detailedText: 'Workbook: Regional Sales',
  detailedTextTruncated: true,
  buttons: ['Discard', 'Cancel'],
  actions: [
    { kind: 'button' as const, label: 'Discard' },
    { kind: 'button' as const, label: 'Cancel' },
    { kind: 'close' as const },
  ],
};

type ResponseMode = 'idle' | 'lifecycle' | 'not-found' | 'invalid' | 'hang' | 'unauthorized';

type ObservedRequest = {
  server: 'target' | 'decoy';
  method: string | undefined;
  url: string | undefined;
  authorization: string | undefined;
  contentType: string | undefined;
  body: string;
};

const nativeCases: Array<{
  family: string;
  action: DialogActionInvocation;
  capability: DialogAction;
  effect: string;
}> = [
  {
    family: 'file',
    action: {
      kind: 'save-file',
      path: 'C:\\exports\\report.twb',
      filterId: 'twb',
      overwriteConfirmed: false,
    },
    capability: {
      kind: 'save-file',
      filters: [{ id: 'twb', label: 'Tableau Workbook', patterns: ['*.twb'] }],
      defaultFilterId: 'twb',
      overwriteConfirmationRequired: false,
    },
    effect: 'file-choice-returned',
  },
  {
    family: 'file',
    action: {
      kind: 'choose-files',
      paths: ['C:\\data\\a.csv', 'C:\\data\\b.csv'],
      filterId: 'csv',
    },
    capability: {
      kind: 'choose-files',
      filters: [{ id: 'csv', label: 'CSV', patterns: ['*.csv'] }],
      defaultFilterId: 'csv',
      minimumPaths: 1,
      maximumPaths: 4,
    },
    effect: 'file-choice-returned',
  },
  {
    family: 'color',
    action: { kind: 'choose-color', red: 12, green: 34, blue: 56, alpha: 78 },
    capability: { kind: 'choose-color', alphaSupported: true },
    effect: 'color-returned',
  },
  {
    family: 'print',
    action: {
      kind: 'submit-print',
      printerId: 'pdf-printer',
      range: 'page-range',
      sheetScope: 'active-sheet',
      firstPage: 1,
      lastPage: 2,
      copies: 1,
      collate: false,
      exportSelection: false,
      outputPath: 'C:\\exports\\report.pdf',
    },
    capability: {
      kind: 'submit-print',
      printers: [{ id: 'pdf-printer', label: 'Print to PDF' }],
      ranges: ['all-pages', 'page-range'],
      sheetScopes: ['active-sheet'],
      minimumPage: 1,
      maximumPage: 2,
      minimumCopies: 1,
      maximumCopies: 1,
      supportsCollation: false,
      supportsPrintToFile: true,
      supportsExportSelection: false,
    },
    effect: 'print-prepared',
  },
];

describe('get-desktop-state real stdio MCP boundary', () => {
  let client: McpClient | undefined;
  let targetServer: Server | undefined;
  let decoyServer: Server | undefined;
  let tempHome: string | undefined;
  let discoveryDir: string;
  let targetBaseUrl: string;
  let decoyBaseUrl: string;
  let currentDiscoveryToken = INITIAL_TOKEN;
  let acceptedToken = INITIAL_TOKEN;
  let refreshDiscoveryOnUnauthorized: string | undefined;
  let mode: ResponseMode;
  let dialogOpen: boolean;
  let abortedRequests: number;
  let requests: Array<ObservedRequest>;
  let nativeScenario:
    | {
        dialog: WindowInfo;
        request: InvokeDialogActionRequest;
        result: InvokeDialogActionResult;
        panelClosed: boolean;
        callerFinished: boolean;
      }
    | undefined;

  beforeAll(async () => {
    await buildVariant('desktop');
    tempHome = await mkdtemp(join(tmpdir(), 'tableau-mcp-desktop-state-'));
    discoveryDir = join(tempHome, 'ExternalApi');
    await mkdir(discoveryDir, { recursive: true });

    targetServer = await startServer((request, response) => handleTarget(request, response));
    decoyServer = await startServer((request, response) => handleDecoy(request, response));
    targetBaseUrl = serverBaseUrl(targetServer);
    decoyBaseUrl = serverBaseUrl(decoyServer);

    await writeDiscovery({
      pid: process.pid,
      baseUrl: targetBaseUrl,
      token: currentDiscoveryToken,
      instanceId: 'headless-state-target',
      startedAt: '2026-09-11T10:00:00Z',
    });
    await writeDiscovery({
      pid: DECOY_PID,
      baseUrl: decoyBaseUrl,
      token: DECOY_TOKEN,
      instanceId: 'headless-state-newer-decoy',
      startedAt: '2026-09-11T11:00:00Z',
    });

    client = new McpClient({
      variant: 'desktop',
      env: {
        HOME: tempHome,
        LOCALAPPDATA: tempHome,
        XDG_DATA_HOME: tempHome,
        TABLEAU_EXTERNAL_API_DISCOVERY_DIR: discoveryDir,
        MAX_REQUEST_TIMEOUT_MS: '5000',
      },
    });
    await client.connect();
  });

  afterAll(async () => {
    const cleanupErrors: Array<unknown> = [];
    try {
      if (client) await client.close();
    } catch (error) {
      cleanupErrors.push(error);
    }

    for (const server of [targetServer, decoyServer]) {
      if (!server) continue;
      try {
        await closeServer(server);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }

    if (tempHome) {
      try {
        await rm(tempHome, { recursive: true, force: true });
      } catch (error) {
        cleanupErrors.push(error);
      }
    }

    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, 'Failed to clean up the desktop-state E2E harness.');
    }
  });

  beforeEach(() => {
    mode = 'idle';
    dialogOpen = true;
    abortedRequests = 0;
    requests = [];
    acceptedToken = currentDiscoveryToken;
    refreshDiscoveryOnUnauthorized = undefined;
    nativeScenario = undefined;
  });

  it('selects the exact requested PID among multiple live discovery candidates', async () => {
    mode = 'lifecycle';
    const tools = await requireClient().listTools();
    expect(tools).toContain('get-desktop-state');
    expect(tools).toContain('get-active-dialogs');
    expect(tools).toContain('invoke-dialog-action');

    const before = await readState();
    expect(before).toEqual({
      state: 'BLOCKED',
      blockedBy: 'MODAL_DIALOG',
      uiSnapshotAvailable: true,
      activeActivities: ['QUERYING'],
      blockingWindows: [dialog],
      progressWindows: [],
    });

    const inspected = await requireClient().callTool('get-active-dialogs', {
      schema: dialogListSchema,
      toolArgs: { session: SESSION },
    });
    expect(inspected).toEqual({
      dialogs: before.blockingWindows,
      uiSnapshotAvailable: true,
      recentActions: [],
    });

    const selectedDialog = inspected.dialogs[0];
    const selectedAction = selectedDialog.actions?.[0];
    expect(selectedAction).toEqual({ kind: 'button', label: 'Discard' });
    expect(
      await requireClient().callTool('invoke-dialog-action', {
        schema: invokeDialogActionResultSchema,
        toolArgs: {
          session: SESSION,
          dialog: {
            objectName: selectedDialog.objectName,
            title: selectedDialog.title,
            className: selectedDialog.className,
            sessionId: selectedDialog.sessionId,
            revision: selectedDialog.revision,
          },
          requestId: DIALOG_REQUEST_ID,
          action: selectedAction,
        },
      }),
    ).toEqual({
      outcome: 'completed',
      dialog: dialogIdentity,
      status: completedDialogStatus,
      uiSnapshotAvailable: true,
      dialogs: [],
    });
    expect(await readState()).toMatchObject({ state: 'IDLE', blockingWindows: [] });
    expect(
      await requireClient().callTool('get-active-dialogs', {
        schema: dialogListSchema,
        toolArgs: { session: SESSION },
      }),
    ).toEqual({
      dialogs: [],
      uiSnapshotAvailable: true,
      recentActions: [completedDialogStatus],
    });

    expect(requests.filter(({ server }) => server === 'decoy')).toEqual([]);
    expect(requests.map(({ method, url }) => `${method} ${url}`)).toEqual([
      'GET /v0/app/state',
      'GET /v0/app/dialogs',
      'POST /v0/app:invokeDialogAction',
      'GET /v0/app/state',
      'GET /v0/app/dialogs',
    ]);
  });

  it.each(nativeCases)(
    'tracks $action.kind across the stdio boundary without treating $effect as caller completion',
    async ({ family, action, capability, effect }) => {
      const request: InvokeDialogActionRequest = {
        dialog: { ...dialogIdentity, sessionId: `native-${action.kind}`, revision: 7 },
        requestId: `native-request-${action.kind}`,
        action,
      };
      const activeDialog: WindowInfo = {
        ...request.dialog,
        family,
        status: 'active',
        actions: [capability, { kind: 'cancel' }],
      };
      const pending: InvokeDialogActionResult = {
        dialog: request.dialog,
        outcome: 'dispatched-pending',
        status: {
          sessionId: request.dialog.sessionId,
          revision: request.dialog.revision,
          requestId: request.requestId,
          state: 'pending',
          effect: 'none',
        },
        uiSnapshotAvailable: false,
        dialogs: [],
      };
      nativeScenario = {
        dialog: activeDialog,
        request,
        result: pending,
        panelClosed: false,
        callerFinished: false,
      };
      const readDialogs = async (): Promise<ReturnType<typeof dialogListSchema.parse>> =>
        await requireClient().callTool('get-active-dialogs', {
          schema: dialogListSchema,
          toolArgs: { session: SESSION },
        });
      expect((await readDialogs()).dialogs).toEqual([activeDialog]);
      const invoke = async (): Promise<InvokeDialogActionResult> =>
        await requireClient().callTool('invoke-dialog-action', {
          schema: invokeDialogActionResultSchema,
          toolArgs: { session: SESSION, ...request },
        });
      expect(await invoke()).toEqual(pending);
      expect(await invoke()).toEqual(pending);
      const posts = requests.filter(({ method }) => method === 'POST');
      expect(posts).toHaveLength(2);
      expect(posts.map(({ body }) => JSON.parse(body))).toEqual([request, request]);

      nativeScenario.panelClosed = true;
      nativeScenario.result = {
        ...pending,
        outcome: 'completed',
        status: { ...pending.status, state: 'completed', effect },
        uiSnapshotAvailable: true,
      };
      expect(await readDialogs()).toEqual({
        dialogs: [],
        uiSnapshotAvailable: true,
        recentActions: [nativeScenario.result.status],
      });
      expect(await readState()).toMatchObject({ state: 'RUNNING', blockingWindows: [] });
      nativeScenario.callerFinished = true;
      expect(await readState()).toMatchObject({ state: 'IDLE', blockingWindows: [] });
      expect(requests.filter(({ server }) => server === 'decoy')).toEqual([]);
    },
  );

  it.each(['canceled', 'failed', 'indeterminate'])(
    'preserves a native print %s outcome carried by HTTP 200 without retrying',
    async (outcome) => {
      const printCase = nativeCases.find(({ family }) => family === 'print')!;
      const request = {
        dialog: dialogIdentity,
        requestId: `print-${outcome}`,
        action: printCase.action,
      };
      const result: InvokeDialogActionResult = {
        dialog: request.dialog,
        outcome,
        status: {
          sessionId: request.dialog.sessionId,
          revision: request.dialog.revision,
          requestId: request.requestId,
          state: outcome,
          effect: outcome === 'indeterminate' ? 'indeterminate' : 'none',
          ...(outcome === 'failed' ? { code: 'dialog-action-unsupported' } : {}),
        },
        uiSnapshotAvailable: false,
        dialogs: [],
      };
      nativeScenario = {
        dialog: { ...request.dialog, family: 'print', actions: [printCase.capability] },
        request,
        result,
        panelClosed: false,
        callerFinished: false,
      };
      expect(
        await requireClient().callTool('invoke-dialog-action', {
          schema: invokeDialogActionResultSchema,
          toolArgs: { session: SESSION, ...request },
        }),
      ).toEqual(result);
      expect(requests.filter(({ method }) => method === 'POST')).toHaveLength(1);
      expect(requests.filter(({ server }) => server === 'decoy')).toEqual([]);
    },
  );

  it('rescans discovery once after 401 and retries with the refreshed token', async () => {
    acceptedToken = REFRESHED_TOKEN;
    refreshDiscoveryOnUnauthorized = REFRESHED_TOKEN;

    expect(await readState()).toMatchObject({ state: 'IDLE' });

    const stateRequests = targetStateRequests();
    expect(stateRequests).toHaveLength(2);
    expect(stateRequests.map(({ authorization }) => authorization)).toEqual([
      `Bearer ${INITIAL_TOKEN}`,
      `Bearer ${REFRESHED_TOKEN}`,
    ]);
    expect(JSON.stringify(stateRequests)).not.toContain(DECOY_TOKEN);
  });

  it('maps a missing app-state route without disclosing discovery credentials', async () => {
    mode = 'not-found';

    const result = await rawStateCall(SESSION);
    const text = toolErrorText(result);

    expect(text).toContain('Desktop state endpoint');
    expect(text).toContain('too old for this read');
    expect(text).not.toContain(INITIAL_TOKEN);
    expect(text).not.toContain(REFRESHED_TOKEN);
    expect(text).not.toContain(DECOY_TOKEN);
  });

  it('rejects an invalid producer payload without disclosing discovery credentials', async () => {
    mode = 'invalid';

    const text = toolErrorText(await rawStateCall(SESSION));

    expect(text).toContain('"type":"invalid-response"');
    expect(text).not.toContain(INITIAL_TOKEN);
    expect(text).not.toContain(REFRESHED_TOKEN);
    expect(text).not.toContain(DECOY_TOKEN);
  });

  it('does not expose a 401 response body after the one allowed rescan', async () => {
    mode = 'unauthorized';

    const text = toolErrorText(await rawStateCall(SESSION));

    expect(text).toContain('401 after a rescan');
    expect(text).not.toContain(INITIAL_TOKEN);
    expect(text).not.toContain(REFRESHED_TOKEN);
    expect(text).not.toContain(DECOY_TOKEN);
    expect(targetStateRequests()).toHaveLength(2);
  });

  it('propagates an MCP request timeout to the hanging External API read', async () => {
    mode = 'hang';
    let thrown: unknown;

    try {
      await requireClient().client.callTool(
        { name: 'get-desktop-state', arguments: { session: SESSION } },
        undefined,
        { timeout: 100 },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeDefined();
    expect(String(thrown)).toMatch(/timed out|timeout/i);
    expect(JSON.stringify(thrown)).not.toContain(currentDiscoveryToken);
    await waitUntil(() => abortedRequests > 0);
  });

  it('propagates explicit MCP cancellation to the hanging External API read', async () => {
    mode = 'hang';
    const controller = new AbortController();
    const cancellation = setTimeout(() => controller.abort(), 50);
    let thrown: unknown;

    try {
      await requireClient().client.callTool(
        { name: 'get-desktop-state', arguments: { session: SESSION } },
        undefined,
        { signal: controller.signal, timeout: 5000 },
      );
    } catch (error) {
      thrown = error;
    } finally {
      clearTimeout(cancellation);
    }

    expect(thrown).toBeDefined();
    expect(String(thrown)).toMatch(/abort/i);
    expect(JSON.stringify(thrown)).not.toContain(currentDiscoveryToken);
    await waitUntil(() => abortedRequests > 0);
  });

  it('fails closed for missing and dead discovery records without contacting another PID', async () => {
    const deadProcess = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
    if (deadProcess.error || deadProcess.status !== 0) {
      throw (
        deadProcess.error ?? new Error(`Could not create a terminated PID: ${deadProcess.status}`)
      );
    }
    const deadPid = deadProcess.pid;

    await writeDiscovery({
      pid: deadPid,
      baseUrl: targetBaseUrl,
      token: 'dead-discovery-token',
      instanceId: 'dead-discovery',
      startedAt: '2026-09-11T12:00:00Z',
    });

    const missingText = toolErrorText(await rawStateCall(String(MISSING_PID)));
    const deadText = toolErrorText(await rawStateCall(String(deadPid)));

    expect(missingText).toContain(String(MISSING_PID));
    expect(deadText).toContain(String(deadPid));
    expect(missingText).not.toContain(currentDiscoveryToken);
    expect(deadText).not.toContain('dead-discovery-token');
    expect(requests).toEqual([]);
  });

  async function handleTarget(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await readBody(request);
    requests.push({
      server: 'target',
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization,
      contentType: request.headers['content-type'],
      body,
    });

    if (mode === 'hang') {
      trackAbortedResponse(request, response);
      return;
    }

    if (mode === 'unauthorized' || request.headers.authorization !== `Bearer ${acceptedToken}`) {
      if (refreshDiscoveryOnUnauthorized !== undefined) {
        currentDiscoveryToken = refreshDiscoveryOnUnauthorized;
        refreshDiscoveryOnUnauthorized = undefined;
        await writeDiscovery({
          pid: process.pid,
          baseUrl: targetBaseUrl,
          token: currentDiscoveryToken,
          instanceId: 'headless-state-target',
          startedAt: '2026-09-11T10:00:00Z',
        });
      }
      sendText(response, 401, currentDiscoveryToken);
      return;
    }

    if (request.method === 'GET' && request.url === '/v0/app/state') {
      if (nativeScenario && !nativeScenario.callerFinished) {
        sendJson(response, 200, {
          state: 'RUNNING',
          uiSnapshotAvailable: true,
          activeActivities: ['EXECUTING'],
          blockingWindows: nativeScenario.panelClosed ? [] : [nativeScenario.dialog],
          progressWindows: [],
        });
      } else if (mode === 'not-found') {
        sendJson(response, 404, {
          type: 'problem',
          title: 'Not found',
          status: 404,
          instance: '/v0/app/state',
          code: 'not-found',
          detail: 'No route matches GET /v0/app/state',
        });
      } else if (mode === 'invalid') {
        sendJson(response, 200, { state: 'IDLE', uiSnapshotAvailable: false });
      } else if (mode === 'lifecycle' && dialogOpen) {
        sendJson(response, 200, {
          state: 'BLOCKED',
          blockedBy: 'MODAL_DIALOG',
          uiSnapshotAvailable: true,
          activeActivities: ['QUERYING'],
          blockingWindows: [dialog],
          progressWindows: [],
        });
      } else {
        sendJson(response, 200, {
          state: 'IDLE',
          uiSnapshotAvailable: true,
          activeActivities: [],
          blockingWindows: [],
          progressWindows: [],
        });
      }
      return;
    }

    if (request.method === 'GET' && request.url === '/v0/app/dialogs') {
      if (nativeScenario) {
        const submitted = requests.some(({ method }) => method === 'POST');
        sendJson(response, 200, {
          dialogs: nativeScenario.panelClosed ? [] : [nativeScenario.dialog],
          uiSnapshotAvailable: true,
          recentActions: submitted ? [nativeScenario.result.status] : [],
        });
        return;
      }
      sendJson(response, 200, {
        dialogs: dialogOpen ? [dialog] : [],
        uiSnapshotAvailable: true,
        recentActions: dialogOpen ? [] : [completedDialogStatus],
      });
      return;
    }

    if (request.method === 'POST' && request.url === '/v0/app:invokeDialogAction') {
      const parsed = JSON.parse(body) as { dialog: Record<string, unknown>; action: unknown };
      if (nativeScenario) {
        expect(parsed).toEqual(nativeScenario.request);
        sendJson(response, 200, nativeScenario.result);
        return;
      }
      expect(parsed).toEqual({
        dialog: dialogIdentity,
        requestId: DIALOG_REQUEST_ID,
        action: { kind: 'button', label: 'Discard' },
      });
      dialogOpen = false;
      sendJson(response, 200, {
        outcome: 'completed',
        dialog: parsed.dialog,
        status: completedDialogStatus,
        uiSnapshotAvailable: true,
        dialogs: [],
      });
      return;
    }

    sendJson(response, 404, {
      code: 'not-found',
      status: 404,
      instance: request.url,
    });
  }

  async function handleDecoy(request: IncomingMessage, response: ServerResponse): Promise<void> {
    requests.push({
      server: 'decoy',
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization,
      contentType: request.headers['content-type'],
      body: await readBody(request),
    });
    sendJson(response, 200, {
      state: 'IDLE',
      uiSnapshotAvailable: true,
      activeActivities: [],
      blockingWindows: [],
      progressWindows: [],
    });
  }

  function trackAbortedResponse(request: IncomingMessage, response: ServerResponse): void {
    let counted = false;
    const countOnce = (): void => {
      if (!counted && !response.writableEnded) {
        counted = true;
        abortedRequests += 1;
      }
    };
    request.once('aborted', countOnce);
    response.once('close', countOnce);
  }

  async function writeDiscovery(args: {
    pid: number;
    baseUrl: string;
    token: string;
    instanceId: string;
    startedAt: string;
  }): Promise<void> {
    await writeFile(
      join(discoveryDir, `${args.pid}.json`),
      JSON.stringify({
        schemaVersion: 1,
        instanceId: args.instanceId,
        pid: args.pid,
        baseUrl: args.baseUrl,
        tokenType: 'Bearer',
        token: args.token,
        applicationVersion: 'headless-fixture',
        apiVersion: '0.2.31',
        startedAt: args.startedAt,
      }),
      'utf8',
    );
  }

  async function readState(): Promise<ReturnType<typeof desktopStateSchema.parse>> {
    return await requireClient().callTool('get-desktop-state', {
      schema: desktopStateSchema,
      toolArgs: { session: SESSION },
    });
  }

  async function rawStateCall(
    session: string,
  ): Promise<Awaited<ReturnType<McpClient['client']['callTool']>>> {
    return await requireClient().client.callTool({
      name: 'get-desktop-state',
      arguments: { session },
    });
  }

  function requireClient(): McpClient {
    if (!client) throw new Error('MCP client was not initialized.');
    return client;
  }

  function targetStateRequests(): Array<ObservedRequest> {
    return requests.filter(
      ({ server, method, url }) =>
        server === 'target' && method === 'GET' && url === '/v0/app/state',
    );
  }
});

async function startServer(
  handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>,
): Promise<Server> {
  const server = createServer((request, response) => {
    void handler(request, response).catch((error) => {
      if (!response.headersSent) {
        sendJson(response, 500, { error: String(error) });
      } else if (!response.writableEnded) {
        response.end();
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server;
}

function serverBaseUrl(server: Server): string {
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    request.on('data', (chunk) => {
      body += String(chunk);
    });
    request.on('end', () => resolve(body));
  });
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function sendText(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { 'content-type': 'text/plain' });
  response.end(body);
}

function toolErrorText(result: unknown): string {
  const parsed = CallToolResultSchema.parse(result);
  expect(parsed.isError).toBe(true);
  expect(parsed.content[0]?.type).toBe('text');
  return parsed.content[0]?.type === 'text' ? parsed.content[0].text : JSON.stringify(parsed);
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for the hanging External API request to be aborted.');
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function closeServer(server: Server): Promise<void> {
  server.closeIdleConnections();
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}
