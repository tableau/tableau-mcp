// ── Multi-task-plan focus ownership (internal seam, NOT a tool-surface field) ──
//
// A dashboard-creation plan builds N worksheets + 1 dashboard. Phase 2 tells the
// client to spawn those worksheet applies in PARALLEL (see plan-dashboard-creation),
// and every build-and-apply-worksheet apply otherwise issues its own goto-sheet
// (focusAppliedSheetBestEffort). With parallel applies the LAST completer would steal
// focus nondeterministically onto a worksheet — the live blank-"Sheet 1" symptom —
// when only the FINAL dashboard apply should own focus.
//
// The plan tool records the worksheet names it owns, keyed by session; build-and-apply-
// worksheet suppresses focus ONLY for a worksheet that belongs to such a plan. A
// standalone hand-crafted taskSpec (no plan recorded for that session/name) focuses as
// before.
//
// This is deliberately an internal module seam rather than a taskSpec schema field: the
// desktop tool surface is already near the ToolSearch auto-deferral cliff and both
// plan-dashboard-creation and build-and-apply-worksheet are grandfathered at their
// current byte sizes (see server.desktop.test.ts byte budget), so a public input field
// is not acceptable.
//
// Residual (disclosed, mirrors a2td #215): entries are process-global and session-keyed,
// and are only ever replaced by a later plan for the same session (markPlanBuildWorksheets
// overwrites) or cleared on process restart — there is no per-apply eviction. So after a
// plan, a genuinely standalone build-and-apply-worksheet that reuses a planned name in the
// SAME session stays focus-suppressed until the session re-plans (which overwrites the set)
// or the process restarts. Re-planning with a different worksheet set drops the stale names.
const PLAN_BUILD_WORKSHEETS = new Map<string, Set<string>>();

/** Record the worksheet names a multi-task dashboard plan owns for a session. */
export function markPlanBuildWorksheets(sessionId: string, worksheetNames: string[]): void {
  PLAN_BUILD_WORKSHEETS.set(sessionId, new Set(worksheetNames.map((n) => n.trim())));
}

/** True when a worksheet apply belongs to a recorded multi-task plan (→ suppress focus). */
export function isPlanBuildWorksheet(sessionId: string, worksheetName: string): boolean {
  return PLAN_BUILD_WORKSHEETS.get(sessionId)?.has(worksheetName.trim()) ?? false;
}

/** Test-only: clear all recorded plan-build focus ownership. */
export function resetPlanBuildWorksheets(): void {
  PLAN_BUILD_WORKSHEETS.clear();
}
