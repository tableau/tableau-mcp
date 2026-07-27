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

**There is no command that dismisses a dialog, so prevention is the only recovery.**
An agent that opens one has lost the session until a human intervenes and dismisses
the modal. Do not send more `/v0` calls or search for a synthetic Cancel/Escape
command after the dialog appears.

## Best Practices

1. Validate names and payload invariants before dispatch. In particular, resolve
   sheet names against a fresh worksheet/dashboard inventory, require filter limits
   of at least 1, and resolve action targets to the correct Tableau object type.
2. Prefer guarded authoring tools over raw `tabdoc:` commands. The `activate-sheet`
   tool fresh-reads the workbook and refuses an unknown target before navigation.
3. Treat a modal-risk failure as terminal for unattended work. Stop retries, report
   the exact error code and operation, and ask a human to dismiss the dialog.
4. Preserve evidence that distinguishes triggers: input encoding, delimiter,
   filename, target object type, command arguments, Desktop build, and whether reads
   still worked before the apply.
5. Keep UNKNOWN triggers unknown. A shared error code does not prove that two
   operations have the same cause.

### Known blocking-dialog catalog

| Code | Verified trigger | Guard / avoidance |
| --- | --- | --- |
| `5F1F5407` | **Qualified Name Parse Error.** Apply against a datasource built from a UTF-16LE, tab-delimited CSV whose filename contains parentheses. Reads and calculation authoring work; only apply fails. Reproduced twice in two fresh instances on build `0000.26.0724.1117`. | Re-encode the file as UTF-8 comma-delimited data and use a plain filename before building/applying the datasource. That combination fixed both reproductions. |
| `AC6CC624` | **"The filter limit must be greater than zero."** A filter/Top-N payload emits a limit less than or equal to 0. | Never emit a limit below 1. This invariant is enforced at every emit site and by a preflight validation rule; retain both layers. |
| `CDEAC1A9` | **Internal error.** An `<edit-parameter-action>` targets a SET instead of a parameter. | Author a set action as `<edit-group-action>` and supply a resolved, datasource-qualified `'target-group'`. Use `<edit-parameter-action>` only for a parameter target. |
| `47BF7751` | Raw `tabdoc:goto-sheet` names a worksheet/dashboard that does not exist. | Validate the exact, case-sensitive name against the live worksheet/dashboard inventory, or use `activate-sheet`, which performs that validation first. |
| `2F8B7E6C` | **UNKNOWN.** No trigger is verified in the repository or supplied evidence. | **UNKNOWN.** Do not infer a trigger or retry recipe from the code alone; capture the failing operation and payload for diagnosis. |
| `44A7CD32` | **UNKNOWN.** No trigger is verified in the repository or supplied evidence. | **UNKNOWN.** Do not infer a trigger or retry recipe from the code alone; capture the failing operation and payload for diagnosis. |
| `60283812` | **UNKNOWN.** No trigger is verified in the repository or supplied evidence. | **UNKNOWN.** Do not infer a trigger or retry recipe from the code alone; capture the failing operation and payload for diagnosis. |
| `87193686` | **UNKNOWN.** No trigger is verified in the repository or supplied evidence. | **UNKNOWN.** Do not infer a trigger or retry recipe from the code alone; capture the failing operation and payload for diagnosis. |
| `CEED3E34` | **UNKNOWN.** No trigger is verified in the repository or supplied evidence. | **UNKNOWN.** Do not infer a trigger or retry recipe from the code alone; capture the failing operation and payload for diagnosis. |
| `F1E7F185` | **UNKNOWN.** No trigger is verified in the repository or supplied evidence. | **UNKNOWN.** Do not infer a trigger or retry recipe from the code alone; capture the failing operation and payload for diagnosis. |

## Common Mistakes

1. **Trusting a completed API response as proof that Desktop is usable.** The UI can
   be blocked by a modal after the originating call returns.
2. **Trying another command to close the modal.** The shipped command reference has
   no dismiss/cancel/escape/close-dialog command. More calls queue behind the same
   blocked UI thread.
3. **Retrying an apply unchanged.** A repeated trigger can open the same modal again
   after a human clears it. Correct the datasource, limit, action type, or sheet name
   before retrying.
4. **Treating every Qualified Name Parse Error as the CSV case.** `5F1F5407` is
   verified for the specific encoding/delimiter/filename combination above; other
   qualified-name failures can have different causes.
5. **Using `<edit-parameter-action>` for a set.** A SET is not a parameter. Use
   `<edit-group-action>` with a datasource-qualified `'target-group'`.
6. **Inventing explanations for uncatalogued codes.** Six codes remain UNKNOWN.
   Record evidence rather than turning correlation into a guard rule.

## Implementation

The shipped command reference contains 18 commands marked
`opens_blocking_dialog: true`. Its command-name fields contain no
Dismiss/Cancel/Escape/CloseDialog/CloseModal operation, so none provides headless
recovery. The command policy separately refuses raw `tabdoc:goto-sheet` because its
target cannot be validated at that boundary and redirects callers to
`activate-sheet`.

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
guessing a dialog-close command, or blindly retrying does not recover the unattended
session; a human must dismiss the modal first.

## Source and Confidence

- Command-reference evidence: 18 `opens_blocking_dialog: true` entries; no
  dismiss/cancel/escape/close-dialog command name.
- Repository enforcement evidence: guarded sheet activation and raw
  `tabdoc:goto-sheet` refusal are covered by unit tests.
- Known-verified reproduction notes: `5F1F5407`, `AC6CC624`, and `CDEAC1A9` trigger
  and avoidance details.
- UNKNOWN: triggers and code-specific guards for `2F8B7E6C`, `44A7CD32`,
  `60283812`, `87193686`, `CEED3E34`, and `F1E7F185`.
- Last reviewed: 2026-07-27
