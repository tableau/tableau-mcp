# Dynamic Dashboards: the author-* Verb Set (Parameters, Sets, Actions, Formatting)

A dynamic Tableau dashboard — parameters the user drives, computed Top/Bottom-N sets, click-to-change actions, formatted labels — is authored entirely through the document round-trip, wrapped as `author-*` verbs so **no agent ever writes XML**. This module is the routing map: which verb for which shape, and the one law that governs all of them.

The law, in one line: **author the parameters FIRST — downstream calcs, sets, and actions reference them by token — then merge everything else over them. Every shape, parameters included, is authored the SAME way: one live in-place document round-trip against the running instance, no reopen.** Live-proven end-to-end 2026-07-19 on Tableau Desktop (main.26.0715) — the full Workout-Wednesday W44 machinery, no dialogs, no Cloud sign-in, every mutation readback-verified — and the in-place parameter path re-proven live 2026-08-20 (the parameter materializes on the same running instance; the session is unchanged).

---

## Scope Check

- Primary audience: Tableau agent / semantic viz authoring
- Authoring outcome improved: calculate, create, refine, format, interact
- In-scope reason: Names the five authoring verbs and the OPEN-vs-MERGE law that decides how each shape is authored.
- Out-of-scope risk: Companion to `calc-fields.md` (column XML rules, and the wrong-fork check that routes calc authoring to `author-calc` first) — that file carries the per-shape XML rules; this is the router for parameters/sets/actions/formatting.
- Tags: parameters, sets, actions, formatting, document-roundtrip, dynamic-dashboard, author-verbs
- Relevant user prompts/search terms: "top N parameter", "let the user pick", "dynamically show top or bottom", "parameter control", "filter action", "show labels", "workout wednesday", "dynamic dashboard"

## When to Use

When an ask is DYNAMIC — the user wants to drive the viz (pick N, pick a period, click to filter) or wants computed membership (top/bottom performers, an "Everyone Else" rollup) — reach for the verb, never hand-authored XML. Route by shape:

| Shape the ask needs | Verb | Authored via |
|---|---|---|
| Calculated field (ratio, rank, running total, LOD, YoY) | `author-calc` | live MERGE |
| Computed Top/Bottom-N set (param-linked or fixed) | `author-set` | live MERGE |
| **Parameter** (the control the user drives) | `author-parameter` | **live MERGE (in place)** |
| Parameter-change action (click a mark → set a param) | `author-action` | live MERGE |
| Set action (click a mark → change set membership, mode 'set' + targetSet) | `author-action` | live MERGE |
| Mark labels on/off | `format-labels` | live MERGE |

The build ORDER follows the law: **author the parameters FIRST** (a calc/set/action that references `[Parameters].[Parameter N]` needs the parameter already in the document — the token has nothing to resolve otherwise), then merge calcs/sets/actions/formatting over them, then build the sheets/dashboard with `bind-template` / `refine-worksheet`. Order matters because of downstream token references, not because a parameter needs a reopen — it does not.

## Best Practices

- **Author parameters first, everything else after.** `author-parameter` merges the parameter into the LIVE document in place — the same round-trip every other `author-*` verb uses — and readback-verifies it before returning `{ applied: 'in-place', session }`. No stage file, no relaunch, no SIGTERM: the session is unchanged and you keep authoring against the same instance. If a workbook has more than one non-`Parameters` datasource, pass `datasource` to say which one hosts the parameter; with a single datasource the verb picks it automatically.
- **Reference a parameter by its token in downstream verbs**: `author-set` takes `count: '[Parameters].[Parameter 3]'` and Tableau resolves it at runtime — that is what makes the set dynamic. You do not mutate parameter VALUES to make a dashboard dynamic; the end user does that by moving the control.
- **Every verb readback-verifies.** Each `author-*` verb reads the document back after the load and confirms its change is present before returning. A `completed`/`SUCCEEDED` envelope does NOT prove the change applied — the verb's readback is the truth. Trust the verb's result, not the envelope.
- **Numbers stay unverified until verified** (non-negotiable, inherited from `calc-fields.md`): the verbs prove STRUCTURE (the node is present, the link is intact), never VALUES. Present a computed number only after an independent check, or say it is unverified.
- **Keep the user's tree sacred**: the verbs add nodes; they never drop or rewrite what they did not author.

