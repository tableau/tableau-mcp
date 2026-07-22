export type CommandParamPolicy = { allowed: Set<string>; required: Set<string> };

export type CommandPolicy = {
  action: 'refuse' | 'hint' | 'param-override';
  reason?: string;
  fix?: string;
  params?: CommandParamPolicy;
};

const CRASH_PRONE_REASON = 'crash-prone';
const LIVE_DIALOG_REASON = 'live-dialog';
const EXTERNAL_API_DIALOG_REASON = 'external-api-dialog';
const KNOWN_LIVE_FAILURE_REASON = 'known-live-failure';
const FILTER_FIX = 'express filters in the NotionalSpec (categoricalFilters/rangeFilters/...)';
const SORT_FIX =
  'tabdoc:sort drives a UI dialog and blocks the screen. Use refine-worksheet with operation sort_by_field (sort a dimension by a field/measure), or the bind-template sort proposal/document round-trip for nested sorts';
const SORT_NESTED_FIX =
  'FIX: tabdoc:sort-nested is known to fail (HTTP 500) on current Desktop builds regardless of parameters — do not retry it. Sort instead via the bind-template sort proposal (preferred for template-bound sheets) or the workbook document round-trip (get-workbook-xml → edit the computed-sort → apply-workbook).';
const SORT_NESTED_ALLOWED =
  'DimensionToSort Worksheet MeasureName ShelfType Direction ClearSort Dashboard LevelNames MemberValues KeepFieldFilters';
const SORT_NESTED_REQUIRED = 'DimensionToSort Worksheet MeasureName ShelfType';
const REVERT_FIX =
  'there is no headless revert — author forward instead (a wrong node is corrected by a follow-up author-* call or document round-trip)';
const SITE_FIX =
  'changing sites is fine, but this command opens a dialog - ask the user to switch sites in Desktop instead';
const TABLE_CALC_FIX = 'author table calculations through supported calculation tools';
const PAGE_FIX = 'use a page navigation call with exactly one of page-number or page-name';
const GOTO_SHEET_FIX =
  'use the activate-sheet tool instead. Raw tabdoc:goto-sheet cannot pre-validate the sheet value against live workbook windows, and a bad value opens a blocking Tableau Desktop dialog (Error 47BF7751)';

function refuse(reason: string, fix?: string): CommandPolicy {
  return { action: 'refuse', reason, fix };
}

const keySet = (keys: string): Set<string> => new Set(keys.split(' '));
const liveDialog = (fix: string): CommandPolicy => refuse(LIVE_DIALOG_REASON, fix);
const externalDialog = (fix: string): CommandPolicy => refuse(EXTERNAL_API_DIALOG_REASON, fix);
const hintWithParams = (fix: string, allowed: string, required: string): CommandPolicy => ({
  action: 'hint',
  reason: KNOWN_LIVE_FAILURE_REASON,
  fix,
  params: { allowed: keySet(allowed), required: keySet(required) },
});

