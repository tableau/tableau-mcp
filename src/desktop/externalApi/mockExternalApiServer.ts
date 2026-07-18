import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { AddressInfo } from 'net';

import {
  EXTERNAL_API_ROUTES,
  HEADER_APPLICATION_VERSION,
  HEADER_XSD_PAYLOAD_VERSION,
} from './types.js';

/**
 * Contract-faithful mock of the Tableau Desktop External Client API, used by the
 * client + executor contract tests. Runs a real `node:http` loopback server on an
 * ephemeral port — no real Desktop, no external network.
 */

export type RecordedRequest = {
  method: string;
  path: string;
  authorization: string | undefined;
  contentType: string | undefined;
  body: string;
};

export type MockOverride = {
  status: number;
  contentType?: string;
  body?: string;
};

export type MockExternalApiServer = {
  baseUrl: string;
  port: number;
  requests: Array<RecordedRequest>;
  /** Rotate the token the server accepts (simulates a fresh discovery file). */
  setToken: (token: string) => void;
  /** Force a canned response for a `${METHOD} ${path}` key; pass undefined to clear. */
  setOverride: (key: string, override: MockOverride | undefined) => void;
  close: () => Promise<void>;
};

const DEFAULT_TOKEN = 'valid-token';
const DEFAULT_WORKBOOK_XML = '<?xml version="1.0"?><workbook><worksheets /></workbook>';

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => resolve(data));
  });

const sendJson = (res: ServerResponse, status: number, payload: unknown): void => {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body);
};

const sendProblem = (res: ServerResponse, status: number, code: string, detail: string): void => {
  res.writeHead(status, { 'content-type': 'application/problem+json' });
  res.end(JSON.stringify({ type: `about:blank#${code}`, title: code, status, detail, code }));
};

