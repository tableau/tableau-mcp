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

  const submittedWorksheetNames = worksheetNames(text);
  const missingWorksheetNames = [...worksheetNames(liveDocumentXml)].filter(
    (name) => !submittedWorksheetNames.has(name),
  );
  if (missingWorksheetNames.length > 0) {
    return fail(
      'This edit would remove worksheet(s) that are present in the live workbook.',
      `the edit would DROP worksheet(s) ${missingWorksheetNames.join(', ')}, so it was refused. Retry this tool — it re-reads the live workbook on every call. Removing a sheet on purpose is a separate request; say so rather than editing it out here.`,
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
