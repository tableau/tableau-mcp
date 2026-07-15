# Troubleshooting Common Tableau Issues

Reference guide for diagnosing and resolving common Tableau Desktop problems — covering broken datasource connections, invalid calculated fields, dashboard rendering issues, and workbook corruption.

Tags: troubleshooting, datasource, calculated-fields, workbook-corruption, recovery

**Tactics companion:** `expertise://tableau/tactics/workflow/recovery` — the XML/authoring mechanics for this topic. (That companion covers recovery from a failed MCP apply call specifically; this file covers generic Desktop troubleshooting that applies regardless of how the workbook was authored.)

## Scope Check


- Primary audience: Tableau user / SE assisting a Tableau user
- Authoring outcome improved: troubleshoot
- In-scope reason: Guides Claude through diagnosing broken datasource connections, invalid calculated fields, and blank dashboard views to restore a workbook to a working state.
- Out-of-scope risk: none
- Tags: troubleshooting, datasource, calculated-fields, workbook-corruption, recovery, extract, performance, blank-view, connection-error
- Relevant user prompts/search terms: "workbook won't open", "datasource connection error", "calculated field showing red exclamation", "dashboard view is blank", "extract refresh failing", "Tableau performance slow", "Cannot mix aggregate and non-aggregate", "Unknown field error", "workbook created with newer version", "recovering corrupted TWBX"

## When to Use

Use this guide when:
- **A customer reports a broken workbook** — sheets not loading, datasource errors, missing fields
- **A calculated field shows an error** in the Data pane despite appearing valid
- **Dashboard views are blank or missing** after opening a workbook on a different machine
- **A workbook won't open** or opens with an error dialog
- **An extract is failing to refresh** on Tableau Server/Cloud

---

## Datasource Connection Errors

### "Unable to connect to the server" or "Data source not found"

**Causes:**
- Server address or credentials changed
- User doesn't have network access to the database from their machine
- Published datasource was moved or deleted on the server

**Diagnose:**
1. Data menu → Data Sources — check which datasource is showing the error icon (red !)
2. Right-click the datasource → Edit Connection — verify the server address and credentials
3. Click Test Connection to check network reachability

**Fix:**
- Update the server address or credentials in Edit Connection
- For published datasources, re-link: Data menu → New Data Source → select the published source from the server

### Extract file not found (.hyper)

Happens when a `.twb` (not packaged) references a local extract file at an absolute path, and the file has moved or doesn't exist on the current machine.

**Fix:**
- Data menu → Data Sources → right-click the datasource → Edit Connection → Browse to the new location of the `.hyper` file
- Or, re-create the extract: Data menu → Extract Data

**Prevention:** use `.twbx` (packaged workbook) for portability — it embeds the extract file.

---

## Invalid / Broken Calculated Fields

A field showing a red exclamation mark in the Data pane.

### Diagnostic steps

1. Double-click the broken field → the formula editor shows the issue underlined in red with a description at the bottom
2. Read the error message — the most common messages and their causes:

| Error message | Cause |
|---|---|
| "Cannot mix aggregate and non-aggregate comparisons or results" | Formula mixes `SUM([Sales])` with row-level `[Quantity]` without an LOD |
| "Cannot mix aggregate and non-aggregate arguments" | Same as above, different wording |
| "Function 'X' is called with wrong number of arguments" | Wrong number of arguments to a function like DATEDIFF |
| "Expected type '...'" | A string field used where a number is expected, or vice versa |
| `Unknown field [X]` | The referenced field was renamed, deleted, or the datasource changed |
| `Invalid reference to 'Parameters.[Name]'` | The parameter was renamed or deleted |

### Quick fixes

- **Unknown field:** check whether the referenced field still exists. If it was renamed, update the formula.
- **Aggregate/non-aggregate mix:** wrap row-level fields in an aggregation (`SUM()`, `MIN()`, `AVG()`), or move the aggregation logic into a FIXED LOD.
- **Wrong data type:** use `INT()`, `FLOAT()`, `STR()`, or `DATE()` to cast the field to the expected type.

---

## Dashboard Views Blank or Missing

### Sheet appears blank on a dashboard

**Check 1:** is the sheet hidden with a filter that returns no results? Add the sheet to its own tab and see if it shows data. If blank there too, the filter is too restrictive.

**Check 2:** is the sheet's datasource connected? If the datasource has an error, the sheet renders blank on the dashboard without an obvious error message.

**Check 3:** is the sheet's mark size too small? On a very small dashboard zone, marks may be sized to less than 1px. Right-click the blank zone → View Sheet → check the sheet at full size.

### Sheet shows "Connecting..." indefinitely

Usually a network timeout or datasource performance issue.

**Diagnose:** navigate directly to the sheet tab — does it load there? If the sheet loads on the tab but hangs on the dashboard, it may be a dashboard layout performance issue. Check if other sheets on the same dashboard also hang.

**Temporary fix:** create an extract (Data menu → Extract Data) to pre-compute the data. Extracts are much faster than live connections for dashboards.

---

## Workbook Won't Open

### "This file is not in a recognizable format"

- The file may be corrupted or saved in an incompatible Tableau version
- If it's a `.twbx`, try renaming to `.zip` and extracting the `.twb` manually. Then try opening the `.twb` file directly.

### "This workbook was created with a newer version of Tableau"

