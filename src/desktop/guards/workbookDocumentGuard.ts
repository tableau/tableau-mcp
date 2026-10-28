import { XMLValidator } from 'fast-xml-parser';
import { Err, Ok, Result } from 'ts-results-es';

import { normalizeArray, parseXML } from '../metadata/parser.js';
import { normalizeParsedXmlName } from '../xmlElement.js';
import type { CommandValidationResult } from './commandNameRegistry.js';

// Real Desktop documents carry comments between the prolog and the root
// (e.g. "<!-- build main.26.0715.2311 -->") — a root check that forgets them
// rejects every legitimate whole document.
const WORKBOOK_ROOT_RE =
  /^\s*(?:<\?xml\b[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<workbook(?:\s|>|\/)/;
function fail(problem: string, fix: string): CommandValidationResult {
  return { ok: false, message: `${problem}\nFIX: ${fix}` };
}

type Sheet = { kind: 'worksheet' | 'dashboard' | 'story'; name: string };

export type SheetCheckError = { document: 'edited' | 'open'; cause: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sheetElements(container: unknown, tag: string): Record<string, unknown>[] {
  if (container === undefined || container === '') return [];
  if (!isRecord(container)) throw new Error(`Ambiguous ${tag} container in workbook XML`);
  return normalizeArray<unknown>(container[tag]).map((sheet) => {
    if (
      !isRecord(sheet) ||
      typeof sheet['@_name'] !== 'string' ||
      normalizeParsedXmlName(sheet['@_name']) === ''
    ) {
      throw new Error(`Missing or invalid ${tag} name in workbook XML`);
    }
    return sheet;
  });
}

function readSheets(xml: string): Sheet[] {
  const parsed = parseXML(xml);
  const validation = XMLValidator.validate(xml);
  if (validation !== true) throw new Error(`Invalid workbook XML: ${validation.err.msg}`);
  const roots = Object.keys(parsed).filter((key) => !key.startsWith('?'));
  const workbook: unknown = parsed.workbook;
  if (roots.length !== 1 || roots[0] !== 'workbook' || (workbook !== '' && !isRecord(workbook))) {
    throw new Error('Expected a single workbook root in workbook XML');
  }
  if (workbook === '') return [];
  return [
    ...sheetElements(workbook.worksheets, 'worksheet').map((sheet) => ({
      kind: 'worksheet' as const,
      name: sheet['@_name'] as string,
    })),
    // Stories are <dashboard type='storyboard'>.
    ...sheetElements(workbook.dashboards, 'dashboard').map((sheet) => ({
      kind: sheet['@_type'] === 'storyboard' ? ('story' as const) : ('dashboard' as const),
      name: sheet['@_name'] as string,
    })),
  ];
}

function sheetKey(sheet: Sheet): string {
  return `${sheet.kind}:${normalizeParsedXmlName(sheet.name)}`;
}

export function liveSheetNamesMissingFrom(
  submittedXml: string,
  liveXml: string,
): Result<string[], SheetCheckError> {
  let submittedSheets: Sheet[];
  try {
    submittedSheets = readSheets(submittedXml);
  } catch (cause) {
    return Err({ document: 'edited', cause });
  }
  let liveSheets: Sheet[];
  try {
    liveSheets = readSheets(liveXml);
  } catch (cause) {
    return Err({ document: 'open', cause });
  }
  const submitted = new Set(submittedSheets.map(sheetKey));
  const missing = new Map<string, string>();
  for (const sheet of liveSheets) {
    const key = sheetKey(sheet);
    if (!submitted.has(key) && !missing.has(key)) missing.set(key, sheet.name);
  }
  return Ok([...missing.values()]);
}

export function validateWorkbookDocumentApply(
  text: string,
  liveDocumentXml: string | null,
): CommandValidationResult {
  if (!WORKBOOK_ROOT_RE.test(text)) {
    return fail(
      'The edited workbook document is not rooted at <workbook>, so it cannot be applied.',
      'Retry this tool — it re-reads the live workbook itself on every call, so a fresh attempt starts from the current document. You do not need to supply any XML.',
    );
  }

  if (!text.includes('<datasource') || !text.includes('<worksheet')) {
    return fail(
      'The edited workbook document is incomplete: a whole workbook carries at least one <datasource and at least one <worksheet.',
      'Retry this tool — it re-reads the live workbook itself on every call. If it fails again, the edit is at fault rather than anything you sent; report that instead of retrying a third time.',
    );
  }

  if (liveDocumentXml === null) {
    return { ok: true };
  }

  const missingSheets = liveSheetNamesMissingFrom(text, liveDocumentXml);
  if (missingSheets.isErr()) {
    return fail(
      'The sheet check could not read the edited or live workbook document, so the edit was refused.',
      'Retry this tool — it re-reads the live workbook on every call. If it fails again, report that instead of retrying a third time.',
    );
  }
  const missingSheetNames = missingSheets.value;
  if (missingSheetNames.length > 0) {
    return fail(
      'This edit would remove sheet(s) that are present in the live workbook.',
      `the edit would DROP sheet(s) ${missingSheetNames.join(', ')}, so it was refused. Retry this tool — it re-reads the live workbook on every call. Removing a sheet on purpose is a separate request; say so rather than editing it out here.`,
    );
  }

  if (text.length < 0.5 * liveDocumentXml.length) {
    return fail(
      'The edited workbook document is less than half the size of the live one — likely a fragment or a stale copy.',
      'Retry this tool — it re-reads the live workbook itself on every call, so a fresh attempt starts from the current document.',
    );
  }

  return { ok: true };
}
