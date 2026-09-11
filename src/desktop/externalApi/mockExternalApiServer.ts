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
  hang?: boolean;
  /** Extra response headers (e.g. `Location`, `Retry-After`) — the async-dispatch 202 carries these. */
  headers?: Record<string, string>;
};

/** Successive `GET /v0/operations/{id}` responses; each poll advances one entry, the last repeats. */
export type MockOperation = {
  poll: Array<Record<string, unknown>>;
  /** `Retry-After` (seconds) stamped on every poll response; omit for none. */
  retryAfterSeconds?: number;
};

export type MockExternalApiServer = {
  baseUrl: string;
  port: number;
  requests: Array<RecordedRequest>;
  /** Rotate the token the server accepts (simulates a fresh discovery file). */
  setToken: (token: string) => void;
  /** Force a canned response for a `${METHOD} ${path}` key; pass undefined to clear. */
  setOverride: (key: string, override: MockOverride | undefined) => void;
  /**
   * Register an operation the `/v0/operations/{id}` poll route will serve. Pass undefined to
   * make it a 404 `operation-not-found`. Combine with a 202 override on the dispatching route
   * (Location → `/v0/operations/{id}`) to exercise the full 202 → poll → terminal path.
   */
  setOperation: (id: string, operation: MockOperation | undefined) => void;
  close: () => Promise<void>;
};

const DEFAULT_TOKEN = 'valid-token';
const DEFAULT_WORKBOOK_XML = '<?xml version="1.0"?><workbook><worksheets /></workbook>';
// The per-item /document routes return the requested item's bare fragment directly — a
// `<worksheet>` or `<dashboard>`, not wrapped in a `<workbook>`. The handler serves the same
// fragment for any known id of that kind, standing in for the resolved item.
const DEFAULT_WORKSHEET_DOCUMENT_XML =
  '<?xml version="1.0"?>' +
  '<worksheet name="Sales by Region"><table>' +
  '<view><datasources><datasource name="Sample - Superstore" /></datasources></view>' +
  '<rows>[Sample - Superstore].[none:Region:nk]</rows>' +
  '<cols>[Sample - Superstore].[sum:Sales:qk]</cols>' +
  '</table><simple-id uuid="sheet-sales" /></worksheet>';
const DEFAULT_DASHBOARD_DOCUMENT_XML =
  '<?xml version="1.0"?>' +
  '<dashboard name="Executive Dashboard"><zones><zone name="Sales by Region" /></zones><simple-id uuid="dash-exec" /></dashboard>';
// A storyboard serializes as a `<dashboard type='storyboard'>`, and its /document route returns
// that bare fragment directly — not a `<storyboard>` element, and not wrapped in a `<workbook>`.
const DEFAULT_STORYBOARD_DOCUMENT_XML =
  '<?xml version="1.0"?>' +
  '<dashboard name="QBR Story" type="storyboard"><zones><zone name="Sales by Region" /></zones><simple-id uuid="story-qbr" /></dashboard>';
