# NotionalSpec Loop — Failure Recovery

What to do when the semantic authoring loop (generate-viz-from-notional-spec, the workbook-document round-trip, and the /v0 command channel) misbehaves. Companion to `../data/notional-spec-authoring.md` (the happy path) — this module is the crash cart. All patterns live-verified 2026-07-19 (first Sonnet 5 audition + forensics).

## When to Use

- A `generate-viz-from-notional-spec` call errors (500), reports SUCCEEDED but nothing changed, or lands on the wrong sheet.
- Session-scoped calls start failing while reads still work, or reads start failing too.
- The workbook changes in ways you did not cause (sheets appearing/vanishing, calcs you never authored).
- You must decide between retrying the spec, stepping down the ladder, or stopping to tell the user.

## Best Practices

- **Diagnose by error class before retrying** (calibrated live): HTTP 404 `command-not-found` = the command name is wrong — fix the name, never retry as-is. 400 `invalid-request-body` = wire-shape error (the envelope, not your spec). 500 on generate-viz = the spec payload violates the contract (fabricated keys, forbidden `WorksheetId`/`worksheetName` param) — re-read the authoring module and rebuild the spec; do NOT immediately fall back, one corrected retry is cheaper than abandoning the fast path.
- **`{"type":"unknown","error":{}}` on writes while reads succeed = the app is dying or modally blocked, not your command.** Stop retrying. Check once whether reads still answer; if reads fail too, the Desktop process is gone — tell the user the connection is down, never pretend to build. (Live: a `tabdoc:save` preceded exactly this pattern, then process death.)
- **Recover a clobbered or wrong sheet by regeneration, not repair**: the spec is the whole sheet contract, so the last-known-good FULL spec resent on the sheet is a complete restore. Keep every spec you apply, per sheet, in conversation state — that ledger IS your undo.
- **After any interruption (yours or the app's), re-inventory before writing**: `list-worksheets` + a fields listing. If sheets you created are missing or foreign content appeared, the workbook changed underneath you — report what you observed, re-anchor on current state, and never rebuild from your stale mental model (a stale whole-document write destroys concurrent work).
- **Async settle discipline on every recovery step**: after new-worksheet/goto-sheet/delete, poll the list readbacks (250 ms) until the change is visible; SUCCEEDED means dispatched, not landed.

## Common Mistakes

1. **Falling back to bind-template or XML on the FIRST 500** without checking the spec against the contract — most 500s here are self-inflicted schema fabrications; one corrected semantic retry preserves the fast path.
2. **Retrying writes into a modal-blocked or dying app** — each retry can queue more damage; classify the unknown-error pattern first.
3. **Rebuilding a "lost" sheet from memory with a whole-document write** — if the document moved since your read, you erase everyone else's changes. Regenerate per-sheet with a spec instead; document-level writes need a fresh read immediately before.
4. **Treating a failed refine readback as proof of failure** — one live case reported "Top-N filter missing" while the filter WAS present moments later (async race in the verification read). Re-read once after a settle before repairing anything.
5. **Silently switching mechanisms during recovery** — if recovery moves you from the spec loop to templates or XML, say so in one line; never present the substitute as the original plan.

## Implementation

Recovery decision ladder (top = try first):

```text
generate-viz 500        -> re-read notional-spec-authoring, rebuild spec, retry ONCE
                           still 500 -> bind-template (say so) -> XML (say so)
writes unknown-error    -> reads OK?  -> modal/ dying app: STOP, tell user
                           reads dead -> Desktop gone: STOP, tell user
sheet wrong/clobbered   -> resend last-known-good FULL spec on that sheet
world changed under you -> re-inventory (list-* + fields), re-anchor, report it
refine readback "missing" -> settle ~1s, re-read once, only then repair
```

Confirmed-working restore (live): sheet held a sorted bar (spec A); a later partial/foreign write blanked it; resending spec A verbatim on the same sheet restored the exact chart — `<computed-sort>` and all — in one call.

### What does NOT work

- `ClearSheet:false` as an undo (it does not merge; the spec always replaces).
- Reading the current spec back over the generic route (`generate-notional-spec-from-viz` is write-blind) — your conversation ledger is the only spec memory.
- Trusting one immediate post-dispatch read as ground truth (async apply).

## Source and Confidence

- Source/evidence type: live failure forensics on Tableau Desktop via the External API — error-class calibration probes, a process-death incident, an orphaned-writer clobber incident, and a verified full-spec restore (2026-07-19).
- Customer-identifying details removed: yes
- Confidence: live-verified for every pattern above; the refine-readback race is a reproduced observation with the falsification step still open.
- Last reviewed: 2026-07-19
