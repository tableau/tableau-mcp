import { generateUUID, normalizeArray, parseXML, serializeXML } from '../metadata/parser.js';

export type SheetType = 'worksheet' | 'dashboard' | 'story';
export type InsertPosition = 'end' | 'before_sheet' | 'after_sheet';

const SHEET_CONFIG: Record<SheetType, { container: string; element: string; windowClass: string }> =
  {
    worksheet: { container: 'worksheets', element: 'worksheet', windowClass: 'worksheet' },
    dashboard: { container: 'dashboards', element: 'dashboard', windowClass: 'dashboard' },
    story: { container: 'stories', element: 'story', windowClass: 'story' },
  };

function assignFreshUuids(obj: unknown): void {
  if (!obj || typeof obj !== 'object') return;
  const o = obj as Record<string, unknown>;
  if (o['simple-id'] && typeof o['simple-id'] === 'object') {
    (o['simple-id'] as Record<string, unknown>)['@_uuid'] = generateUUID();
  }
  for (const val of Object.values(o)) {
    if (Array.isArray(val)) {
      val.forEach(assignFreshUuids);
    } else if (typeof val === 'object' && val !== null) {
      assignFreshUuids(val);
    }
  }
}

export function injectTemplate(
  workbookXml: string,
  templateXml: string,
  sheetType: SheetType,
  insertPosition: InsertPosition = 'end',
  relativeSheetName?: string,
): string {
  const { container, element, windowClass } = SHEET_CONFIG[sheetType];

  const workbook = parseXML(workbookXml);
  const template = parseXML(templateXml);

  const wb = workbook.workbook;
  if (!wb) throw new Error('Workbook XML has no <workbook> root element');

  const templateContainer = (template.workbook as Record<string, unknown>)?.[container] as
    | Record<string, unknown>
    | undefined;
  if (!templateContainer) throw new Error(`Template does not contain <${container}>`);

  const templateSheets = normalizeArray<unknown>(templateContainer[element]);
  if (templateSheets.length === 0)
    throw new Error(`Template does not contain a <${element}> element`);

  const sheetToInject = templateSheets[0];

  const templateWindows = normalizeArray<Record<string, unknown>>(
    template.workbook?.windows?.window,
  );
  const windowToInject = templateWindows.find((w) => w['@_class'] === windowClass);
  if (!windowToInject)
    throw new Error(`Template does not contain a <window class="${windowClass}">`);

  assignFreshUuids(sheetToInject);
  assignFreshUuids(windowToInject);

  const wbRecord = wb as Record<string, unknown>;
  if (!wbRecord[container]) wbRecord[container] = {};
  const containerRecord = wbRecord[container] as Record<string, unknown>;
  const existingSheets = normalizeArray<unknown>(containerRecord[element]);
  existingSheets.push(sheetToInject);
  containerRecord[element] = existingSheets.length === 1 ? existingSheets[0] : existingSheets;

  if (!wb.windows) wb.windows = {};
  const existingWindows = normalizeArray<Record<string, unknown>>(wb.windows.window);

  let insertIndex: number;
  if (insertPosition === 'end' || !relativeSheetName) {
    insertIndex = existingWindows.length;
  } else {
    const refIndex = existingWindows.findIndex((w) => w['@_name'] === relativeSheetName);
    if (refIndex === -1)
      throw new Error(`Relative sheet "${relativeSheetName}" not found in windows`);
    insertIndex = insertPosition === 'before_sheet' ? refIndex : refIndex + 1;
  }

  existingWindows.splice(insertIndex, 0, windowToInject);

  wb.windows.window = (existingWindows.length === 1 ? existingWindows[0] : existingWindows) as any;

  return serializeXML(workbook);
}
