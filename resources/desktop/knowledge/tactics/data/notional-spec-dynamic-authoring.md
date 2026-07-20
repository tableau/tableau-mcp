# Dynamic Dashboards for the Semantic Loop (the author-* verbs)

A dynamic Tableau dashboard — parameters the user drives, computed Top/Bottom-N sets, click-to-change actions, formatted labels — is authored entirely through the document round-trip, wrapped as `author-*` verbs so **no agent ever writes XML**. This module is the routing map: which verb for which shape, and the one law that governs all of them.

The law, in one line: **parameters are the KEY SIGNATURE (established at OPEN time); calcs, sets, actions, and formatting are the MELODY (merged live over them).** Live-proven end-to-end 2026-07-19 on Tableau Desktop (main.26.0715) — the full Workout-Wednesday W44 machinery, no dialogs, no Cloud sign-in, every mutation readback-verified.

---

## Scope Check

- Primary audience: Tableau agent / semantic viz authoring
- Authoring outcome improved: calculate, create, refine, format, interact
- In-scope reason: Names the five authoring verbs and the OPEN-vs-MERGE law that decides how each shape is authored.
- Out-of-scope risk: Companion to `notional-spec-calc-authoring.md` (calc detail) and `calc-fields.md` (column XML rules) — those carry the per-shape rules; this is the router.
- Tags: notional-spec, parameters, sets, actions, formatting, document-roundtrip, dynamic-dashboard, author-verbs
- Relevant user prompts/search terms: "top N parameter", "let the user pick", "dynamically show top or bottom", "parameter control", "filter action", "show labels", "workout wednesday", "dynamic dashboard"

## When to Use

When an ask is DYNAMIC — the user wants to drive the viz (pick N, pick a period, click to filter) or wants computed membership (top/bottom performers, an "Everyone Else" rollup) — reach for the verb, never hand-authored XML. Route by shape:

| Shape the ask needs | Verb | Authored via |
|---|---|---|
| Calculated field (ratio, rank, running total, LOD, YoY) | `author-calc` | live MERGE |
| Computed Top/Bottom-N set (param-linked or fixed) | `author-set` | live MERGE |
| **Parameter** (the control the user drives) | `author-parameter` | **OPEN — the verb reopens for you, in-call** |
| Parameter-change action (click a mark → set a param) | `author-action` | live MERGE |
| Mark labels on/off | `format-labels` | live MERGE |

The build ORDER follows the law: **author the parameters FIRST** (they need a reopen to be born — `author-parameter` performs that reopen itself and re-pins the session before returning), then merge calcs/sets/actions/formatting over them, then build the sheets/dashboard with the NotionalSpec loop.

## Best Practices

- **Author parameters first, everything else after.** A parameter is born only at OPEN time — `author-parameter` seeds it into a stage on disk, relaunches Desktop from that stage, readback-verifies the parameter in the reopened document, re-pins the session, and closes the old instance, all inside the one call (returns `{ reopened: true, newSession }`; ~5s, live-proven). `stagePath` is optional — omit it and the verb stages under the user's Tableau repository. Only if the reopen cannot complete does it degrade to `{ stagePath, reopenRequired: true, reopenError }` — the seeded stage on disk is then the honest fallback. The reopen preserves all previously merged work (live-proven).
- **Reference a parameter by its token in downstream verbs**: `author-set` takes `count: '[Parameters].[Parameter 3]'` and Tableau resolves it at runtime — that is what makes the set dynamic. You do not mutate parameter VALUES to make a dashboard dynamic; the end user does that by moving the control.
- **Every verb readback-verifies.** Each `author-*` verb reads the document back after the load and confirms its change is present before returning. A `completed`/`SUCCEEDED` envelope does NOT prove the change applied — the verb's readback is the truth. Trust the verb's result, not the envelope.
- **Numbers stay unverified until verified** (non-negotiable, inherited from `notional-spec-calc-authoring.md`): the verbs prove STRUCTURE (the node is present, the link is intact), never VALUES. Present a computed number only after an independent check, or say it is unverified.
- **Keep the user's tree sacred**: the verbs add nodes; they never drop or rewrite what they did not author.