Tableau workbooks are not backward-compatible by major version. A workbook saved in Tableau Desktop 2024.2 cannot be opened in 2023.3.

**Options:**
- Upgrade Tableau Desktop to a version ≥ the workbook's version
- Ask the person who sent the workbook to re-save it using Save As in an older version (File → Export As Version)

### Workbook opens but some sheets have errors

- Check whether all custom fonts are installed on this machine (missing fonts can cause rendering differences, not errors)
- Check whether the datasource is accessible from this machine
- Check whether extensions used in the workbook are available on this Tableau version

---

## Extract Refresh Failures (Tableau Server/Cloud)

**Find the failure reason:**
1. On Tableau Server: Admin area → Jobs → find the failed job → click to see the error message
2. On Tableau Cloud: same path via the web UI

**Common causes:**

| Error | Cause | Fix |
|---|---|---|
| "Authentication failed" | Database credentials expired or changed | Update credentials in the datasource's Edit Connection on Server |
| "Connection timed out" | Database is slow or unreachable from the server | Check database performance; verify the server has network access to the database |
| "Data source error: X" | Database-side error (permissions, table missing, syntax) | Check the database directly; verify the user account has SELECT permissions |
| "Extract exceeds maximum allowed size" | Extract is larger than the server's size limit | Reduce extract size with extract filters; increase the server limit in Admin settings |

**Credentials for extracts:** embedded credentials in an extract connection are used at refresh time. If the database password changes, the extract will start failing. Update via Data menu on the workbook → Data Sources → right-click → Edit Connection → update password → publish back to server.

---

## Undo and Recovery

### Undo (in Desktop)

Tableau supports multi-level undo (Ctrl+Z / Cmd+Z). Use it to step back from an unwanted change.

### Revert to Saved

File → Revert to Saved discards all changes since the last save and reloads from disk. Use when you've made a mess of a workbook and want to start from the last clean state.

### Recovering an unsaved workbook

Tableau Desktop auto-saves to a temp location. If Desktop crashes:
- **Windows:** check `Documents\My Tableau Repository\Workbooks\` for auto-saved copies
- **Mac:** check `~/Documents/My Tableau Repository/Workbooks/`

Look for files with names like `Untitled` or the workbook name with a timestamp suffix.

### Recovering from a corrupted .twbx

1. Rename the `.twbx` to `.zip` and extract
2. The `.twb` file inside is the XML workbook definition
3. Open the `.twb` in a text editor and look for XML syntax errors (unclosed tags, invalid characters)
4. Re-package: create a new `.zip`, add the corrected `.twb` and any data files, rename back to `.twbx`

---

## Performance Troubleshooting

### Dashboard is slow to load

**Check 1:** is it a live connection to a slow database? Create an extract and see if performance improves. If it does, the issue is database query time.

**Check 2:** are there too many marks in the view? Text tables with thousands of rows, scatter plots with millions of points, and large crosstabs all render slowly. Use aggregation or filtering to reduce mark count.

**Check 3:** are there complex table calculations or many FIXED LODs? Each adds query time. Check which views are slowest by loading them individually.

**Check 4:** Tableau's Performance Recorder: Help menu → Settings and Performance → Start Performance Recording. Interact with the dashboard normally, then stop recording. This creates a workbook showing where time is spent (query time, rendering time, layout time).

---

## Best Practices

- **Always try to reproduce the issue on the same machine as the customer.** Many issues (missing fonts, network connectivity, extract paths) are environment-specific.
- **Start with the simplest hypothesis.** Most workbook errors are broken field references, expired credentials, or version mismatches — not complex corruption.
- **Check Tableau Server logs for Server-side issues.** Desktop errors are visible in the UI; Server errors (failed refreshes, publishing errors) require log inspection or the Admin area.
- **Create an extract when diagnosing performance.** If an extract makes a slow dashboard fast, the bottleneck is the database, not Tableau.

---

## Common Mistakes

1. **Assuming a blank view is a rendering bug.** Almost always a data issue — too restrictive a filter, null handling, or a broken datasource. Check the data first.
2. **Trying to open a newer workbook in an older Tableau version.** Tableau shows a cryptic error rather than a clear version mismatch message. Always check the Tableau version the workbook was saved with.
3. **Updating datasource credentials locally without publishing the update.** The change stays on the local machine. To update credentials on the server, re-publish the workbook after updating the connection.
4. **Attempting to recover from corruption by editing the TWB XML without understanding the structure.** Manual XML editing can introduce new errors. Make a backup copy first, and verify in Desktop before re-packaging.
5. **Letting an extract go stale without noticing.** Extracts don't auto-refresh in Desktop — they only refresh if scheduled on Server or manually via Data → Refresh All Extracts. Stale extracts show old data without any warning.

---

## Implementation

Work the sections above as a diagnostic decision tree: confirm the symptom (blank view, broken calc, won't-open, slow, failed refresh), form the simplest hypothesis, then verify the fix in Desktop before handing the workbook back. When the failure is in a workbook the agent just authored via an MCP apply call (malformed XML, rejected element, partial write), see `expertise://tableau/tactics/workflow/recovery` for the apply-call recovery steps.

## Source and Confidence

- Source/evidence type: SME-authored reference
- Source: Common Tableau diagnostic patterns (connection errors, calc errors, blank views, extract failures) from SE troubleshooting practice
- Customer-identifying details removed: yes
- Confidence: SME-reviewed
- Last reviewed: 2026-07-02
