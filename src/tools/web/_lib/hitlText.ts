/**
 * Single-sourced tool-side human-in-the-loop (HITL) / gate wording for the mutation tools
 * (AC-4, W-23125362).
 *
 * The PROMPT surface centralizes its HITL text in src/prompts/_lib/confirm.ts. The TOOL surface — the
 * preview "NEXT STEP" instructions, the flag-ON "confirm is closed" block, and the guard's
 * PreviewNotRunError recovery text — was previously hand-rolled at each call site and drifted. These
 * renderers collect that wording in one place so the language stays consistent and can be hardened
 * once.
 *
 * PLACEMENT: this lives under src/tools/web/_lib (not src/prompts/_lib) on purpose. The guard
 * (mutationGuard.ts) that consumes some of this text is itself under src/tools/web/_lib; importing
 * from src/prompts/_lib would introduce a tools→prompts cross-layer import that does not otherwise
 * exist in the tools tree. A tools-side module keeps the dependency direction clean.
 *
 * The strings are BEHAVIOR-PRESERVING extractions — semantically identical to the prior inline text,
 * just single-sourced.
 */

/**
 * Preview "NEXT STEP" text for a TAG-gated delete (workbook / datasource). The caller supplies the
 * `subject` clause (what to show the user) and the pending-deletion `tag` the confirm re-verifies.
 */
export function renderTagDeleteNextStep({
  subject,
  pendingTag,
}: {
  /** Imperative clause naming what to present, e.g. "show this workbook (name, project, owner)". */
  subject: string;
  /** The pending-deletion tag label the confirm phase verifies. */
  pendingTag: string;
}): string {
  return (
    `NEXT STEP — REQUIRED: ${subject} to the user and ask them to explicitly confirm ` +
    'deleting it. Do NOT delete without the user’s approval. ' +
    'Once approved, call again with confirm: true (the server will verify this ' +
    `'${pendingTag}' tag before deleting). `
  );
}

/**
 * Preview "NEXT STEP" text for a TOKEN-gated mutation (extract-refresh-task delete, cloud
 * extract-refresh schedule update). Parameterized because the delete and update variants differ in
 * subject, the confirm-verb clause, and the trailing gate description.
 */
export function renderTokenConfirmNextStep({
  subject,
  approvalClause,
  nonce,
  tail,
}: {
  /** Imperative clause naming what to present, e.g. "present this task" / "present this change". */
  subject: string;
  /** The confirm-verb clause, e.g. "confirm deleting it. Do NOT delete" / "confirm it. Do NOT apply". */
  approvalClause: string;
  /** The single-use confirmation token to echo into the instruction. */
  nonce: string | undefined;
  /** Trailing gate clause, starting right after "single-use token", e.g. " before deleting)." */
  tail: string;
}): string {
  return (
    `NEXT STEP — REQUIRED: ${subject} to the user and ask them to explicitly ` +
    `${approvalClause} without the user’s approval. ` +
    `Once approved, call again with confirm: true and confirmationToken: "${nonce}" ` +
    `(the server will verify and consume this single-use token${tail}`
  );
}

/**
 * The flag-ON "model-driven confirm is CLOSED" message returned as a PreviewNotRunError body when the
 * `mcp-apps` feature is enabled and an agent tries to self-confirm. Parameterized for the delete vs
 * update surfaces.
 */
export function renderConfirmClosedMessage({
  actionPhrase,
  panelName,
  previewTool,
  appliedClause,
}: {
  /** What is being gated, e.g. "deleting a workbook" / "changing an extract refresh schedule". */
  actionPhrase: string;
  /** The panel to open, e.g. "the approval panel" / "the update-... approval panel". */
  panelName: string;
  /** The model-visible preview tool the user re-runs to open the panel. */
  previewTool: string;
  /** How/when the mutation is actually applied, e.g. "the deletion is performed only when a person clicks Delete". */
  appliedClause: string;
}): string {
  return (
    `Mutation blocked: ${actionPhrase} requires a human confirmation in ${panelName}. ` +
    `Run ${previewTool} in preview (omit confirm) to open the panel; ${appliedClause}. ` +
    "The assistant cannot confirm on the user's behalf."
  );
}

/**
 * The guard's PreviewNotRunError body when a confirm cannot verify that a preview ran. When
 * `previewTool` is set (an app-only confirm tool) the recovery points at re-previewing and approving
 * in the panel; otherwise (a model-visible preview-confirm tool) it points at re-running with confirm
 * omitted.
 */
export function renderPreviewNotRunMessage({
  tool,
  previewTool,
  targetKind,
  targetId,
}: {
  tool: string;
  previewTool?: string;
  targetKind: string;
  targetId: string;
}): string {
  const recovery = previewTool
    ? `Re-run ${previewTool} to preview again, then approve in the confirmation panel.`
    : `Run ${tool} with confirm omitted (or false) first to preview, then call again with ` +
      'confirm: true.';
  return (
    `Mutation blocked: ${tool} could not verify that a preview ran for ${targetKind} ` +
    `${targetId}. ${recovery} This gate verifies server-side state and cannot be bypassed by ` +
    'computing a token.'
  );
}
