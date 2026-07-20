import { xmlNamesEqual } from '../xmlElement.js';
import {
  carryNamespaceDeclarations,
  generateUUID,
  normalizeArray,
  parseXML,
  serializeXML,
} from './parser.js';
import type { ParsedDashboard, ParsedWindow, ParsedWorkbook } from './types.js';

type SizingMode =
  | 'auto'
  | 'fixed'
  | 'min'
  | 'max'
  | 'range'
  | 'fit-width'
  | 'fit-height'
  | 'vscroll';

function createValidSize(
  sizingMode: SizingMode,
  width?: number,
  height?: number,
): Record<string, string> {
  const w = width || 1000;
  const h = height || 800;
  const sizeObj: Record<string, string> = { '@_sizing-mode': sizingMode };

  switch (sizingMode) {
    case 'fixed':
      sizeObj['@_minwidth'] = String(w);
      sizeObj['@_minheight'] = String(h);
      sizeObj['@_maxwidth'] = String(w);
      sizeObj['@_maxheight'] = String(h);
      break;
    case 'min':
      sizeObj['@_minwidth'] = String(w);
      sizeObj['@_minheight'] = String(h);
      break;
    case 'max':
      sizeObj['@_maxwidth'] = String(w);
      sizeObj['@_maxheight'] = String(h);
      break;
    case 'range':
      sizeObj['@_minwidth'] = String(Math.floor(w * 0.7));
      sizeObj['@_minheight'] = String(Math.floor(h * 0.7));
      sizeObj['@_maxwidth'] = String(w);
      sizeObj['@_maxheight'] = String(h);
      break;
    case 'fit-width':
      sizeObj['@_minheight'] = String(h);
      sizeObj['@_maxheight'] = String(h);
      sizeObj['@_minwidth'] = String(Math.floor(w * 0.7));
      sizeObj['@_maxwidth'] = String(w);
      break;
    case 'fit-height':
      sizeObj['@_minwidth'] = String(w);
      sizeObj['@_maxwidth'] = String(w);
      sizeObj['@_minheight'] = String(Math.floor(h * 0.7));
      sizeObj['@_maxheight'] = String(h);
      break;
    case 'vscroll':
      sizeObj['@_minheight'] = String(h);
      sizeObj['@_maxheight'] = String(h);
      break;
  }
  return sizeObj;
}

function findDashboard(workbook: ParsedWorkbook, dashboardName: string): ParsedDashboard | null {
  const dashboards = normalizeArray(workbook.workbook?.dashboards?.dashboard);
  return (
    dashboards.find((db) => db['@_name'] && xmlNamesEqual(db['@_name'], dashboardName)) || null
  );
}

export function addDashboard(workbookXml: string, dashboardName: string): string {
  const workbook = parseXML(workbookXml);

  if (findDashboard(workbook, dashboardName)) {
    throw new Error(`Dashboard "${dashboardName}" already exists`);
  }

  if (!workbook.workbook) workbook.workbook = {};
  if (!workbook.workbook.dashboards) workbook.workbook.dashboards = {};

  const dashboards = normalizeArray(workbook.workbook.dashboards.dashboard);

  const newDashboard: ParsedDashboard = {
    '@_enable-sort-zone-taborder': 'true',
    '@_name': dashboardName,
    style: {},
    size: createValidSize('fixed', 1000, 800),
    zones: {
      zone: {
        '@_h': '100000',
        '@_id': '2',
        '@_type-v2': 'layout-basic',
        '@_w': '100000',
        '@_x': '0',
        '@_y': '0',
      },
    },
    'simple-id': { '@_uuid': generateUUID() },
  };

  dashboards.push(newDashboard);
  workbook.workbook.dashboards.dashboard = dashboards.length === 1 ? dashboards[0] : dashboards;

  if (!workbook.workbook.windows) workbook.workbook.windows = {};

  const windows = normalizeArray(workbook.workbook.windows.window);
  const newWindow: ParsedWindow = {
    '@_class': 'dashboard',
    '@_name': dashboardName,
    viewpoints: {},
    active: { '@_id': '-1' },
    'simple-id': { '@_uuid': generateUUID() },
  };

  windows.push(newWindow);
  workbook.workbook.windows.window = windows.length === 1 ? windows[0] : windows;

  return serializeXML(workbook);
}

