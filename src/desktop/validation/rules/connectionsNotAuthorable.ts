/** WHY: Tableau Desktop only accepts connection shapes it serialized itself. */
import { DOMParser } from '@xmldom/xmldom';
import * as xpath from 'xpath';

import type { ValidationIssue, ValidationRule } from '../types.js';

const TERMINAL_MESSAGE =
  'connections-not-authorable: Data connections cannot be created or rewritten via XML apply. ' +
  "Do not retry. Guide the user to Desktop's Connect pane, then re-read the workbook.";

const TERMINAL_SUGGESTION =
  'Do not retry with a different connection attribute shape — there is no XML fix. Tell the user ' +
  "to open Desktop's Connect pane and add/repair the connection there, then call get-workbook-xml " +
  'again once it is connected.';

function issueFor(xpathHint: string): ValidationIssue {
  return {
    ruleId: 'connections-not-authorable',
    severity: 'error',
    message: TERMINAL_MESSAGE,
    xpath: xpathHint,
    suggestion: TERMINAL_SUGGESTION,
  };
}

export const connectionsNotAuthorableRule: ValidationRule = {
  id: 'connections-not-authorable',
  description:
    'Rejects the known-bad bare hand-authored <connection> shape with a terminal, ' +
    'non-retryable error. Federated named-connection names are not classified without ' +
    'a live baseline because genuine Desktop output uses more than one naming scheme.',
  contexts: ['workbook', 'datasource'],

  validate(xml: string): ValidationIssue[] {
    let doc: Document;
    try {
      const parser = new DOMParser({ errorHandler: () => {} });
      doc = parser.parseFromString(xml.trim() || '<empty/>', 'text/xml') as unknown as Document;
    } catch {
      // Malformed XML is reported by well-formed-xml; this rule has nothing to say.
      return [];
    }

    const issues: ValidationIssue[] = [];

    // Only workbook-level datasource definitions (or a standalone datasource document)
    // are authorable connection stanzas. Worksheet <view> datasource references and
    // datasource-dependencies are usage metadata, not connection rewrites.
    //
    // 1. A bare/legacy top-level connection that is NOT the modern federated wrapper —
    // exactly the hand-authored-from-.tds shape (known-bad).
    //
    // EXCEPTION: `class='sqlproxy'` is a published-datasource proxy — the shape Desktop
    // serializes for a server/Cloud datasource. It round-trips on a live readback and the
    // federated+named-connection minting scheme doesn't apply to it, so it is exempt.
    const bareConnections = xpath.select(
      "/workbook/datasources/datasource/connection[not(@class='federated') and not(@class='sqlproxy')] | " +
        "/datasource/connection[not(@class='federated') and not(@class='sqlproxy')]",
      doc as unknown as Node,
    ) as Element[];
    for (const conn of bareConnections) {
      const cls = conn.getAttribute('class') ?? '(none)';
      issues.push(issueFor(`//datasource/connection[@class='${cls}']`));
    }

    return issues;
  },
};
