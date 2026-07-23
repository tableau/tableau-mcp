/**
 * Validation rule: connections-not-authorable
 *
 * Terminal, non-retryable preflight rejection for hand-authored (or structurally
 * modified) `<connection>` XML — the tmcp half of the Southard containment redesign
 * (~/.claude/state/w60-southard-containment-spec.md §3 layer 3, task card #2).
 *
 * WHY: Tableau Desktop only accepts the connection SHAPE it serializes itself on a
 * live readback — a modern datasource is `<connection class="federated">` wrapping
 * `<named-connections><named-connection name="<protocol>.<Desktop-minted-id>">` around
 * the real per-protocol `<connection class="excel-direct"|"hyper"|...>`. A model that
 * hand-authors (or copies from a .tds) a bare `<connection class="excel-direct" .../>`
 * directly under `<datasource>` — or fabricates a `named-connection` name instead of
 * using Desktop's own minted id — produces XML that LOOKS plausible but fails at
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
 * added here), so this rule detects "does this look like something Desktop emits" rather
 * than "did this connection change since the last read". That is sufficient for both
 * required outcomes: an unmodified live-readback round-trip (byte-identical shape) is
 * NEVER rejected, and a hand-authored/copied-from-.tds connection (which cannot
 * reproduce Desktop's opaque id-minting scheme) IS rejected.
 */
import { DOMParser } from '@xmldom/xmldom';
import * as xpath from 'xpath';

import type { ValidationIssue, ValidationRule } from '../types.js';

/**
 * Desktop mints `named-connection` names as `<protocol>.<opaque-lowercase-id>`, e.g.
 * `excel-direct.0ozsbj20cdelf51evvdk71kugqg0` (28-char id, observed on a live readback).
 * No agent or hand-authored XML can reproduce this scheme, so a name outside it is a
 * reliable hand-authored signal — never a false positive on genuine Desktop output.
 */
const NAMED_CONNECTION_ID_RE = /^[a-z][a-z0-9_-]*\.[0-9a-z]{16,}$/;

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
    'Rejects hand-authored or structurally invalid <connection> XML with a terminal, ' +
    'non-retryable error — only the exact shape Desktop itself serializes on a live ' +
    'readback (federated + named-connection with a Desktop-minted id) ever applies.',
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
    const bareConnections = xpath.select(
      "/workbook/datasources/datasource/connection[not(@class='federated')] | " +
        "/datasource/connection[not(@class='federated')]",
      doc as unknown as Node,
    ) as Element[];
    for (const conn of bareConnections) {
      const cls = conn.getAttribute('class') ?? '(none)';
      issues.push(issueFor(`//datasource/connection[@class='${cls}']`));
    }

    // 2. A top-level federated wrapper is present, but a named-connection's `name` was
    // NOT minted by Desktop (fabricated, guessed, or otherwise hand-edited).
    const namedConnections = xpath.select(
      '/workbook/datasources/datasource/connection/named-connections/named-connection[@name] | ' +
        '/datasource/connection/named-connections/named-connection[@name]',
      doc as unknown as Node,
    ) as Element[];
    for (const nc of namedConnections) {
      const name = nc.getAttribute('name') ?? '';
      if (!NAMED_CONNECTION_ID_RE.test(name)) {
        issues.push(issueFor(`//named-connection[@name='${name}']`));
      }
    }

    return issues;
  },
};
