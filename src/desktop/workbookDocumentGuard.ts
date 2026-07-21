import type { CommandValidationResult } from './commandRegistry.js';

// Real Desktop documents carry comments between the prolog and the root
// (e.g. "<!-- build main.26.0715.2311 -->") — a root check that forgets them
// rejects every legitimate whole document.
const WORKBOOK_ROOT_RE =
  /^\s*(?:<\?xml\b[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<workbook(?:\s|>|\/)/;
// Match single- OR double-quoted worksheet names so a dropped worksheet cannot
// slip through when Desktop serializes names with either quote style.
const WORKSHEET_NAME_RE = /<worksheet\b[^>]*\bname=(['"])(.*?)\1/g;

function fail(problem: string, fix: string): CommandValidationResult {
  return { ok: false, message: `${problem}\nFIX: ${fix}` };
}

function worksheetNames(xml: string): Set<string> {
  const names = new Set<string>();
  for (const match of xml.matchAll(WORKSHEET_NAME_RE)) {
    names.add(match[2]);
  }
  return names;
}

export function validateWorkbookDocumentApply(
  text: string,
  liveDocumentXml: string | null,
): CommandValidationResult {
  if (!WORKBOOK_ROOT_RE.test(text)) {
    return fail(
      'apply-workbook requires a whole workbook document rooted at <workbook>.',
      'Re-read the full document with get-workbook-xml, splice your additions into that whole text, and retry apply-workbook.',
    );
  }

  if (!text.includes('<datasource') || !text.includes('<worksheet')) {
    return fail(
      'apply-workbook is whole-document or nothing: the submitted workbook must contain at least one <datasource and at least one <worksheet.',
      'Re-read with get-workbook-xml, splice your additions into that whole-document text, and retry apply-workbook.',
    );
  }

  if (liveDocumentXml === null) {
    return { ok: true };
  }

  const submittedWorksheetNames = worksheetNames(text);
  const missingWorksheetNames = [...worksheetNames(liveDocumentXml)].filter(
    (name) => !submittedWorksheetNames.has(name),
  );
  if (missingWorksheetNames.length > 0) {
    return fail(
      'apply-workbook would remove worksheet(s) that are present in the live workbook.',
      `this apply would DROP worksheet(s) ${missingWorksheetNames.join(', ')}. Re-read the live document with get-workbook-xml, splice your additions into THAT text, and retry apply-workbook. To intentionally remove a sheet, use the delete-worksheet tool instead.`,
    );
  }

  if (text.length < 0.5 * liveDocumentXml.length) {
    return fail(
      'The submitted apply-workbook document is less than half the size of the live one — likely a fragment or stale copy.',
      'Re-read the live document with get-workbook-xml, splice your additions into THAT text, and retry apply-workbook.',
    );
  }

  return { ok: true };
}