export const COMMAND_POLICIES: Map<string, CommandPolicy> = new Map([
  ['tabdoc:show-parameter-controls', refuse(CRASH_PRONE_REASON)], // commandRegistry crash guard: crash-prone headlessly.
  ['tabdoc:show-parameter-controls-range', refuse(CRASH_PRONE_REASON)], // commandRegistry crash guard: crash-prone headlessly.
  ['tabdoc:goto-sheet', liveDialog(GOTO_SHEET_FIX)], // 2026-07-22 live receipt: bad Sheet value opens modal 47BF7751; activate-sheet validates first.
  [
    'tabdoc:sort-nested',
    hintWithParams(SORT_NESTED_FIX, SORT_NESTED_ALLOWED, SORT_NESTED_REQUIRED),
  ], // 2026-07-19 live receipts: contract is validation-only; execution still 500s.
  ['tabdoc:launch-map-service-edit-dialog', liveDialog('no headless alternative')], // 2026-07-19 dialog sweep: map service edit dialog.
  ['tabdoc:show-goto-sheet-dialog', liveDialog('use the activate-sheet tool')], // 2026-07-19 dialog sweep: goto-sheet dialog.
  ['tabui:show-feature-flag-dialog', liveDialog('no headless alternative')], // 2026-07-19 dialog sweep: feature flag dialog.
  ['tabdoc:edit-filter-dialog', liveDialog(FILTER_FIX)], // 2026-07-19 dialog sweep: filter edit dialog.
  ['tabdoc:launch-shared-filter-dialog', liveDialog('express filters in the NotionalSpec')], // 2026-07-19 dialog sweep: shared filter dialog.
  ['tabdoc:launch-map-services-dialog', liveDialog('no headless alternative')], // 2026-07-19 dialog sweep: map services dialog.
  ['tabdoc:get-button-config-dialog', liveDialog('no headless alternative')], // 2026-07-19 dialog sweep: button config dialog.
  ['tabui:launch-accelerator-data-mapper-dialog', liveDialog('no headless alternative')], // 2026-07-19 dialog sweep: accelerator mapper dialog.
  ['tabdoc:launch-custom-sql-dialog', liveDialog('no headless alternative')], // 2026-07-19 dialog sweep: custom SQL dialog.
  ['tabdoc:launch-web-url-dialog', liveDialog('no headless alternative')], // 2026-07-19 dialog sweep: web URL dialog.
  ['tabdoc:show-action-list-dialog-for-dashboard', liveDialog('use author-action')], // 2026-07-19 dialog sweep: dashboard action list.
  ['tabdoc:show-action-list-dialog-for-worksheet', liveDialog('use author-action')], // 2026-07-19 dialog sweep: worksheet action list.
  ['tabdoc:show-sort-dialog', liveDialog("express sort in the NotionalSpec's sort key")], // 2026-07-19 dialog sweep: sort dialog.
  ['tabdoc:sort', liveDialog(SORT_FIX)], // 2026-07-19 live sort sweep: sort drives dialog; sort-nested now fails live.
  ['tabdoc:create-new-parameter', liveDialog('use author-parameter')], // 2026-07-19 dialog sweep: new parameter dialog.
  ['tabdoc:edit-existing-parameter', liveDialog('use author-parameter for new parameters')], // 2026-07-19 dialog sweep: edit parameter dialog.
  ['tabdoc:revert-workbook-ui', liveDialog(REVERT_FIX)], // 2026-07-19 live modal receipts: Error 47BF7751 twice.
  ['tabui:workgroup-change-site', externalDialog(SITE_FIX)], // Live External API dialog sweep: site change blocks.
  [
    'tabdoc:toggle-ind-join-semantics',
    externalDialog('no headless relationship-semantics alternative'),
  ], // Live External API dialog sweep: join semantics blocks.
  [
    'tabdoc:toggle-referential-integrity',
    externalDialog('no headless referential-integrity alternative'),
  ], // Live External API dialog sweep: referential integrity blocks.
  ['tabdoc:table-calc-add', externalDialog(TABLE_CALC_FIX)], // Live External API dialog sweep: table calc add blocks.
  ['tabdoc:table-calc-edit', externalDialog(TABLE_CALC_FIX)], // Live External API dialog sweep: table calc edit blocks.
  ['tabdoc:change-page', externalDialog(PAGE_FIX)], // Live External API dialog sweep: page change blocks.
  ['tabdoc:hide-unused-fields', externalDialog('no headless hide-unused-fields alternative')], // Live External API dialog sweep: hide unused fields blocks.
]);

export function checkCommandPolicy(command: string): CommandPolicy | undefined {
  return COMMAND_POLICIES.get(command);
}

function policyForReason(command: string, reason: string): CommandPolicy | undefined {
  const policy = checkCommandPolicy(command);
  return policy?.action === 'refuse' && policy.reason === reason ? policy : undefined;
}

export function crashPronePolicyFor(command: string): CommandPolicy | undefined {
  return policyForReason(command, CRASH_PRONE_REASON);
}

export function liveDialogPolicyFor(command: string): CommandPolicy | undefined {
  return policyForReason(command, LIVE_DIALOG_REASON);
}

export function externalApiDialogPolicyFor(command: string): CommandPolicy | undefined {
  return policyForReason(command, EXTERNAL_API_DIALOG_REASON);
}

export function knownLiveFailureFixFor(command: string): string | undefined {
  const policy = checkCommandPolicy(command);
  return policy?.action === 'hint' && policy.reason === KNOWN_LIVE_FAILURE_REASON
    ? policy.fix
    : undefined;
}

export function liveParamOverrideFor(command: string): CommandParamPolicy | undefined {
  return checkCommandPolicy(command)?.params;
}
