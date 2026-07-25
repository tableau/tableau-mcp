import { DOMParser } from '@xmldom/xmldom';

import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import type { ValidationIssue } from '../types.js';

export type XmlParseResult = { ok: true; doc: Document } | { ok: false; message: string };

/**
 * Parse a document for a validation rule, failing CLOSED. A rule that cannot parse its
 * input cannot judge it, so the result is a discriminated union rather than a nullable
 * Document: `undefined` was indistinguishable from "parsed fine, found nothing", and every
 * consumer turned a parse failure into an empty issue list. One unclosed tag then silenced
 * the whole rule set and the document came back valid.
 */
export function parseXmlResult(xml: string): XmlParseResult {
  const errors: string[] = [];
  const parser = new DOMParser({
    errorHandler: (level, msg) => {
      if (level === 'error' || level === 'fatalError') errors.push(String(msg));
    },
  });

  let doc: Document;
  try {
    doc = parser.parseFromString(
      String(xml ?? '').trim() || '<empty/>',
      'text/xml',
    ) as unknown as Document;
  } catch (err) {
    return { ok: false, message: getExceptionMessage(err) };
  }

  if (errors.length > 0) return { ok: false, message: errors[0] };
  if (!doc?.documentElement) return { ok: false, message: 'the document has no root element' };
  return { ok: true, doc };
}

/** The issue a rule emits when the document will not parse, so the rule could not judge it. */
export function unparseableXmlIssue(ruleId: string, message: string): ValidationIssue {
  return {
    ruleId,
    severity: 'error',
    message:
      `Rule '${ruleId}' could not check this document because the XML is not well-formed: ${message}. ` +
      'The document is rejected rather than passed, because an unparseable document hides every ' +
      'defect the parse-based rules exist to catch.',
    suggestion: 'Fix the XML syntax error, then re-run validation.',
  };
}
