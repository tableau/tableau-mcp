import { normalizeArray, parseXML } from '../metadata/parser.js';
import type { CommandValidationResult } from './commandNameRegistry.js';

// Real Desktop documents carry comments between the prolog and the root
// (e.g. "<!-- build main.26.0715.2311 -->") — a root check that forgets them
// rejects every legitimate whole document.
const WORKBOOK_ROOT_RE =
  /^\s*(?:<\?xml\b[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<workbook(?:\s|>|\/)/;
function fail(problem: string, fix: string): CommandValidationResult {
  return { ok: false, message: `${problem}\nFIX: ${fix}` };
}

export function readSheetNames(xml: string): string[] {
  const { workbook } = parseXML(xml);
  const names = [
    ...normalizeArray<{ '@_name'?: string }>(workbook?.worksheets?.worksheet),
    // Stories are <dashboard type='storyboard'>.
    ...normalizeArray<{ '@_name'?: string }>(workbook?.dashboards?.dashboard),
  ].map((sheet) => sheet['@_name']);
  return names.filter((name): name is string => typeof name === 'string' && name !== '');
}

// Desktop deletes every sheet a whole-workbook POST leaves out; throws if either document won't parse.
export function liveSheetNamesMissingFrom(submittedXml: string, liveXml: string): string[] {
  const submitted = new Set(readSheetNames(submittedXml));
  return [...new Set(readSheetNames(liveXml))].filter((name) => !submitted.has(name));
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

  let missingSheetNames: string[];
  try {
    missingSheetNames = liveSheetNamesMissingFrom(text, liveDocumentXml);
  } catch {
    return fail(
      'The sheet check could not read the edited or live workbook document, so the edit was refused.',
      'Retry this tool — it re-reads the live workbook on every call. If it fails again, report that instead of retrying a third time.',
    );
  }
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
