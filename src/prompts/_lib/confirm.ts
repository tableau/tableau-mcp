/**
 * Shared human-in-the-loop (HITL) confirmation primitive for destructive "Apply" prompts.
 *
 * Prompts are pure text generators, so HITL here is a *prompt-text contract*: every Apply prompt
 * injects the same, strongly worded instruction blocks telling the model to STOP and obtain explicit
 * human approval before any destructive call. The mutation tools additionally enforce the gate
 * server-side via the shared mutation guard (src/tools/web/_lib/mutationGuard.ts) and its pluggable
 * EvidenceStrategy: a confirmed mutation is rejected unless a preview genuinely ran, proven by one of
 * two evidence kinds — a `tag` (the reversible pending-deletion tag re-verified on live content;
 * datasource/workbook) or a `registry-nonce` (a server-generated single-use confirmation token;
 * extract refresh tasks). Every attempt (allowed and denied) also emits an authoritative audit record.
 * This closes the prior caller-computable-token bypass (W-23093455).
 *
 * RESIDUAL GAP: the gate proves a preview *ran*, NOT that a human *approved* — an agent that runs both
 * phases itself satisfies it, so human approval remains advisory. Closing it needs an out-of-band
 * approval signal the agent cannot forge. The adoption path (tracked under W-23125362) is an app-only
 * confirmation tool delivered via MCP Apps: an `visibility:['app']` tool the LLM cannot see or call,
 * invoked by a human gesture in the app surface and routed through the same guard — so the
 * confirmation nonce never enters LLM context. It layers a trustworthy gesture on app-capable clients
 * ON TOP of (not replacing) the server-authoritative gate, which stays the backstop for all clients.
 *
 * Centralizing the wording keeps the gate identical across the Apply surface (stale-content cleanup,
 * extract-refresh optimization, license reclamation, …) and makes it the single place to harden the
 * language over time.
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
 * Renders the instruction for the second, confirmed call against a two-phase apply tool. Two
 * server-authoritative gate contracts are supported via `gateKind`:
 *
 * - `'tag'` (default): the tool re-fetches the item and verifies it carries the pending-deletion
 *   tag applied in the preview phase. Used by the delete-workbook / delete-datasource path. A
 *   caller cannot bypass by fabricating a value — the only way to satisfy the gate is to have run
 *   the preview (tag) step.
 * - `'token'`: the tool returns a per-item `confirmationToken` from the preview call, derived
 *   server-side from caller-known inputs (e.g. site + task id). The confirm call must echo the
 *   same token. Used by update-cloud-extract-refresh-task / delete-extract-refresh-task where
 *   there is no Tableau REST API affordance for tagging the underlying object.
 *
 * `toolRef` is inserted verbatim, so callers control its formatting: pass a single backticked tool
 * name (e.g. "`delete-workbook`") for a one-tool prompt, or a phrase pointing at a routing table
 * (e.g. "the `deleteTool` the routing table maps the item's `itemType` to") to cover several
 * tools with a single block.
 */
export function renderConfirmInstructions({
  toolRef,
  itemNoun = 'item',
  gateKind = 'tag',
}: {
  /** Verbatim reference to the two-phase apply tool, e.g. "`delete-workbook`". */
  toolRef: string;
  itemNoun?: string;
  /**
   * Server-authoritative gate contract the tool implements. Defaults to `'tag'` (pending-deletion
   * tag verified server-side). Use `'token'` for tools that return a per-item `confirmationToken`
   * from the preview and verify it on confirm.
   */
  gateKind?: 'tag' | 'token';
}): string {
  if (gateKind === 'token') {
    return [
      `Only AFTER the user approves a given ${itemNoun}, call ${toolRef} for that ${itemNoun} ` +
        `with \`confirm: true\` and \`confirmationToken: <the token the preview step returned for this ${itemNoun}>\`. ` +
        'The tool re-derives the token from caller-known inputs and rejects mismatched or missing ' +
        'tokens before any write.',
      'Do NOT auto-confirm. Do NOT compute, guess, or reuse a `confirmationToken` — only use ' +
        `the one returned for that exact ${itemNoun} by the preview step. Confirm each ${itemNoun} individually — never batch-confirm items the user has not explicitly approved.`,
    ].join('\n');
  }

  return [
    `Only AFTER the user approves a given ${itemNoun}, call ${toolRef} for that ${itemNoun} ` +
      'with `confirm: true` (using the same `tag` value used to tag it in the preview step). The ' +
      'tool re-fetches the item and verifies the pending-deletion tag before deleting; a delete on ' +
      'an untagged item is rejected server-side.',
    `Do NOT auto-confirm. Confirm each ${itemNoun} individually — never batch-confirm items the ` +
      'user has not explicitly approved.',
  ].join('\n');
}
