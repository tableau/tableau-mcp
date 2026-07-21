# Recovering From "Not Found" and Honoring the Verification Receipt

Two failure-mode rules for live Tableau Desktop authoring: treat a field or datasource "not found" as a stale cache (refresh with a live session first), and never claim success that contradicts the HOST VERIFICATION receipt.

These two rules cover the moments an agent is most tempted to report the wrong thing: giving up ("Tableau is unreachable / the field is gone") on a cache that simply went stale, and declaring "done" over evidence that the change did not survive. Both failures are avoidable with one extra read.

## When to Use

- **A field or datasource lookup returns `not_found`** (from `resolve-field`, `list-available-fields`, or a field tool), *especially* right after the user changed the workbook — connected a new data source, renamed a field, swapped an extract, or added a sheet in Tableau.
- **You are about to report a change is finished** after any apply-style call (`apply-worksheet`, `apply-workbook`, `apply-dashboard`, `apply-dashboard-with-viewpoints`, `build-and-apply-dashboard`, `dashboard-auto-apply`). Read the `HOST VERIFICATION` line *before* you narrate success.

## Best Practices

### Rule 1 — "Not found" is usually a stale cache, not an unreachable Tableau

The cache file you hold (`workbookFile`) is a snapshot from an earlier `get-workbook-xml`. If the user changed the workbook after that snapshot, a lookup against the stale file will miss the new field — but Tableau is fine.

- Before concluding anything is unreachable or missing, **refresh from the live session**:
  - `list-available-fields` with a `session` argument refreshes the live workbook into the cache file *first*, then lists (its own error text: "Retry without session to read the cache as-is."). This is the self-healing path.
  - Or re-run `get-workbook-xml` (with `session`) to write a fresh cache file, then re-run `list-available-fields` / `resolve-field` against that new file.
- **`resolve-field` does NOT refresh** — it only reads the `workbookFile` you pass. After a refresh, point it at the freshly-refreshed cache file.
- **Know when to stop.** If, *after a genuine refresh*, `resolve-field` still returns `kind: "not_found"` (or `list-available-fields` still omits it), the field genuinely does not exist in the current workbook. Stop re-reading caches — resolve the ambiguity with the user or report the field is absent. Do not spiral.

### Rule 2 — Honor the `HOST VERIFICATION` receipt before claiming success

Apply-style tool results end with a host-computed receipt line derived from what the server actually measured (validation preflight + structural readback), not from anything the model asserts:

```
HOST VERIFICATION — <status>: <checks> . <claim guard>
```

- `status` is one of **`verified`**, **`unverified`**, **`failed`**. **`verified` is the only status that backs a "done" claim.**
- Worksheet applies get a real structural readback, so they can reach `verified`. **Whole-workbook and dashboard applies are `unverified` by construction** — there is no structural readback for them yet, so the receipt says so plainly.
- If the receipt says `unverified` or `failed` for something you claimed — a sort, a filter, an encoding, or the change as a whole — **re-read the artifact and correct your answer before reporting completion**: `get-worksheet-xml` for a sheet, `get-dashboard-xml` for a dashboard, `get-workbook-xml` for the whole workbook (or worksheet-list readback / `check-for-user-changes` to confirm survival).
- Never report success that contradicts the receipt. Report only the evidence the host gives you.

## Common Mistakes

What does **NOT** work:

- **Declaring "Tableau is unreachable" or "that datasource is gone" on the first `not_found`** without a session refresh. The far more common cause is a stale cache from before the user's change.
- **Re-reading the same stale cache repeatedly** — calling `resolve-field` again against an un-refreshed `workbookFile` and expecting a different answer. `resolve-field` reads the file as-is; nothing changes until you refresh the file.
- **Narrating success over a failed/unverified receipt** — e.g. answering "Done — sorted descending and filtered to Top 10" when the line reads `HOST VERIFICATION — failed: … readback FAILED (nodes dropped).` The nodes were dropped; the claim is false.
- **Treating a whole-workbook or dashboard `unverified` receipt as confirmation.** `unverified` means "not re-verified," not "verified." Read the sheet back before claiming the intent landed.
- **Inventing problems that nothing measured** when the receipt is `verified` — the guard text explicitly says not to report unlisted issues.

## Implementation

### Confirmed-working: stale-cache re-read sequence

User connects a new "Targets (Excel)" data source in Tableau, then asks to put `[Target]` on the view. The agent still holds a `workbookFile` cached before that connection:

```
1. resolve-field({ workbookFile: <pre-change cache>, query: "Target" })
   → { resolution: { kind: "not_found" }, isError: true }        # stale cache — do NOT conclude "unreachable"

2. list-available-fields({ session: "inst-1", workbookFile: <same cache path> })
   → refreshes the LIVE workbook into that cache file, then lists → [Target] now appears

3. resolve-field({ workbookFile: <same cache, now refreshed>, query: "Target" })
   → { resolution: { kind: "exact", column_ref: "[Targets (Excel)].[sum:Target:qk]" }, isError: false }
```

Equivalent refresh via a fresh snapshot: `get-workbook-xml({ session: "inst-1" })` → new cache file → `list-available-fields`/`resolve-field` against the new file. If step 3 *still* returns `not_found` after a real refresh, the field does not exist — stop and ask.

### Confirmed-working: receipt-contradiction correction

```
apply-worksheet({ ... }) →
  "Applied worksheet 'Sales by Region'.

   HOST VERIFICATION — failed: preflight clean · apply completed · readback FAILED (nodes dropped).
   Do not claim the change is confirmed; report only the evidence above."
```

- **Wrong:** "Done — I sorted by Sales descending and filtered to Top 10." (contradicts `failed`)
- **Right:** the receipt says nodes were dropped, so re-read and correct before reporting:

```
1. get-worksheet-xml({ session, worksheet: "Sales by Region", mode: "file" })   # inspect what actually survived
2. patch the specific dropped construct (the sort / filter node), then re-apply
3. apply-worksheet(...) → HOST VERIFICATION — verified: … readback clean.       # only NOW report "done"
```

For a whole-workbook or dashboard apply, the receipt is `unverified` by design:

```
HOST VERIFICATION — unverified: preflight clean · apply completed · full workbook intent NOT re-verified.
Treat sheet-level state as unconfirmed until read back; do not report problems without host evidence.
```

Read the affected sheets back (`get-worksheet-xml` / worksheet-list readback) before claiming the intent landed; report the apply as completed-but-unverified until you have that evidence.

## Source and Confidence

- Source/evidence type: ported from the `agent-to-tableau-desktop` bundled skill "When things fail" rules 8 (stale-cache re-read) and 9 (honor the `HOST VERIFICATION` receipt), merged 2026-07-16. Adapted to tmcp tool names and the tmcp receipt seam.
- Enforcement/receipt seams in this repo: `src/desktop/validation/promise-check.ts` (the `HOST VERIFICATION` receipt), `src/desktop/validation/readback-verify.ts` (worksheet structural readback), `src/tools/desktop/fields/listAvailableFields.ts` (session refresh) and `src/tools/desktop/fields/resolveField.ts` (cache-only resolve).
- Related: `expertise://tableau/tactics/workflow/recovery` (failed-apply recovery ladder) · `expertise://tableau/strategy/workflow/troubleshooting-workbooks` (general troubleshooting).
- Confidence: field-tested (a2td merged rules)
- Last reviewed: 2026-07-16
