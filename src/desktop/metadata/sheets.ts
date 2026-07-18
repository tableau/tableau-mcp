import { findWorksheet, generateUUID, normalizeArray, parseXML, serializeXML } from './parser.js';
import type { ParsedWindow, ParsedWorksheet } from './types.js';

export function addSheet(workbookXml: string, sheetName: string): string {
  const workbook = parseXML(workbookXml);

  if (findWorksheet(workbook, sheetName)) {
    throw new Error(`Worksheet "${sheetName}" already exists`);
  }

  if (!workbook.workbook) workbook.workbook = {};
  if (!workbook.workbook.worksheets) workbook.workbook.worksheets = {};

  const worksheets = normalizeArray(workbook.workbook.worksheets.worksheet);

  const newWorksheet: ParsedWorksheet = {
    '@_name': sheetName,
    table: {
      view: {
        datasources: {},
        aggregation: { '@_value': 'true' },
      },
      style: {},
      panes: {
        pane: {
          '@_selection-relaxation-option': 'selection-relaxation-allow',
          view: { breakdown: { '@_value': 'auto' } },
          mark: { '@_class': 'Automatic' },
        },
      },
      rows: '',
      cols: '',
    },
    'simple-id': { '@_uuid': generateUUID() },
  };

  worksheets.push(newWorksheet);
  workbook.workbook.worksheets.worksheet = worksheets.length === 1 ? worksheets[0] : worksheets;

  if (!workbook.workbook.windows) workbook.workbook.windows = {};

  const windows = normalizeArray(workbook.workbook.windows.window);
  const newWindow: ParsedWindow = {
    '@_class': 'worksheet',
    '@_name': sheetName,
    cards: {
      edge: [
        {
          '@_name': 'left',
          strip: {
            '@_size': '160',
            card: [{ '@_type': 'pages' }, { '@_type': 'filters' }, { '@_type': 'marks' }],
          },
        },
        {
          '@_name': 'top',
          strip: [
            { '@_size': '31', card: { '@_type': 'columns' } },
            { '@_size': '31', card: { '@_type': 'rows' } },
            { '@_size': '31', card: { '@_type': 'title' } },
          ],
        },
      ],
    },
    'simple-id': { '@_uuid': generateUUID() },
  };

  windows.push(newWindow);
  workbook.workbook.windows.window = windows.length === 1 ? windows[0] : windows;

  return serializeXML(workbook);
}

export function deleteSheet(workbookXml: string, sheetName: string): string {
  const workbook = parseXML(workbookXml);

  if (!findWorksheet(workbook, sheetName)) {
    throw new Error(`Worksheet "${sheetName}" does not exist`);
  }

  if (workbook.workbook?.worksheets) {
    const worksheets = normalizeArray(workbook.workbook.worksheets.worksheet);
    const filtered = worksheets.filter((ws) => ws['@_name'] !== sheetName);
    if (filtered.length === 0) {
      delete workbook.workbook.worksheets.worksheet;
    } else if (filtered.length === 1) {
      workbook.workbook.worksheets.worksheet = filtered[0];
    } else {
      workbook.workbook.worksheets.worksheet = filtered;
    }
  }

  if (workbook.workbook?.windows) {
    const windows = normalizeArray(workbook.workbook.windows.window);
    const filtered = windows.filter(
      (win) => !(win['@_name'] === sheetName && win['@_class'] === 'worksheet'),
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

export function listSheets(workbookXml: string): string[] {
  const workbook = parseXML(workbookXml);
  const worksheets = normalizeArray(workbook.workbook?.worksheets?.worksheet);
  return worksheets.map((ws) => ws['@_name']).filter((name): name is string => !!name);
}

// Builds a whole-workbook document carrying only the one edited worksheet (and its window).
// The workbook POST upserts by name: it overwrites the colliding live sheet and, because the
// doc carries no other sheets, leaves the rest of the live workbook untouched.
export function buildMinimalSheetDoc(
  workbookXml: string,
  sheetName: string,
  editedWorksheetXml: string,
): string {
  const workbook = parseXML(workbookXml);
  const editedParsed = parseXML(editedWorksheetXml);
  const editedWorksheet = normalizeArray(editedParsed.worksheet as ParsedWorksheet | undefined)[0];
  if (!editedWorksheet || editedWorksheet['@_name'] !== sheetName) {
    throw new Error(`Edited XML does not contain a <worksheet name="${sheetName}">`);
  }

  if (workbook.workbook?.worksheets) {
    workbook.workbook.worksheets.worksheet = editedWorksheet;
  }

  if (workbook.workbook?.windows) {
    const windows = normalizeArray(workbook.workbook.windows.window);
    const targetWindow = windows.find(
      (win) => win['@_class'] === 'worksheet' && win['@_name'] === sheetName,
    );
    if (targetWindow) {
      workbook.workbook.windows.window = targetWindow;
    } else {
      delete workbook.workbook.windows.window;
    }
  }

  delete workbook.workbook?.dashboards;

  return serializeXML(workbook);
}
