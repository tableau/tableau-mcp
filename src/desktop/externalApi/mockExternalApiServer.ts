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
  searchParams: Record<string, string>;
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
const DEFAULT_WORKSHEET_XML =
  '<worksheet name="Sales by Region"><table><rows /></table></worksheet>';
const DEFAULT_DASHBOARD_XML =
  '<dashboard name="Executive Dashboard"><zones><zone name="Sales by Region" /></zones></dashboard>';
const DEFAULT_STORYBOARD_XML = '<storyboard name="QBR Story"><story-points /></storyboard>';
const DEFAULT_WORKSHEETS = [
  {
    id: 'sheet-sales',
    name: 'Sales by Region',
    type: 'WORKSHEET',
    hidden: false,
    index: 0,
    datasources: ['Sample - Superstore'],
  },
  {
    id: 'sheet-profit',
    name: 'Profit by Category',
    type: 'WORKSHEET',
    hidden: false,
    index: 1,
    datasources: ['Sample - Superstore'],
  },
];
const DEFAULT_DASHBOARDS = [
  {
    id: 'dash-exec',
    name: 'Executive Dashboard',
    type: 'DASHBOARD',
    hidden: false,
    index: 2,
    containedSheets: ['sheet-sales', 'sheet-profit'],
  },
];
const DEFAULT_STORYBOARDS = [
  {
    id: 'story-qbr',
    name: 'QBR Story',
    type: 'STORYBOARD',
    hidden: false,
    index: 3,
    storyPointCount: 4,
  },
];
const DEFAULT_WORKBOOK_DATASOURCES = [
  {
    id: 'wb-ds-superstore',
    name: 'Sample - Superstore',
    caption: 'Sample - Superstore',
  },
  {
    id: 'wb-ds-quota',
    name: 'Quota Targets',
    caption: 'Quota Targets',
  },
];
const DEFAULT_SUMMARY_DATA = {
  columns: [
    { name: 'Region', dataType: 'string' },
    { name: 'Sales', dataType: 'real' },
    { name: 'Profit', dataType: 'real' },
  ],
  rows: [
    ['West', 1200, 240],
    ['East', 900, 120],
  ],
};
const DEFAULT_SITE_DATASOURCES = [
  {
    id: 'ds-superstore',
    luid: 'luid-superstore',
    name: 'Sample - Superstore',
    caption: 'Sample - Superstore',
    project: 'Samples',
    contentUrl: 'sample-superstore',
  },
  {
    id: 'ds-quota',
    luid: 'luid-quota',
    name: 'Quota Targets',
    caption: 'Quota Targets',
    project: 'Sales',
    contentUrl: 'quota-targets',
  },
];
const DEFAULT_SITE_WORKBOOKS = [
  {
    id: 'wb-regional-sales',
    luid: 'luid-regional-sales',
    name: 'Regional Sales Analysis',
    project: 'Sales',
  },
  {
    id: 'wb-ops-scorecard',
    luid: 'luid-ops-scorecard',
    name: 'Ops Scorecard',
    project: 'Operations',
  },
];

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

const sendXml = (res: ServerResponse, status: number, xml: string): void => {
  res.writeHead(status, {
    'content-type': 'application/xml',
    [HEADER_APPLICATION_VERSION]: '2026.1',
    [HEADER_XSD_PAYLOAD_VERSION]: '2026.1.0',
  });
  res.end(xml);
};

