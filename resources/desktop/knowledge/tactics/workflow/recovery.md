# Recovery from Failed Workbook Applies

## Scope Check


- Primary audience: Tableau agent / SE authoring XML
- Authoring outcome improved: troubleshoot
- In-scope reason: Recovery guidance helps Claude detect apply failures, distinguish real errors from Data-pane metadata lag, use undo or rollback snapshots, and verify post-apply state correctly.
- Out-of-scope risk: none
- Tags: recovery, undo, rollback, apply-failure, snapshot, error-dialog, logs, data-pane-warning, metadata-resolution, post-apply-verification, silent-failure, apply-history
- Relevant user prompts/search terms: "how do I recover from a failed apply", "workbook changes silently dropped", "Tableau shows error dialog after apply", "undo the most recent apply", "rollback to prior known-good state", "where are Tableau Desktop logs", "Data pane shows invalid datasources warning", "apply succeeded but Data pane not updated", "force metadata catch-up after apply", "post-apply verification with list-available-fields"

## When to Use

After a `tableau-apply-workbook` or `tableau-apply-worksheet` call fails, silently drops changes, or leaves Tableau Desktop in an error state. For file-based workbook document applies, the MCP server handles the required XML→JSON conversion automatically.

## Best Practices

### Apply history is automatic (not pre-apply protection)

The MCP server automatically saves the XML from every **successful** `tableau-apply-workbook` call. Snapshots are stored at:

```
/tmp/tableau-mcp-rollback/<session-id>/workbook-<timestamp>.xml
```

The server keeps the last 5 snapshots per session. These are **post-apply** snapshots — they contain the state that was just successfully applied, not the state before that apply. Key limitations:

- They **cannot** protect against a hard crash during the current apply (the crash prevents the snapshot from being saved)
- They **cannot** restore state if no prior successful apply occurred in the session
- They are useful for rolling back to a known-good state from N applies ago

For reversing the **most recent** apply, use `tabdoc:undo` instead — it is faster and does not require a file apply.

### Detect failures

The Agent API may report `status: "completed"` even when Tableau shows a GUI error dialog. Use this escalation ladder:

1. **Verify via MCP tools first.** After every apply, use worksheet-list readback or `tabdoc:goto-sheet` to confirm the expected sheets exist. If a sheet you just added is missing, the apply was silently rejected.

2. **Check MCP server logs.** Look for `exec_command_failed`, `fetch failed`, or `Command timed out` entries. These indicate the apply never reached Tableau or was rejected at the API level.

3. **Check Tableau Desktop logs.** The session manager resolves the Tableau repository path on session create (via `tabdoc:get-app-config` with `app-config-enum: "repository-dir"`). The logs directory is at `<repositoryDir>/Logs/`. Key files:
   - `log.txt` — main application log (most recent; look for `InformationBox` entries or `Command failed` warnings)
   - `log_1.txt` through `log_N.txt` — rotated logs (check if multiple instances are running)

   Search for `"not in a recognizable format"`, `CommandSystemInputsException`, or `Command failed` near the timestamp of the apply attempt. If multiple Tableau Desktop instances are open, each writes to its own set of log files — check the most recent files first and match the PID from your session.

4. **Check the screen (if screen-vision MCP is configured).** Use `get_window_list` to look for Tableau dialog windows — Qt-based modal dialogs are reported to the OS window manager. If a dialog is found, capture it to understand the error.

5. **Ask the user.** If you can't determine the error programmatically, ask the user to dismiss any modal dialogs and describe what they see. This is always valid and often fastest.

### Diagnose external-API write failures by error class before retrying

Calibrated live via `execute-tableau-command` (2026-07-19): different failure shapes mean different things, so classify before retrying blindly.

- **HTTP 404 `command-not-found`** — the command name is wrong. Fix the name (see `expertise://tableau/tactics/workflow/execute-command-crash-risk` — never guess a command name); do not retry the same call.
- **HTTP 400 `invalid-request-body`** — the request envelope shape is wrong, not the underlying intent. Check the parameter contract before changing approach.
- **HTTP 500 on a write whose payload has a documented contract** (a fabricated or forbidden field/parameter) — the payload violates that contract. Re-read the relevant authoring module and rebuild the payload; one corrected retry is cheaper than abandoning the approach on the first 500.
- **`{"type":"unknown","error":{}}` on writes while reads still succeed** — the app is dying or modally blocked, not your command. Stop retrying. Check once whether reads still answer; if reads fail too, the Desktop process is gone — tell the user the connection is down rather than pretending to build.

### Distinguish a real failure from a Data-pane warning lag

Not every "invalid" warning visible to the user means the apply actually failed. Tableau's Data pane is backed by a metadata-resolution service that runs asynchronously from the apply call. A short "invalid datasources" flash can appear in the Data pane after an apply that:

