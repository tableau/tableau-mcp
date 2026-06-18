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
 * These are content-type-agnostic: callers pass the action verb and the content noun.
 */

/**
 * Renders the mandatory HITL break: present the affected items to the user and require explicit
 * approval before proceeding. Use this AFTER a reversible preview/tag step and BEFORE any confirmed
 * destructive call.
 */
export function renderHitlGate({
  action,
  itemNoun,
  itemCount,
  presentColumns,
}: {
  /** Imperative description of the destructive action, e.g. "delete". */
  action: string;
  /** Singular noun for the content, e.g. "workbook or data source". */
  itemNoun: string;
  /** Number of items queued for the action, if known. */
  itemCount?: number;
  /** Columns the model should show per item so the human can make an informed decision. */
  presentColumns?: ReadonlyArray<string>;
}): string {
  const countText = itemCount === undefined ? 'the' : `the ${itemCount}`;
  const columns =
    presentColumns && presentColumns.length > 0
      ? ` Show each ${itemNoun} with: ${presentColumns.join(', ')}.`
      : '';

  return [
    `🛑 STOP — REQUIRED HUMAN CONFIRMATION before any ${action}.`,
    `Present ${countText} ${itemNoun}(s) queued for ${action} to the user and ask them to explicitly ` +
      `approve.${columns}`,
    `Do NOT ${action} anything without the user's explicit approval in this conversation. If the user ` +
      `declines, skips, or does not clearly approve an item, do NOT ${action} it.`,
  ].join('\n');
}

/**
 * Renders the instruction for the second, confirmed call against a two-phase delete tool. The tool
 * returns a per-item confirmationToken from its preview phase; the model must echo that exact value
 * and must never compute or guess it.
 */
export function renderConfirmInstructions({
  toolName,
  itemNoun = 'item',
}: {
  /** The two-phase delete tool to call, e.g. "delete-workbook". */
  toolName: string;
  itemNoun?: string;
}): string {
  return [
    `Only AFTER the user approves a given ${itemNoun}, call \`${toolName}\` again for that ${itemNoun} ` +
      `with \`confirm: true\` and the exact \`confirmationToken\` value that \`${toolName}\` returned ` +
      'for it in the preview step.',
    'Do NOT auto-confirm. Do NOT compute, guess, or reuse a `confirmationToken` from a different ' +
      `${itemNoun} — use only the token the preview returned for that same ${itemNoun}.`,
  ].join('\n');
}