export async function startMockExternalApiServer(
  options: { token?: string; workbookXml?: string } = {},
): Promise<MockExternalApiServer> {
  let token = options.token ?? DEFAULT_TOKEN;
  const workbookXml = options.workbookXml ?? DEFAULT_WORKBOOK_XML;
  const requests: Array<RecordedRequest> = [];
  const overrides = new Map<string, MockOverride>();

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const method = req.method ?? 'GET';
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    const authorization = req.headers['authorization'];
    const contentType = req.headers['content-type'];
    const body = await readBody(req);
    requests.push({ method, path, authorization, contentType, body });

    // Bearer auth: a mismatched/absent token models a stale discovery file → 401.
    if (authorization !== `Bearer ${token}`) {
      sendProblem(res, 401, 'unauthorized', 'Stale or missing bearer token.');
      return;
    }

    const overrideKey = `${method} ${path}`;
    const override = overrides.get(overrideKey);
    if (override) {
      res.writeHead(override.status, {
        'content-type': override.contentType ?? 'application/problem+json',
      });
      res.end(override.body ?? '');
      return;
    }

    if (method === 'GET' && path === EXTERNAL_API_ROUTES.health) {
      sendJson(res, 200, { status: 'ok' });
      return;
    }

    if (method === 'GET' && path === EXTERNAL_API_ROUTES.app) {
      sendJson(res, 200, { name: 'Tableau Desktop', applicationVersion: '2026.1' });
      return;
    }

    if (method === 'GET' && path === EXTERNAL_API_ROUTES.workbookDocument) {
      res.writeHead(200, {
        'content-type': 'text/xml',
        [HEADER_APPLICATION_VERSION]: '2026.1',
        [HEADER_XSD_PAYLOAD_VERSION]: '2026.1.0',
      });
      res.end(workbookXml);
      return;
    }

    if (method === 'POST' && path === EXTERNAL_API_ROUTES.workbookDocument) {
      const ct = (contentType ?? '').split(';')[0].trim();
      if (ct !== 'application/xml' && ct !== 'text/xml') {
        sendProblem(res, 415, 'unsupported-content-type', `Unsupported content type: ${ct}`);
        return;
      }
      if (body.trim().length === 0) {
        sendProblem(res, 400, 'invalid-request-body', 'Empty workbook document body.');
        return;
      }
      sendJson(res, 200, {
        operationId: 'op-doc-1',
        state: 'succeeded',
        createdAt: '2026-07-07T10:00:00Z',
        completedAt: '2026-07-07T10:00:01Z',
        result: { bytesApplied: body.length },
      });
      return;
    }

    if (method === 'POST' && path === EXTERNAL_API_ROUTES.invokeCommand) {
      let parsed: { namespace?: string; command?: string; parameters?: unknown };
      try {
        parsed = JSON.parse(body);
      } catch {
        sendProblem(res, 400, 'invalid-request-body', 'Body was not valid JSON.');
        return;
      }

      if (parsed.command === 'missing-command') {
        sendProblem(res, 404, 'command-not-found', `Unknown command: ${parsed.command}`);
        return;
      }
      if (parsed.command === 'bad-param') {
        sendProblem(res, 400, 'invalid-command-parameter', 'Invalid parameter provided.');
        return;
      }
      if (parsed.command === 'fail-op') {
        sendJson(res, 200, {
          operationId: 'op-fail-1',
          state: 'failed',
          createdAt: '2026-07-07T10:00:00Z',
          completedAt: '2026-07-07T10:00:01Z',
          error: { code: 'operation-failed', title: 'operation-failed', detail: 'command blew up' },
        });
        return;
      }

      sendJson(res, 200, {
        operationId: 'op-cmd-1',
        state: 'succeeded',
        createdAt: '2026-07-07T10:00:00Z',
        completedAt: '2026-07-07T10:00:01Z',
        result: {
          namespace: parsed.namespace,
          command: parsed.command,
          echoedParameters: parsed.parameters ?? null,
        },
      });
      return;
    }

    if (method === 'GET' && path === EXTERNAL_API_ROUTES.worksheets) {
      sendJson(res, 200, {
        worksheets: [
          { id: 'w1', name: 'Sheet 1', hidden: false },
          { id: 'w2', name: 'Sales', hidden: false },
        ],
      });
      return;
    }

    if (method === 'GET' && path === EXTERNAL_API_ROUTES.dashboards) {
      sendJson(res, 200, {
        dashboards: [{ id: 'd1', name: 'Sales Dashboard', hidden: false }],
      });
      return;
    }

    const worksheetDocMatch = path.match(/^\/v0\/workbook\/worksheets\/([^/]+)\/document$/);
    if (method === 'GET' && worksheetDocMatch) {
      const id = decodeURIComponent(worksheetDocMatch[1]);
      if (id !== 'w1' && id !== 'w2') {
        sendProblem(res, 404, 'sheet-not-found', `Unknown worksheet: ${id}`);
        return;
      }
      res.writeHead(200, {
        'content-type': 'text/xml',
        [HEADER_APPLICATION_VERSION]: '2026.1',
        [HEADER_XSD_PAYLOAD_VERSION]: '2026.1.0',
      });
      res.end(`<worksheet name='${id}'><table /></worksheet>`);
      return;
    }

    const summaryDataMatch = path.match(/^\/v0\/workbook\/worksheets\/([^/]+)\/summaryData$/);
    if (method === 'GET' && summaryDataMatch) {
      const id = decodeURIComponent(summaryDataMatch[1]);
      if (id !== 'w1' && id !== 'w2') {
        sendProblem(res, 404, 'sheet-not-found', `Unknown worksheet: ${id}`);
        return;
      }
      sendJson(res, 200, {
        columns: [
          { name: 'Category', dataType: 'string' },
          { name: 'Sales', dataType: 'real' },
        ],
        rows: [
          ['Furniture', 1000],
          ['Technology', 2000],
        ],
      });
      return;
    }

    const dashboardDocMatch = path.match(/^\/v0\/workbook\/dashboards\/([^/]+)\/document$/);
    if (method === 'GET' && dashboardDocMatch) {
      const id = decodeURIComponent(dashboardDocMatch[1]);
      if (id !== 'd1') {
        sendProblem(res, 404, 'sheet-not-found', `Unknown dashboard: ${id}`);
        return;
      }
      res.writeHead(200, {
        'content-type': 'text/xml',
        [HEADER_APPLICATION_VERSION]: '2026.1',
        [HEADER_XSD_PAYLOAD_VERSION]: '2026.1.0',
      });
      res.end(`<dashboard name='${id}'><zones /></dashboard>`);
      return;
    }

    if (method === 'GET' && path === EXTERNAL_API_ROUTES.openapi) {
      sendJson(res, 200, {
        openapi: '3.1.0',
        info: { title: 'Tableau External Client API', version: '1.0' },
      });
      return;
    }

    sendProblem(res, 404, 'not-found', `No route for ${method} ${path}`);
  };

  const server: Server = createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) {
        sendProblem(res, 500, 'operation-failed', 'Mock server error.');
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    port,
    requests,
    setToken: (next: string): void => {
      token = next;
    },
    setOverride: (key: string, override: MockOverride | undefined): void => {
      if (override) {
        overrides.set(key, override);
      } else {
        overrides.delete(key);
      }
    },
    close: (): Promise<void> =>
      new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}