## Common Mistakes

1. **Hand-splicing a bare `<datasource name='Parameters'>` block into a live workbook.** A top-level Parameters datasource that nothing references is dropped on the round-trip (envelope SUCCEEDED, readback unchanged; live-proven). A parameter materializes only through dependency resolution — the full parameter `<column>` inside a `<datasource-dependencies datasource='Parameters'>` block hung off a REAL datasource. `author-parameter` does exactly this in place, so use the verb; do not write the XML yourself.
2. **Reaching for `create-new-parameter` / `edit-existing-parameter` / `create-or-edit-parameter`.** Every headless parameter create/edit command is a blocking `dlg.DoModal()` dialog — it hangs an unattended session (live-proven: `edit-existing-parameter` popped a modal despite the command reference marking it non-dialog). The command reference misclassifies these; ignore it here and use `author-parameter`. See `dialog-command-misclassification.md`.
3. **Building the dashboard before the parameter exists.** The calc/set that references `[Parameters].[Parameter N]` needs the parameter to already be in the document. Author parameters first, then the rest.
4. **Hand-writing `<edit-parameter-action>` / `<group><groupfilter>` / `<format>` XML.** These all MERGE cleanly via their verbs — `author-action`, `author-set`, `format-labels`. If you find yourself editing XML for a dynamic shape, you missed the verb.
5. **Treating a rendered dynamic dashboard as numerically correct.** Structure proven ≠ values correct. Verify.

## Implementation

### Recipe: the full dynamic Top/Bottom-N dashboard (Workout-Wednesday W44 shape)

The law made concrete — key signature first, melody over it:

1. **First — author the parameters (each merges in place against the same session):**
   ```
   author-parameter { caption: 'p.Top N Sub-Category', datatype: 'integer', value: '5' }
   author-parameter { caption: 'p.Period', datatype: 'string', value: 'Month', members: ['Month','Quarter','Year'] }
   → each returns { applied: 'in-place', session } — same instance, continue authoring immediately
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
5. **Melody — polish:** `format-labels { worksheetName: 'Profit', showLabels: true }`.
6. **Build the sheets + dashboard** with `bind-template` / `refine-worksheet`, referencing the set/calcs by caption and placing the parameter controls.

### What does NOT work

- Hand-splicing a bare, unreferenced `<datasource name='Parameters'>` block into a live workbook (dropped on the round-trip — a parameter materializes only via a `<datasource-dependencies datasource='Parameters'>` block on a real datasource, which is what `author-parameter` writes).
- The `create-*-parameter` command family (blocking dialogs; hang unattended runs).
- Expressing parameters/sets/actions in a chart-binding request (there is no vocabulary for them there — that is why the verbs exist).
- Any claim that a dynamic dashboard's numbers are right because it rendered.

## Source and Confidence

- Source/evidence type: live execution on Tableau Desktop (main.26.0715) via the External API document round-trip
- Source: 2026-07-19 CODA sessions — each shape live-probed and readback-verified (sets + actions + mark-labels merge live); the five verbs are `author-calc`/`author-set`/`author-parameter`/`author-action`/`format-labels`.
- Customer-identifying details removed: yes
- Confidence: live-verified mechanism per shape; per-value numerical correctness explicitly NOT covered (verify values independently)
- Source addendum: 2026-08-20 — the parameter path was re-proven and reworked to author IN PLACE (the earlier "frozen to merge / born at open / reopen" finding was a misdiagnosis). A parameter materializes on the running instance via a `<datasource-dependencies datasource='Parameters'>` block on a real datasource; the stage-and-relaunch path was removed. `author-parameter` returns `{ applied: 'in-place', session }`.
- Last reviewed: 2026-08-21
