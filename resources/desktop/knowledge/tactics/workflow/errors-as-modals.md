# Errors That Arrive as Blocking Modals

Tableau Desktop can report an authoring failure in a modal dialog instead of through
the Agent API response. The modal owns Desktop's single UI thread, so later `/v0`
calls wait behind it even when the call that opened it appeared to complete.

- Tags: blocking-dialog, modal, error-code, unattended-authoring, apply-failure, prevention
- Relevant user prompts/search terms: "Tableau is stuck after apply", "blocking modal",
  "error code 47BF7751", "Qualified Name Parse Error", "filter limit greater than zero",
  "internal error after action apply"

## When to Use

Read this before unattended workbook applies, action authoring, Top-N/filter emission,
or sheet navigation. Use it again when Desktop stops answering after a write or raw
command and a human-visible error dialog may be open.

Two dedicated dialog routes remain usable while a modal blocks ordinary UI-thread
operations: `get-active-dialogs` reads `GET /v0/app/dialogs`, and `invoke-dialog-action`
calls `POST /v0/app:invokeDialogAction`. Do not send other `/v0` calls while an
actionable modal is open, and do not search for a synthetic Cancel/Escape command.

## Best Practices

1. Validate names and payload invariants before dispatch. In particular, resolve
   sheet names against a fresh worksheet/dashboard inventory, require filter limits
   of at least 1, and resolve action targets to the correct Tableau object type.
2. Prefer guarded authoring tools over raw `tabdoc:` commands. The `activate-sheet`
   tool fresh-reads the workbook and refuses an unknown target before navigation.
3. When a modal is suspected, call `get-active-dialogs`. Choose a dialog only by
   copying its exact returned `objectName`, `title`, and `className`, and choose only
   an exact action returned for that dialog. Call `invoke-dialog-action` once only
   when the task or explicit user intent makes that action unambiguous. Never guess,
   and never assume an action such as Cancel is inherently safe.
4. Do not retry the operation that opened the dialog until its cause is understood
   and corrected. If `invoke-dialog-action` returns **action-invoked-dialog-remains**, the
   action was already invoked: do not retry it or the originating operation.
5. Ask the user to handle the dialog when either dedicated tool is missing or
   version-gated, the returned identity or intended action is ambiguous, or no
   returned action is clearly safe. Follow the escalation ladder in
   `expertise://tableau/tactics/workflow/recovery` for diagnosis and human handoff.
6. Preserve evidence that distinguishes triggers: input encoding, delimiter,
   filename, target object type, command arguments, Desktop build, and whether reads
   still worked before the apply.
7. Keep UNKNOWN triggers unknown. A shared error code does not prove that two
   operations have the same cause.

### Known blocking-dialog catalog

| Code | Verified trigger | Guard / avoidance |
| --- | --- | --- |
| `5F1F5407` | **Qualified Name Parse Error.** Apply against a datasource built from a UTF-16LE, tab-delimited CSV whose filename contains parentheses. Reads and calculation authoring work; only apply fails. Reproduced twice in two fresh instances on build `0000.26.0724.1117`. | Re-encode the file as UTF-8 comma-delimited data and use a plain filename before building/applying the datasource. That combination fixed both reproductions. |
| `AC6CC624` | **"The filter limit must be greater than zero."** A filter/Top-N payload emits a limit less than or equal to 0. | Never emit a limit below 1. Validate this invariant before dispatch. |
| `CDEAC1A9` | **Internal error.** An `<edit-parameter-action>` targets a SET instead of a parameter. | A set action must be authored as `<edit-group-action>` with a resolved, datasource-qualified `'target-group'`. Use `<edit-parameter-action>` only for a parameter target. |
| `47BF7751` | Raw `tabdoc:goto-sheet` names a worksheet/dashboard that does not exist. | Validate the exact, case-sensitive name against the live worksheet/dashboard inventory, or use `activate-sheet`, which performs that validation first. |
| `CEED3E34` | **Receipted from session evidence; not newly reproduced:** invalid calculation derivation strings during a Gantt build opened a blocking modal. | Use only canonical Tableau derivation strings and run the registered invalid-derivation-string preflight before apply. |
| `F1E7F185` | **Receipted from session evidence; not newly reproduced:** a new-worksheet name was passed as the literal value `'new-worksheet'`, opening a blocking modal. | Pass the actual requested worksheet name and reject `'new-worksheet'` when it appears literally in the value position. |
| `2F8B7E6C`, `44A7CD32`, `60283812`, `87193686` | **UNKNOWN.** Observed but not characterized by repository or supplied evidence. | **UNKNOWN.** Capture the failing operation and payload; do not infer a trigger or retry recipe. |

