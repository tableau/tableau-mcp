/**
 * Shared human-in-the-loop (HITL) confirmation primitive for destructive "Apply" prompts.
 *
 * The MCP SDK exposes no runtime elicitation/sampling primitive (v1.x), and prompts are pure text
 * generators. So HITL here is a *prompt-text contract*: every Apply prompt injects the same, strongly
 * worded instruction blocks telling the model to STOP and obtain explicit human approval before any
 * destructive call, and to never fabricate a confirmation token. Centralizing the wording keeps the
 * gate identical across the Apply surface (stale-content cleanup, extract-refresh optimization,
 * license reclamation, …) and makes it the single place to harden the language over time.
 *
 * These are content-type-agnostic: callers pass the action wording and the content nouns.
 */

/**
 * Renders the mandatory HITL break: present the affected items to the user and require explicit
 * approval before proceeding. Use this AFTER a reversible preview/tag step and BEFORE any confirmed
 * destructive call.
 *
 * Action wording is split into a verb form and a gerund form so multi-word actions read cleanly in
 * both slots — e.g. verb "tag or delete" ("do NOT tag or delete anything") and gerund "tagging or
 * deletion" ("queued for tagging or deletion"). Likewise the item noun is given as explicit singular
 * and plural so callers aren't forced through an "(s)" suffix that doesn't pluralize every noun.
 */
export function renderHitlGate({
  actionVerb,
  actionGerund,
  itemNounSingular,
  itemNounPlural,
  presentColumns,
}: {
  /** Imperative verb form of the action, e.g. "delete" or "tag or delete". */
  actionVerb: string;
  /** Gerund/noun form of the action, e.g. "deletion" or "tagging or deletion". */
  actionGerund: string;
  /** Singular noun for the content, e.g. "workbook or data source". */
  itemNounSingular: string;
  /** Plural noun for the content, e.g. "workbooks or data sources". */
  itemNounPlural: string;
  /** Columns the model should show per item so the human can make an informed decision. */
  presentColumns?: ReadonlyArray<string>;
}): string {
  const columns =
    presentColumns && presentColumns.length > 0
      ? ` Show each ${itemNounSingular} with: ${presentColumns.join(', ')}.`
      : '';

  return [
    `🛑 STOP — REQUIRED HUMAN CONFIRMATION before any ${actionGerund}.`,
    `Present the ${itemNounPlural} queued for ${actionGerund} to the user and ask them to ` +
      `explicitly approve.${columns}`,
    `Do NOT ${actionVerb} anything without the user's explicit approval in this conversation. If the ` +
      `user declines, skips, or does not clearly approve an item, do NOT ${actionVerb} it.`,
  ].join('\n');
}

/**
 * Renders the instruction for the second, confirmed call against a two-phase delete tool. The tool
 * returns a per-item confirmationToken from its preview phase; the model must echo that exact value
 * and must never compute or guess it.
 *
 * `toolRef` is inserted verbatim, so callers control its formatting: pass a single backticked tool
 * name (e.g. "`delete-workbook`") for a one-tool prompt, or a phrase pointing at a routing table
 * (e.g. "the `deleteTool` the routing table maps the item's `itemType` to") to cover several delete
 * tools with a single block.
 */
export function renderConfirmInstructions({
  toolRef,
  itemNoun = 'item',
}: {
  /** Verbatim reference to the two-phase delete tool, e.g. "`delete-workbook`". */
  toolRef: string;
  itemNoun?: string;
}): string {
  return [
    `Only AFTER the user approves a given ${itemNoun}, call ${toolRef} for that ${itemNoun} ` +
      'with `confirm: true` and the exact `confirmationToken` value that tool returned for it in ' +
      'the preview step.',
    'Do NOT auto-confirm. Do NOT compute, guess, or reuse a `confirmationToken` from a different ' +
      `${itemNoun} — use only the token the preview returned for that same ${itemNoun}.`,
  ].join('\n');
}
