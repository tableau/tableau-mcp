import type { WorkbookInventory } from '../externalApi/types.js';

export type ExpectedWorkspaceIdentity = {
  workbookTitle: string;
  sheetId: string;
  sheetName: string;
};

export function parseExpectedWorkspaceIdentity(raw: string): ExpectedWorkspaceIdentity {
  const invalid = (): never => {
    throw new Error('TABLEAU_DESKTOP_EXPECTED_WORKSPACE must be exact bounded workspace JSON.');
  };
  if (Buffer.byteLength(raw, 'utf8') > 8192) invalid();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    invalid();
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) invalid();
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.join(',') !== 'sheetId,sheetName,workbookTitle') invalid();
  for (const key of keys) {
    const value = record[key];
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > 2048) invalid();
    for (const char of value as string) {
      const codePoint = char.codePointAt(0)!;
      if (codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f)) invalid();
    }
  }
  return record as ExpectedWorkspaceIdentity;
}

export function matchesExpectedWorkspaceIdentity(
  workbook: WorkbookInventory,
  expected: ExpectedWorkspaceIdentity,
): boolean {
  if (workbook.title !== expected.workbookTitle) return false;
  const collections = [workbook.worksheets, workbook.dashboards, workbook.storyboards];
  if (collections.some((items) => items === undefined)) return false;
  const allSheets = collections.flatMap((items) => items ?? []);
  if (allSheets.some((sheet) => typeof sheet.isActiveSheet !== 'boolean')) return false;
  const activeSheets = allSheets.filter((sheet) => sheet.isActiveSheet);
  const activeWorksheet = workbook.worksheets?.find((sheet) => sheet.isActiveSheet);
  return (
    activeSheets.length === 1 &&
    activeWorksheet !== undefined &&
    activeWorksheet.id === expected.sheetId &&
    activeWorksheet.name === expected.sheetName
  );
}
