import {
  carryNamespaceDeclarations,
  findWorksheet,
  generateUUID,
  normalizeArray,
  parseXML,
  serializeXML,
} from './parser.js';
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

// Returns a standalone `<worksheet>` fragment (not a whole workbook), or null if absent.
export function extractSheetXml(workbookXml: string, sheetName: string): string | null {
  const workbook = parseXML(workbookXml);
  const worksheet = findWorksheet(workbook, sheetName);
  if (!worksheet) {
    return null;
  }
  carryNamespaceDeclarations(workbook.workbook, worksheet);
  return serializeXML({ worksheet });
}

// The External Client API per-sheet `/document` route returns a whole `<workbook>` scoped to the
// requested sheet, but callers require a single `<worksheet>` fragment. Slice it out. A document
// that is already a bare `<worksheet>` fragment is returned unchanged; null if no worksheet exists.
export function worksheetDocumentToFragment(documentXml: string, sheetName: string): string | null {
  const fragment = extractSheetXml(documentXml, sheetName);
  if (fragment !== null) {
    return fragment;
  }
  return parseXML(documentXml).worksheet ? documentXml : null;
}

// The External Client API has no per-sheet write route — applying one sheet re-POSTs the whole
// document, which Desktop treats as authoritative and replaces the open workbook with. So the doc
// must carry the ENTIRE live workbook with only this sheet swapped in; anything omitted (sibling
// sheets, dashboards) would be pruned. Upsert by name: replace the matching worksheet, or append
// it if absent (a new sheet). Windows are left intact so every sheet keeps its own.
export function upsertSheetIntoWorkbook(
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

  if (!workbook.workbook) workbook.workbook = {};
  if (!workbook.workbook.worksheets) workbook.workbook.worksheets = {};

  const worksheets = normalizeArray(workbook.workbook.worksheets.worksheet);
  const index = worksheets.findIndex((ws) => ws['@_name'] === sheetName);
  if (index === -1) {
    worksheets.push(editedWorksheet);
  } else {
    worksheets[index] = editedWorksheet;
  }
  workbook.workbook.worksheets.worksheet = worksheets.length === 1 ? worksheets[0] : worksheets;

  return serializeXML(workbook);
}
