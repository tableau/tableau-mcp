import type { CommandValidationResult } from './commandRegistry.js';

// Real Desktop documents carry comments between the prolog and the root
// (e.g. "<!-- build main.26.0715.2311 -->") — a root check that forgets them
// rejects every legitimate whole document (live false-positive, 2026-07-19).
const WORKBOOK_ROOT_RE =
  /^\s*(?:<\?xml\b[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<workbook(?:\s|>|\/)/;
// Match single- OR double-quoted worksheet names: a guard that only saw name='…'
// would go BLIND to a double-quoted live sheet and silently allow it to be dropped —
// the exact data-loss this guard exists to prevent, failing OPEN. formatLabels.ts
// extracts the same attribute with the same both-quotes pattern; keep them consistent.
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

export function validateUnderlyingMetadataLoad(
  text: string,
  liveDocumentXml: string | null,
): CommandValidationResult {
  if (!WORKBOOK_ROOT_RE.test(text)) {
    return fail(
      'tabui:load-underlying-metadata requires a whole workbook document rooted at <workbook>.',
      'Re-read the full document with tabui:save-underlying-metadata, splice your additions into that whole text, and retry.',
    );
  }

  if (!text.includes('<datasource') || !text.includes('<worksheet')) {
    return fail(
      'tabui:load-underlying-metadata is whole-document or nothing: the submitted workbook must contain at least one <datasource and at least one <worksheet.',
      'Re-read with tabui:save-underlying-metadata, splice your additions into that whole-document text, and retry.',
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
      'tabui:load-underlying-metadata would remove worksheet(s) that are present in the live workbook.',
      `this load would DROP worksheet(s) ${missingWorksheetNames.join(', ')}. Re-read the live document with tabui:save-underlying-metadata, splice your additions into THAT text, and retry. To intentionally remove a sheet, use the delete-worksheet tool instead.`,
    );
  }

  if (text.length < 0.5 * liveDocumentXml.length) {
    return fail(
      'The submitted tabui:load-underlying-metadata document is less than half the size of the live one — likely a fragment or stale copy.',
      'Re-read the live document with tabui:save-underlying-metadata, splice your additions into THAT text, and retry.',
    );
  }

  return { ok: true };
}