- **Introduces a multi-level calc dependency chain** (e.g. a calc that references a calc that references a calc — 3+ levels deep). Tableau has to walk and resolve the whole chain before the Data pane reflects green.
- **Bumps a `document-format-change-manifest` feature marker** (e.g. `ObjectModelRelationshipPerfOptions`, `SetMembershipControl`). These markers can fire the metadata service to re-evaluate against a newly-enabled evaluation mode.
- **Adds many calc fields simultaneously** on a datasource that also has a complex `<object-graph>` (native multi-table model) — the relationship graph + calc graph have to be reconciled together.

In every case the Agent API apply call has *already* returned success before the warning appears in the UI.

**Authoritative check (not the Data pane):**
```
tableau-list-available-fields workbook_file=<post-apply snapshot>
```
If the new fields appear in the returned list with correct `type`/`role`, the apply succeeded. The Data pane will catch up on the next view evaluation.

**Force the catch-up (don't rollback):**
```
execute_tableau_command command='tabdoc:goto-sheet' args='{"sheet":"<any worksheet>"}'
```
Switching to any worksheet triggers a full view-context evaluation that completes the metadata resolution. The warning clears.

**Do NOT** reach for `tabdoc:undo` or a snapshot rollback on the strength of a Data-pane warning alone. Verify via `tableau-list-available-fields` first; if the fields are there and typed correctly, the apply is real and the UI just needs a nudge.

### Recover from a bad state

**Undo the most recent apply (preferred for same-apply errors):**
- `tabdoc:undo` reverses the last action. Chain multiple calls for multi-step undo. Re-fetch the workbook afterward to confirm the restored state.
- This works even if no prior snapshot exists in the session.

**Rollback to a prior known-good state (for multi-step rollback):**
1. Find the most recent snapshot in `/tmp/tableau-mcp-rollback/<session-id>/` — these contain previously-applied XML, not the state before the current apply
2. Apply the chosen snapshot via `tableau-apply-workbook` with `mode=file` and `workbook_file` pointing to the snapshot
3. Verify recovery with worksheet-list readback

**Nuclear option — open a fresh instance:**
If Tableau Desktop is stuck (commands time out, dialogs can't be dismissed, or the workbook is corrupted):
1. Save the most recent working snapshot to a `.twb` file in a known location
2. Use `execute_tableau_command` with `tabui:open-workbook` on the backup file, OR ask the user to open it manually
3. If `tableau-list-instances` is absent from the tool list, the session is pinned to the launching Desktop; open the backup in that Desktop, or restart the MCP session against the fresh Desktop
4. Otherwise, after the new instance is running, call `tableau-list-instances` to discover its session ID
5. Switch to the new session and continue work

## Common Mistakes

1. **Reaching for rollback snapshots when `tabdoc:undo` is faster.** For same-apply errors, `tabdoc:undo` is immediate and doesn't require a file apply. Reserve snapshots for multi-step rollback to a state from N applies ago.
2. **Trusting `status: "completed"` from the Agent API.** Always verify with a follow-up tool call. The API reports success even when Tableau's UI shows an error dialog.
3. **Searching the wrong log file.** Multiple Tableau instances write to separate log files. Match the PID from your session to find the right log.
4. **Retrying the same malformed XML.** If an apply fails, re-fetching the workbook first (`tableau-get-workbook`) gives you a clean baseline. Never retry with the same modified XML without diagnosing why it failed.
5. **Spiraling through alternatives.** Cap recovery attempts at 3. After that, report the error to the user — they can see Tableau and may spot the issue faster.

## Implementation

### Apply history snapshot management

Implemented in `src/server/tools/shared-helpers.ts` (`saveRollbackSnapshot`). Called automatically after every successful `loadWorkbookXml` call. Saves the successfully-applied XML to `/tmp/tableau-mcp-rollback/<session-id>/workbook-<timestamp>.xml` and prunes to 5 snapshots per session. These are post-apply snapshots — not pre-apply state captures.

### Tableau Desktop log search (pseudo-code)

```typescript
// The session manager stores repositoryDir on session create.
// Access via sessionManager.getLogsDir(sessionId).
const logsDir = sessionManager.getLogsDir(sessionId);
const logPath = `${logsDir}/log.txt`;

// Search for errors near a timestamp:
// grep -i "recognizable\|Command failed\|InformationBox" <logPath> | tail -5
```

### Post-apply verification

```typescript
// After every apply, verify:
const sheets = await listWorksheets(sessionId);
if (!sheets.includes(expectedNewSheet)) {
  log("ERROR", "Apply was silently rejected — expected sheet not found");
  // Trigger recovery escalation
}
```

## Source and Confidence

- Source/evidence type: SME-authored reference
- Source: MCP rollback-snapshot design plus Tableau Desktop log-search and post-apply verification patterns; no customer data
- Customer-identifying details removed: yes
- Confidence: SME-reviewed
- Last reviewed: 2026-07-02