const DEFAULT_WORKSHEETS = [
  {
    id: 'sheet-sales',
    name: 'Sales by Region',
    type: 'WORKSHEET',
    hidden: false,
    isActiveSheet: true,
    isAutoUpdatesPaused: false,
    index: 0,
    datasources: ['Sample - Superstore'],
  },
  {
    id: 'sheet-profit',
    name: 'Profit by Category',
    type: 'WORKSHEET',
    hidden: false,
    isActiveSheet: false,
    isAutoUpdatesPaused: true,
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
    isActiveSheet: false,
    isAutoUpdatesPaused: false,
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
    isActiveSheet: false,
    index: 3,
    storyPointCount: 4,
  },
];
const DEFAULT_WORKBOOK_DATASOURCES = [
  {
    id: 'wb-ds-superstore',
    // Published, non-federated: the server resolves a real LUID.
    luid: 'luid-superstore',
    name: 'Sample - Superstore',
    caption: 'Sample - Superstore',
    type: 'relational',
    isExtract: true,
    hasDownloadFilePermission: true,
  },
  {
    id: 'wb-ds-quota',
    // Embedded/federated: the API emits luid: null.
    luid: null,
    name: 'Quota Targets',
    caption: 'Quota Targets',
    type: 'federated',
    isExtract: false,
    // Unpublished: hasDownloadFilePermission is null (permission N/A), projected out like a null luid.
    hasDownloadFilePermission: null,
  },
  {
    // luid absent entirely (older API build that predates the field): exercises
    // the `undefined` leg of `luid: z.string().nullish()` — the reason it's
    // nullish() rather than nullable(). type/isExtract/hasDownloadFilePermission
    // are likewise absent, exercising the fail-open `undefined` leg of each newer
    // field. All projected out of the tool output.
    id: 'wb-ds-legacy',
    name: 'Legacy Extract',
    caption: 'Legacy Extract',
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
const DEFAULT_LOGICAL_TABLES = [
  { id: 'lt-orders', caption: 'Orders' },
  { id: 'lt-returns', caption: 'Returns' },
];
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

const sendOperation = (res: ServerResponse, command: string): void => {
  sendJson(res, 200, {
    id: `op-${command}-1`,
    kind: `tabdoc:${command}`,
    state: 'succeeded',
    createdAt: '2026-07-07T10:00:00Z',
    completedAt: '2026-07-07T10:00:01Z',
    result: {},
  });
};

const sheetIdKnown = (kindSegment: string, id: string): boolean => {
  const inventory =
    kindSegment === 'worksheets'
      ? DEFAULT_WORKSHEETS
      : kindSegment === 'dashboards'
        ? DEFAULT_DASHBOARDS
        : DEFAULT_STORYBOARDS;
  return inventory.some((item) => item.id === id);
};

// The per-sheet `/document` POST routes share the whole-workbook POST contract: reject a non-XML
// content type (415), an empty body (400), or an unknown sheet id (404 — the route resolves by id
// and cannot create), and otherwise return a succeeded operation envelope. `known` guards the id.
const sendDocumentApply = (
  res: ServerResponse,
  contentType: string | undefined,
  body: string,
  id: string,
  known: boolean,
  kind: string,
): void => {
  if (!known) {
    sendProblem(res, 404, 'sheet-not-found', `${kind} not found: ${id}`);
    return;
  }
  const ct = (contentType ?? '').split(';')[0].trim();
  if (ct !== 'application/xml' && ct !== 'text/xml') {
    sendProblem(res, 415, 'unsupported-content-type', `Unsupported content type: ${ct}`);
    return;
  }
  if (body.trim().length === 0) {
    sendProblem(res, 400, 'invalid-request-body', 'Empty document body.');
    return;
  }
  sendJson(res, 200, {
    id: 'op-doc-1',
    kind: `${kind.toLowerCase()}.document.apply`,
    state: 'succeeded',
    createdAt: '2026-07-07T10:00:00Z',
    completedAt: '2026-07-07T10:00:01Z',
    result: { bytesApplied: body.length },
  });
};

// A 1x1 PNG, base64-encoded — enough to exercise the inline-image decode path.
const SAMPLE_IMAGE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

// Models the image export contract: a relative or `..`-bearing filePath is a 400 before
// dispatch; an absolute filePath returns the path (no bytes); otherwise the base64 bytes
// ride in the envelope. width/height are always present.
const sendImageExport = (
  res: ServerResponse,
  searchParams: Record<string, string>,
  width: number,
  height: number,
): void => {
  // The server declares the actual rendered format on every rendered response, on both the
  // filePath and inline-bytes branches. The filePath branch writes the file in the requested
  // format, so it echoes the requested mimeType (png default). The inline branch always returns
  // SAMPLE_IMAGE_BASE64 (a PNG), so it always declares image/png to keep the envelope consistent.
  const filePath = searchParams['filePath'];
  if (filePath !== undefined && filePath.length > 0) {
    const isAbsolute = filePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(filePath);
    if (!isAbsolute || filePath.split(/[\\/]/).includes('..')) {
      sendProblem(res, 400, 'invalid-query-parameter', `Invalid filePath: ${filePath}`);
      return;
    }
    const effectiveMimeType = searchParams['mimeType'] || 'image/png';
    sendJson(res, 200, { filePath, width, height, effectiveMimeType });
    return;
  }
  sendJson(res, 200, {
    imageBase64: SAMPLE_IMAGE_BASE64,
    width,
    height,
    effectiveMimeType: 'image/png',
  });
};

export async function startMockExternalApiServer(
  options: { token?: string; workbookXml?: string } = {},
): Promise<MockExternalApiServer> {
  let token = options.token ?? DEFAULT_TOKEN;
  const workbookXml = options.workbookXml ?? DEFAULT_WORKBOOK_XML;
  const requests: Array<RecordedRequest> = [];
  const overrides = new Map<string, MockOverride>();
  const operations = new Map<string, MockOperation>();
  const operationCursors = new Map<string, number>();

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
      if (override.hang) {
        return;
      }
      res.writeHead(override.status, {
        'content-type': override.contentType ?? 'application/problem+json',
        ...override.headers,
      });
      res.end(override.body ?? '');
      return;
    }

    const operationByIdMatch = path.match(/^\/v0\/operations\/([^/]+)$/);
    if (method === 'GET' && operationByIdMatch) {
      const operationId = decodeURIComponent(operationByIdMatch[1]);
      const operation = operations.get(operationId);
      if (!operation || operation.poll.length === 0) {
        sendProblem(res, 404, 'operation-not-found', `Operation not found: ${operationId}`);
        return;
      }
      const cursor = operationCursors.get(operationId) ?? 0;
      const state = operation.poll[Math.min(cursor, operation.poll.length - 1)];
      operationCursors.set(operationId, cursor + 1);
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (operation.retryAfterSeconds !== undefined) {
        headers['retry-after'] = String(operation.retryAfterSeconds);
      }
      res.writeHead(200, headers);
      res.end(JSON.stringify(state));
      return;
    }

    if (method === 'GET' && path === '/v0/operations') {
      const all = [...operations.values()].flatMap((op) =>
        op.poll.length > 0 ? [op.poll[op.poll.length - 1]] : [],
      );
      sendJson(res, 200, { operations: all });
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
        isStartPageVisible: false,
        isDataSourcePageActive: false,
        isPresentationMode: false,
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
    if (worksheetDocumentMatch) {
      const worksheetId = decodeURIComponent(worksheetDocumentMatch[1]);
      const known = DEFAULT_WORKSHEETS.some((worksheet) => worksheet.id === worksheetId);
      if (method === 'GET') {
        if (!known) {
          sendProblem(res, 404, 'sheet-not-found', `Worksheet not found: ${worksheetId}`);
          return;
        }
        sendXml(res, 200, DEFAULT_WORKSHEET_DOCUMENT_XML);
        return;
      }
      if (method === 'POST') {
        sendDocumentApply(res, contentType, body, worksheetId, known, 'Worksheet');
        return;
      }
    }

    const dashboardDocumentMatch = path.match(/^\/v0\/workbook\/dashboards\/([^/]+)\/document$/);
    if (dashboardDocumentMatch) {
      const dashboardId = decodeURIComponent(dashboardDocumentMatch[1]);
      const known = DEFAULT_DASHBOARDS.some((dashboard) => dashboard.id === dashboardId);
      if (method === 'GET') {
        if (!known) {
          sendProblem(res, 404, 'sheet-not-found', `Dashboard not found: ${dashboardId}`);
          return;
        }
        sendXml(res, 200, DEFAULT_DASHBOARD_DOCUMENT_XML);
        return;
      }
      if (method === 'POST') {
        sendDocumentApply(res, contentType, body, dashboardId, known, 'Dashboard');
        return;
      }
    }

    const storyboardDocumentMatch = path.match(/^\/v0\/workbook\/storyboards\/([^/]+)\/document$/);
    if (storyboardDocumentMatch) {
      const storyboardId = decodeURIComponent(storyboardDocumentMatch[1]);
      const known = DEFAULT_STORYBOARDS.some((storyboard) => storyboard.id === storyboardId);
      if (method === 'GET') {
        if (!known) {
          sendProblem(res, 404, 'sheet-not-found', `Storyboard not found: ${storyboardId}`);
          return;
        }
        sendXml(res, 200, DEFAULT_STORYBOARD_DOCUMENT_XML);
        return;
      }
      if (method === 'POST') {
        sendDocumentApply(res, contentType, body, storyboardId, known, 'Storyboard');
        return;
      }
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

    const logicalTablesMatch = path.match(/^\/v0\/workbook\/worksheets\/([^/]+)\/logicalTables$/);
    if (method === 'GET' && logicalTablesMatch) {
      const worksheetId = decodeURIComponent(logicalTablesMatch[1]);
      if (!DEFAULT_WORKSHEETS.some((worksheet) => worksheet.id === worksheetId)) {
        sendProblem(res, 404, 'sheet-not-found', `Worksheet not found: ${worksheetId}`);
        return;
      }
      sendJson(res, 200, { tables: DEFAULT_LOGICAL_TABLES });
      return;
    }

    const logicalTableDataMatch = path.match(
      /^\/v0\/workbook\/worksheets\/([^/]+)\/logicalTables\/([^/]+)\/data$/,
    );
    if (method === 'GET' && logicalTableDataMatch) {
      const worksheetId = decodeURIComponent(logicalTableDataMatch[1]);
      const logicalTableId = decodeURIComponent(logicalTableDataMatch[2]);
      if (!DEFAULT_WORKSHEETS.some((worksheet) => worksheet.id === worksheetId)) {
        sendProblem(res, 404, 'sheet-not-found', `Worksheet not found: ${worksheetId}`);
        return;
      }
      if (!DEFAULT_LOGICAL_TABLES.some((table) => table.id === logicalTableId)) {
        sendProblem(
          res,
          404,
          'logical-table-not-found',
          `Logical table not found: ${logicalTableId}`,
        );
        return;
      }
      sendJson(res, 200, DEFAULT_SUMMARY_DATA);
      return;
    }

    const worksheetImageMatch = path.match(/^\/v0\/workbook\/worksheets\/([^/]+)\/image$/);
    if (method === 'GET' && worksheetImageMatch) {
      const worksheetId = decodeURIComponent(worksheetImageMatch[1]);
      if (!DEFAULT_WORKSHEETS.some((worksheet) => worksheet.id === worksheetId)) {
        sendProblem(res, 404, 'sheet-not-found', `Worksheet not found: ${worksheetId}`);
        return;
      }
      sendImageExport(res, searchParams, 640, 480);
      return;
    }

    const dashboardImageMatch = path.match(/^\/v0\/workbook\/dashboards\/([^/]+)\/image$/);
    if (method === 'GET' && dashboardImageMatch) {
      const dashboardId = decodeURIComponent(dashboardImageMatch[1]);
      if (!DEFAULT_DASHBOARDS.some((dashboard) => dashboard.id === dashboardId)) {
        sendProblem(res, 404, 'sheet-not-found', `Dashboard not found: ${dashboardId}`);
        return;
      }
      sendImageExport(res, searchParams, 1280, 720);
      return;
    }

    const storyboardImageMatch = path.match(/^\/v0\/workbook\/storyboards\/([^/]+)\/image$/);
    if (method === 'GET' && storyboardImageMatch) {
      const storyboardId = decodeURIComponent(storyboardImageMatch[1]);
      if (!DEFAULT_STORYBOARDS.some((storyboard) => storyboard.id === storyboardId)) {
        sendProblem(res, 404, 'sheet-not-found', `Storyboard not found: ${storyboardId}`);
        return;
      }
      sendImageExport(res, searchParams, 1600, 900);
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

    if (
      method === 'POST' &&
      (path === EXTERNAL_API_ROUTES.workbookUndo || path === EXTERNAL_API_ROUTES.workbookRedo)
    ) {
      const command = path === EXTERNAL_API_ROUTES.workbookUndo ? 'undo' : 'redo';
      sendJson(res, 200, {
        id: `op-${command}-1`,
        kind: `tabdoc:${command}`,
        state: 'succeeded',
        createdAt: '2026-07-07T10:00:00Z',
        completedAt: '2026-07-07T10:00:01Z',
        result: {},
      });
      return;
    }

    const sheetActionMatch = path.match(
      /^\/v0\/workbook\/(worksheets|dashboards|storyboards)\/([^/]+):(rename|delete)$/,
    );
    if (method === 'POST' && sheetActionMatch) {
      const kindSegment = sheetActionMatch[1];
      const sheetId = decodeURIComponent(sheetActionMatch[2]);
      const action = sheetActionMatch[3];
      if (!sheetIdKnown(kindSegment, sheetId)) {
        sendProblem(res, 404, 'sheet-not-found', `Sheet not found: ${sheetId}`);
        return;
      }
      if (action === 'rename') {
        let parsed: { name?: unknown };
        try {
          parsed = JSON.parse(body);
        } catch {
          sendProblem(res, 400, 'invalid-request-body', 'Body was not valid JSON.');
          return;
        }
        if (typeof parsed.name !== 'string' || parsed.name.length === 0) {
          sendProblem(res, 400, 'invalid-request-body', 'rename requires a string `name`.');
          return;
        }
      }
      sendOperation(res, `${action}-sheet`);
      return;
    }

    const sortMatch = path.match(/^\/v0\/workbook\/worksheets\/([^/]+):sort$/);
    if (method === 'POST' && sortMatch) {
      const worksheetId = decodeURIComponent(sortMatch[1]);
      if (!DEFAULT_WORKSHEETS.some((worksheet) => worksheet.id === worksheetId)) {
        sendProblem(res, 404, 'sheet-not-found', `Worksheet not found: ${worksheetId}`);
        return;
      }
      let parsed: { fieldName?: unknown };
      try {
        parsed = JSON.parse(body);
      } catch {
        sendProblem(res, 400, 'invalid-request-body', 'Body was not valid JSON.');
        return;
      }
      if (typeof parsed.fieldName !== 'string' || parsed.fieldName.length === 0) {
        sendProblem(res, 400, 'invalid-request-body', 'sort requires a string `fieldName`.');
        return;
      }
      sendOperation(res, 'sort-worksheet');
      return;
    }

    if (method === 'POST' && path === EXTERNAL_API_ROUTES.workbookGoToSheet) {
      let parsed: { id?: unknown };
      try {
        parsed = JSON.parse(body);
      } catch {
        sendProblem(res, 400, 'invalid-request-body', 'Body was not valid JSON.');
        return;
      }
      if (typeof parsed.id !== 'string' || parsed.id.length === 0) {
        sendProblem(res, 400, 'invalid-request-body', 'goToSheet requires a string `id`.');
        return;
      }
      sendOperation(res, 'go-to-sheet');
      return;
    }

    // Deliberately no id guard (unlike the sibling :sort/:document routes): AutoUpdates succeeds for
    // any id, so this never 404s on an unknown sheet.
    const autoUpdatesMatch = path.match(
      /^\/v0\/workbook\/(worksheets|dashboards)\/([^/]+):(pause|resume)AutoUpdates$/,
    );
    if (method === 'POST' && autoUpdatesMatch) {
      const [, , , action] = autoUpdatesMatch;
      sendOperation(res, `${action}-auto-updates`);
      return;
    }

    const refreshNowMatch = path.match(/^\/v0\/workbook\/worksheets\/([^/]+):refreshNow$/);
    if (method === 'POST' && refreshNowMatch) {
      const worksheetId = decodeURIComponent(refreshNowMatch[1]);
      if (!DEFAULT_WORKSHEETS.some((worksheet) => worksheet.id === worksheetId)) {
        sendProblem(res, 404, 'sheet-not-found', `Worksheet not found: ${worksheetId}`);
        return;
      }
      sendOperation(res, 'refresh-worksheet-now');
      return;
    }

    if (method === 'POST' && path === EXTERNAL_API_ROUTES.appOpenFile) {
      let parsed: { filePath?: unknown };
      try {
        parsed = JSON.parse(body);
      } catch {
        sendProblem(res, 400, 'invalid-request-body', 'Body was not valid JSON.');
        return;
      }
      if (typeof parsed.filePath !== 'string' || parsed.filePath.length === 0) {
        sendProblem(res, 400, 'invalid-request-body', 'openFile requires a string `filePath`.');
        return;
      }
      sendOperation(res, 'open-workbook-file');
      return;
    }

    if (method === 'POST' && path === EXTERNAL_API_ROUTES.workbookSave) {
      let parsed: { filePath?: unknown };
      try {
        parsed = JSON.parse(body);
      } catch {
        sendProblem(res, 400, 'invalid-request-body', 'Body was not valid JSON.');
        return;
      }
      if (parsed.filePath !== undefined && typeof parsed.filePath !== 'string') {
        sendProblem(res, 400, 'invalid-request-body', 'save `filePath` must be a string.');
        return;
      }
      sendOperation(res, 'save-workbook-file');
      return;
    }

    if (method === 'POST' && path === EXTERNAL_API_ROUTES.workbookExportAs) {
      let parsed: { format?: unknown; filePath?: unknown; targetVersion?: unknown };
      try {
        parsed = JSON.parse(body);
      } catch {
        sendProblem(res, 400, 'invalid-request-body', 'Body was not valid JSON.');
        return;
      }
      const formats = ['pdf', 'powerpoint', 'packaged-workbook', 'prior-version'];
      if (typeof parsed.format !== 'string' || !formats.includes(parsed.format)) {
        sendProblem(res, 400, 'invalid-request-body', 'exportAs requires a known `format`.');
        return;
      }
      if (typeof parsed.filePath !== 'string' || parsed.filePath.length === 0) {
        sendProblem(res, 400, 'invalid-request-body', 'exportAs requires a string `filePath`.');
        return;
      }
      // Extension↔format matrix: the live host answers `unsupported-file-type` when they disagree.
      const ext = (parsed.filePath.match(/\.[^./\\]+$/)?.[0] ?? '').toLowerCase();
      const okExt =
        parsed.format === 'pdf'
          ? ext === '.pdf'
          : parsed.format === 'powerpoint'
            ? ext === '.pptx'
            : parsed.format === 'packaged-workbook'
              ? ext === '.twbx'
              : ext === '.twb' || ext === '.twbx'; // prior-version
      if (!okExt) {
        sendProblem(
          res,
          400,
          'unsupported-file-type',
          `filePath extension ${ext} does not match ${parsed.format}.`,
        );
        return;
      }
      sendOperation(res, 'export-workbook-as');
      return;
    }

    if (method === 'POST' && path === EXTERNAL_API_ROUTES.workbookPublish) {
      sendOperation(res, 'publish-workbook');
      return;
    }

    const datasourceRefreshMatch = path.match(
      /^\/v0\/datasources\/([^/]+):(refreshData|refreshExtract)$/,
    );
    if (method === 'POST' && datasourceRefreshMatch) {
      const action = datasourceRefreshMatch[2];
      if (action === 'refreshExtract') {
        let parsed: { isFullRefresh?: unknown };
        try {
          parsed = JSON.parse(body);
        } catch {
          sendProblem(res, 400, 'invalid-request-body', 'Body was not valid JSON.');
          return;
        }
        if (parsed.isFullRefresh !== undefined && typeof parsed.isFullRefresh !== 'boolean') {
          sendProblem(
            res,
            400,
            'invalid-request-body',
            'refreshExtract `isFullRefresh` must be a boolean.',
          );
          return;
        }
      }
      sendOperation(
        res,
        action === 'refreshData' ? 'refresh-datasource-data' : 'refresh-datasource-extract',
      );
      return;
    }

    if (
      method === 'POST' &&
      (path === EXTERNAL_API_ROUTES.workbookWorksheetsNew ||
        path === EXTERNAL_API_ROUTES.workbookDashboardsNew ||
        path === EXTERNAL_API_ROUTES.workbookStoryboardsNew)
    ) {
      const command =
        path === EXTERNAL_API_ROUTES.workbookWorksheetsNew
          ? 'new-worksheet'
          : path === EXTERNAL_API_ROUTES.workbookDashboardsNew
            ? 'new-dashboard'
            : 'new-storyboard';
      sendOperation(res, command);
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
    setOperation: (id: string, operation: MockOperation | undefined): void => {
      operationCursors.delete(id);
      if (operation) {
        operations.set(id, operation);
      } else {
        operations.delete(id);
      }
    },
    close: (): Promise<void> =>
      new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}
