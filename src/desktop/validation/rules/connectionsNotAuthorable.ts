/**
 * Validation rule: connections-not-authorable
 *
 * Terminal, non-retryable preflight rejection for hand-authored (or structurally
 * modified) `<connection>` XML — the tmcp half of the Southard containment redesign
 * (~/.claude/state/w60-southard-containment-spec.md §3 layer 3, task card #2).
 *
 * WHY: Tableau Desktop only accepts the connection SHAPE it serializes itself on a
 * live readback — a modern datasource is `<connection class="federated">` wrapping
 * `<named-connections><named-connection>` around the real per-protocol
 * `<connection class="excel-direct"|"hyper"|...>`. A model that
 * hand-authors (or copies from a .tds) a bare `<connection class="excel-direct" .../>`
 * directly under `<datasource>` produces XML that LOOKS plausible but fails at
 * connect time (confirmed product behavior, see
 * ~/.claude/projects/-Users-mattfilbert--claude/memory/tableau-oracle-connection-xml.md:
 * "Adding protocol to the list of known bad protocols", connection construction fails
 * in-proc before any file I/O — the shape is invalid, not the data).
 *
 * Every other preflight rule in this framework is retryable: its `message`/`suggestion`
 * are "FIX lines" the agent is instructed (server.desktop.ts's DESKTOP_INSTRUCTIONS) to
 * patch and re-apply. THIS rule is deliberately NOT phrased that way — there is no XML
 * fix that makes a hand-authored connection accept; the only correct next step is
 * "guide the user to Desktop's Connect pane, then re-read the workbook" (do NOT retry).
 * Structural, not a true diff against a live baseline: `ValidationRule.validate(xml)` is
 * pure over one XML string (no baseline plumbing exists in this framework and none is
 * added here), so this rule detects the known-bad bare connection shape. It cannot safely
 * infer whether a federated named-connection name was minted by Desktop: current Desktop
 * builds serialize both opaque protocol-prefixed names and readable names such as
 * `Sample - Superstoreleaf`.
 */
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