## Common Mistakes

1. **Trying to MERGE a parameter into a live workbook.** The `Parameters` datasource is frozen to live merge — create, add, and value-edit are ALL silently refused (envelope SUCCEEDED, readback unchanged; live-proven 2026-07-19). Use `author-parameter` (which reopens); never splice a parameter into a live document and expect it to stick.
2. **Reaching for `create-new-parameter` / `edit-existing-parameter` / `create-or-edit-parameter`.** Every headless parameter create/edit command is a blocking `dlg.DoModal()` dialog — it hangs an unattended session (live-proven: `edit-existing-parameter` popped a modal despite the command reference marking it non-dialog). The command reference misclassifies these; ignore it here and use `author-parameter`.
3. **Building the dashboard before the parameter exists.** The calc/set that references `[Parameters].[Parameter N]` needs the parameter to already be in the document. Author parameters first, reopen, then the rest.
4. **Hand-writing `<edit-parameter-action>` / `<group><groupfilter>` / `<format>` XML.** These all MERGE cleanly via their verbs — `author-action`, `author-set`, `format-labels`. If you find yourself editing XML for a dynamic shape, you missed the verb.
5. **Treating a rendered dynamic dashboard as numerically correct.** Structure proven ≠ values correct. Verify.

## Implementation

### Recipe: the full dynamic Top/Bottom-N dashboard (Workout-Wednesday W44 shape)

The law made concrete — key signature first, melody over it:

1. **Key signature — author the parameters (each call reopens + re-pins itself):**
   ```
   author-parameter { caption: 'p.Top N Sub-Category', datatype: 'integer', value: '5' }
   author-parameter { caption: 'p.Period', datatype: 'string', value: 'Month', members: ['Month','Quarter','Year'] }
   → each returns { reopened: true, newSession } — continue authoring immediately
   ```
2. **Melody — merge the computed set, linked to the parameter:**
   ```
   author-set { caption: 'Top N Sub-Category Set', dimension: 'Sub-Category',
                orderBy: 'SUM([Profit])', count: '[Parameters].[Parameter 3]', end: 'top' }
   ```
3. **Melody — any period/rank calcs** (via `author-calc`, referencing the period parameter by caption).
4. **Melody — the interaction** (click a mark to change the period):
   ```
   author-action { caption: 'Set Period', sourceWorksheet: 'Profit',
                   sourceField: '[Sample - Superstore].[:Measure Names]',
                   targetParameter: '[Parameters].[Parameter 1]', activation: 'on-select' }
   ```
5. **Melody — polish:** `format-labels { worksheet: 'Profit', showLabels: true }`.
6. **Build the sheets + dashboard** with the NotionalSpec loop, referencing the set/calcs by caption and placing the parameter controls.

### What does NOT work

- Merging any change into the `Parameters` datasource on a live workbook (create/add/value-edit all no-op — reopen is the only path).
- The `create-*-parameter` command family (blocking dialogs; hang unattended runs).
- Expressing parameters/sets/actions inside NotionalSpec JSON (the schema has no vocabulary for them — that is why the verbs exist).
- Any claim that a dynamic dashboard's numbers are right because it rendered.

## Source and Confidence

- Source/evidence type: live execution on Tableau Desktop (main.26.0715) via the External API document round-trip
- Source: 2026-07-19 CODA sessions — each shape live-probed and readback-verified (params frozen-to-merge / born-at-open; sets + actions + mark-labels merge; reopen preserves the melody); the five verbs are `author-calc`/`author-set`/`author-parameter`/`author-action`/`format-labels`.
- Customer-identifying details removed: yes
- Confidence: live-verified mechanism per shape; per-value numerical correctness explicitly NOT covered (verify values independently)
- Source addendum: 2026-07-20 ATTACCA — in-call reopen shipped and e2e-proven (direct-binary relaunch; `open -a` loses the document Apple Event among multiple instances).
- Last reviewed: 2026-07-20