Automated enforcement for the below-1 limit and set-action requirements is in
flight; do not treat either as landed enforcement on this branch.

## Common Mistakes

1. **Trusting a completed API response as proof that Desktop is usable.** The UI can
   be blocked by a modal after the originating call returns.
2. **Trying an ordinary command to close or work around the modal.** Ordinary calls
   queue behind the blocked UI thread. Use only `get-active-dialogs` followed, when
   the exact choice is safe and unambiguous, by one `invoke-dialog-action` call.
3. **Retrying an apply unchanged.** A repeated trigger can open the same modal again
   after the dialog is cleared. Correct the datasource, limit, action type, or sheet
   name before retrying.
4. **Assuming Cancel is safe or retrying an action.** Action meaning depends on the
   dialog and task context. Never guess from its label or semantic kind, and never call
   `invoke-dialog-action` again after **action-invoked-dialog-remains**.
5. **Treating every Qualified Name Parse Error as the CSV case.** `5F1F5407` is
   verified for the specific encoding/delimiter/filename combination above; other
   qualified-name failures can have different causes.
6. **Using `<edit-parameter-action>` for a set.** A SET is not a parameter. Use
   `<edit-group-action>` with a datasource-qualified `'target-group'`.
7. **Inventing explanations for uncatalogued codes.** Four codes remain UNKNOWN.
   Record evidence rather than turning correlation into a guard rule.

## Implementation

The shipped command reference flags 18 commands with
`opens_blocking_dialog: true`. That count is a floor, not the true number:
`expertise://tableau/tactics/data/dialog-command-misclassification` documents 16
additional known false negatives, making the known blocking set at least 34. The
reference's command-name fields contain no Dismiss/Cancel/Escape/CloseDialog/
CloseModal operation. Dialog recovery is instead provided by the authenticated,
non-command routes behind `get-active-dialogs` and `invoke-dialog-action`; these are the
only External Client API routes intended for use while an actionable modal blocks
ordinary UI-thread operations. The command policy separately refuses raw
`tabdoc:goto-sheet` because its target cannot be validated at that boundary and
redirects callers to `activate-sheet`.

### Confirmed-working navigation pattern

After obtaining an exact live inventory name, call `activate-sheet` with that name:

```json
{
  "sheetName": "Beta"
}
```

Repository unit coverage confirms that this path fresh-reads the workbook, checks
the exact case-sensitive worksheet/dashboard name, and only then dispatches
navigation. For an absent name it returns the available sheets and dispatches
nothing.

### What does NOT work

```text
tabdoc:goto-sheet
  Sheet: "name that is not in the live inventory"
```

That raw call can produce blocking error `47BF7751`. Calling another `/v0` operation,
guessing a dialog-close command or label, or blindly retrying does not recover the
session. Use the two dedicated dialog tools under the exact-choice rules above, or
ask the user to dismiss the modal when a safe choice cannot be established.

## Related Knowledge

- `expertise://tableau/tactics/data/dialog-command-misclassification` — the 16 known false negatives omitted by the reference's blocking-dialog flag.
- `expertise://tableau/tactics/workflow/recovery` — the escalation ladder for safe
  dedicated-tool recovery, out-of-band diagnosis, and human handoff while ordinary
  `/v0` calls must stop.

## Source and Confidence

- Command-reference evidence: 18 entries are flagged
  `opens_blocking_dialog: true`; this is a floor. The misclassification catalog
  documents 16 additional known false negatives, so the known count is at least 34.
- Repository enforcement evidence: guarded sheet activation and raw
  `tabdoc:goto-sheet` refusal are covered by unit tests.
- External Client API evidence: dedicated authenticated dialog discovery and action
  routes support exact compare-and-act recovery without using the blocked command
  queue.
- Known-verified reproduction notes: `5F1F5407`, `AC6CC624`, and `CDEAC1A9` trigger
  and avoidance details.
- Receipted session evidence, not newly reproduced here: `CEED3E34` invalid
  derivation strings during a Gantt build; `F1E7F185` literal `'new-worksheet'`
  value.
- UNKNOWN: triggers and code-specific guards for `2F8B7E6C`, `44A7CD32`,
  `60283812`, and `87193686`.
- Last reviewed: 2026-09-04