// Models the live 0.1.0 Problem shape: `type: 'problem'` + required code/status/instance,
// human text in `title`. `detail` is an RFC-9457 member additionalProperties admits.
const sendProblem = (res: ServerResponse, status: number, code: string, detail: string): void => {
  res.writeHead(status, { 'content-type': 'application/problem+json' });
  res.end(
    JSON.stringify({ type: 'problem', title: detail, status, instance: '/v0/mock', detail, code }),
  );
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
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;
    const searchParams = Object.fromEntries(url.searchParams.entries());
    const authorization = req.headers['authorization'];
    const contentType = req.headers['content-type'];
    const body = await readBody(req);
    requests.push({ method, path, searchParams, authorization, contentType, body });

    // Bearer auth: a mismatched/absent token models a stale discovery file → 401.
    if (authorization !== `Bearer ${token}`) {
      sendProblem(res, 401, 'unauthenticated', 'Stale or missing bearer token.');
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

    if (method === 'GET' && path === EXTERNAL_API_ROUTES.root) {
      sendJson(res, 200, {
        apiVersion: '0.1.0',
        applicationVersion: '2026.1',
        links: {
          health: '/v0/health',
          app: '/v0/app',
          workbook: '/v0/workbook',
          site: '/v0/site',
        },
      });
      return;
    }

    if (method === 'GET' && path === EXTERNAL_API_ROUTES.app) {
      sendJson(res, 200, {
        name: 'Tableau Desktop',
        applicationVersion: '2026.1',
        build: '20261.26.0701.1234',
        edition: 'Professional',
        os: 'macOS',
        locale: 'en_US',
        repositoryLocation: '/Users/tableau/Documents/My Tableau Repository',
        logLocation: '/Users/tableau/Library/Logs/Tableau',
      });
      return;
    }

    if (method === 'GET' && path === EXTERNAL_API_ROUTES.workbook) {
      sendJson(res, 200, {
        title: 'Regional Sales Analysis',
        location: '/Users/tableau/Documents/regional-sales.twb',
        unsavedChanges: true,
        worksheets: DEFAULT_WORKSHEETS,
        dashboards: DEFAULT_DASHBOARDS,
        storyboards: DEFAULT_STORYBOARDS,
      });
      return;
    }

    if (method === 'GET' && path === EXTERNAL_API_ROUTES.workbookDatasources) {
      sendJson(res, 200, { datasources: DEFAULT_WORKBOOK_DATASOURCES });
      return;
    }

    if (method === 'GET' && path === EXTERNAL_API_ROUTES.workbookDocument) {
      sendXml(res, 200, workbookXml);
      return;
    }

    if (method === 'GET' && path === EXTERNAL_API_ROUTES.workbookWorksheets) {
      sendJson(res, 200, { worksheets: DEFAULT_WORKSHEETS });
      return;
    }

    if (method === 'GET' && path === EXTERNAL_API_ROUTES.workbookDashboards) {
      sendJson(res, 200, { dashboards: DEFAULT_DASHBOARDS });
      return;
    }

    if (method === 'GET' && path === EXTERNAL_API_ROUTES.workbookStoryboards) {
      sendJson(res, 200, { storyboards: DEFAULT_STORYBOARDS });
      return;
    }

    const dashboardMatch = path.match(/^\/v0\/workbook\/dashboards\/([^/]+)$/);
    if (method === 'GET' && dashboardMatch) {
      const dashboardId = decodeURIComponent(dashboardMatch[1]);
      const dashboard = DEFAULT_DASHBOARDS.find((candidate) => candidate.id === dashboardId);
      if (!dashboard) {
        sendProblem(res, 404, 'sheet-not-found', `Dashboard not found: ${dashboardId}`);
        return;
      }
      sendJson(res, 200, dashboard);
      return;
    }

    const storyboardMatch = path.match(/^\/v0\/workbook\/storyboards\/([^/]+)$/);
    if (method === 'GET' && storyboardMatch) {
      const storyboardId = decodeURIComponent(storyboardMatch[1]);
      const storyboard = DEFAULT_STORYBOARDS.find((candidate) => candidate.id === storyboardId);
      if (!storyboard) {
        sendProblem(res, 404, 'sheet-not-found', `Storyboard not found: ${storyboardId}`);
        return;
      }
      sendJson(res, 200, storyboard);
      return;
    }

    const worksheetDocumentMatch = path.match(/^\/v0\/workbook\/worksheets\/([^/]+)\/document$/);
    if (method === 'GET' && worksheetDocumentMatch) {
      const worksheetId = decodeURIComponent(worksheetDocumentMatch[1]);
      if (!DEFAULT_WORKSHEETS.some((worksheet) => worksheet.id === worksheetId)) {
        sendProblem(res, 404, 'sheet-not-found', `Worksheet not found: ${worksheetId}`);
        return;
      }
      sendXml(res, 200, DEFAULT_WORKSHEET_XML);
      return;
    }

    const dashboardDocumentMatch = path.match(/^\/v0\/workbook\/dashboards\/([^/]+)\/document$/);
    if (method === 'GET' && dashboardDocumentMatch) {
      const dashboardId = decodeURIComponent(dashboardDocumentMatch[1]);
      if (!DEFAULT_DASHBOARDS.some((dashboard) => dashboard.id === dashboardId)) {
        sendProblem(res, 404, 'sheet-not-found', `Dashboard not found: ${dashboardId}`);
        return;
      }
      sendXml(res, 200, DEFAULT_DASHBOARD_XML);
      return;
    }

    const storyboardDocumentMatch = path.match(/^\/v0\/workbook\/storyboards\/([^/]+)\/document$/);
    if (method === 'GET' && storyboardDocumentMatch) {
      const storyboardId = decodeURIComponent(storyboardDocumentMatch[1]);
      if (!DEFAULT_STORYBOARDS.some((storyboard) => storyboard.id === storyboardId)) {
        sendProblem(res, 404, 'sheet-not-found', `Storyboard not found: ${storyboardId}`);
        return;
      }
      sendXml(res, 200, DEFAULT_STORYBOARD_XML);
      return;
    }

    const worksheetMatch = path.match(/^\/v0\/workbook\/worksheets\/([^/]+)$/);
    if (method === 'GET' && worksheetMatch) {
      const worksheetId = decodeURIComponent(worksheetMatch[1]);
      const worksheet = DEFAULT_WORKSHEETS.find((candidate) => candidate.id === worksheetId);
      if (!worksheet) {
        sendProblem(res, 404, 'sheet-not-found', `Worksheet not found: ${worksheetId}`);
        return;
      }
      sendJson(res, 200, worksheet);
      return;
    }

    const summaryDataMatch = path.match(/^\/v0\/workbook\/worksheets\/([^/]+)\/summaryData$/);
    if (method === 'GET' && summaryDataMatch) {
      const worksheetId = decodeURIComponent(summaryDataMatch[1]);
      if (!DEFAULT_WORKSHEETS.some((worksheet) => worksheet.id === worksheetId)) {
        sendProblem(res, 404, 'sheet-not-found', `Worksheet not found: ${worksheetId}`);
        return;
      }
      sendJson(res, 200, DEFAULT_SUMMARY_DATA);
      return;
    }

    if (method === 'GET' && path === EXTERNAL_API_ROUTES.site) {
      sendJson(res, 200, {
        siteId: 'site-sales',
        authenticatedUserId: 'user-author',
      });
      return;
    }

    if (method === 'GET' && path === EXTERNAL_API_ROUTES.siteDatasources) {
      sendJson(res, 200, { datasources: DEFAULT_SITE_DATASOURCES });
      return;
    }

    if (method === 'GET' && path === EXTERNAL_API_ROUTES.siteWorkbooks) {
      sendJson(res, 200, { workbooks: DEFAULT_SITE_WORKBOOKS });
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
        id: 'op-doc-1',
        kind: 'workbook.document.apply',
        state: 'succeeded',
        createdAt: '2026-07-07T10:00:00Z',
        completedAt: '2026-07-07T10:00:01Z',
        result: { bytesApplied: body.length },
      });
      return;
    }

    if (method === 'POST' && path === EXTERNAL_API_ROUTES.workbookDocumentValidate) {
      const ct = (contentType ?? '').split(';')[0].trim();
      if (ct !== 'application/xml' && ct !== 'text/xml') {
        sendProblem(res, 415, 'unsupported-content-type', `Unsupported content type: ${ct}`);
        return;
      }
      if (body.trim().length === 0) {
        sendProblem(res, 400, 'invalid-request-body', 'Empty workbook document body.');
        return;
      }
      sendJson(res, 200, { isValid: true, validationIssues: [] });
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
          id: 'op-fail-1',
          kind: 'command.invoke',
          state: 'failed',
          createdAt: '2026-07-07T10:00:00Z',
          completedAt: '2026-07-07T10:00:01Z',
          error: { code: 'operation-failed', message: 'command blew up' },
        });
        return;
      }

      sendJson(res, 200, {
        id: 'op-cmd-1',
        kind: 'command.invoke',
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

    if (method === 'GET' && path === EXTERNAL_API_ROUTES.openapi) {
      sendJson(res, 200, {
        openapi: '3.1.0',
        info: { title: 'Tableau External Client API', version: '1.0' },
      });
      return;
    }

    sendProblem(res, 404, 'not-found', `No route matches ${method} ${path}`);
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