export function deleteDashboard(workbookXml: string, dashboardName: string): string {
  const workbook = parseXML(workbookXml);

  if (!findDashboard(workbook, dashboardName)) {
    throw new Error(`Dashboard "${dashboardName}" does not exist`);
  }

  if (workbook.workbook?.dashboards) {
    const dashboards = normalizeArray(workbook.workbook.dashboards.dashboard);
    const filtered = dashboards.filter((db) => db['@_name'] !== dashboardName);
    if (filtered.length === 0) {
      delete workbook.workbook.dashboards.dashboard;
    } else if (filtered.length === 1) {
      workbook.workbook.dashboards.dashboard = filtered[0];
    } else {
      workbook.workbook.dashboards.dashboard = filtered;
    }
  }

  if (workbook.workbook?.windows) {
    const windows = normalizeArray(workbook.workbook.windows.window);
    const filtered = windows.filter(
      (win) => !(win['@_name'] === dashboardName && win['@_class'] === 'dashboard'),
    );
    if (filtered.length === 0) {
      delete workbook.workbook.windows.window;
    } else if (filtered.length === 1) {
      workbook.workbook.windows.window = filtered[0];
    } else {
      workbook.workbook.windows.window = filtered;
    }
  }

  return serializeXML(workbook);
}

export function listWorkbookDashboards(workbookXml: string): string[] {
  const workbook = parseXML(workbookXml);
  const dashboards = normalizeArray(workbook.workbook?.dashboards?.dashboard);
  return dashboards.map((db) => db['@_name']).filter((name): name is string => !!name);
}

// Returns a standalone `<dashboard>` fragment (not a whole workbook), or null if absent.
export function extractDashboardXml(workbookXml: string, dashboardName: string): string | null {
  const workbook = parseXML(workbookXml);
  const dashboard = findDashboard(workbook, dashboardName);
  if (!dashboard) {
    return null;
  }
  carryNamespaceDeclarations(workbook.workbook, dashboard);
  return serializeXML({ dashboard });
}

// Builds a whole-workbook document carrying only the one edited dashboard (and its window).
// The workbook POST upserts by name: it overwrites the colliding live dashboard and leaves the
// rest of the live workbook untouched. Worksheets are stripped from the doc — they stay live and
// the dashboard's zones still reference them by name — so the POST does not touch them at all.
export function buildMinimalDashboardDoc(
  workbookXml: string,
  dashboardName: string,
  editedDashboardXml: string,
): string {
  const workbook = parseXML(workbookXml);
  const editedParsed = parseXML(editedDashboardXml);
  const editedDashboard = normalizeArray(editedParsed.dashboard as ParsedDashboard | undefined)[0];
  if (!editedDashboard || editedDashboard['@_name'] !== dashboardName) {
    throw new Error(`Edited XML does not contain a <dashboard name="${dashboardName}">`);
  }

  if (workbook.workbook?.dashboards) {
    workbook.workbook.dashboards.dashboard = editedDashboard;
  }

  if (workbook.workbook?.windows) {
    const windows = normalizeArray(workbook.workbook.windows.window);
    const targetWindow = windows.find(
      (win) => win['@_class'] === 'dashboard' && win['@_name'] === dashboardName,
    );
    if (targetWindow) {
      workbook.workbook.windows.window = targetWindow;
    } else {
      delete workbook.workbook.windows.window;
    }
  }

  delete workbook.workbook?.worksheets;

  return serializeXML(workbook);
}
