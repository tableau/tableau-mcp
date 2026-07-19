# Dialog Commands the Reference Marks as Safe (Do Not Invoke Unattended)

The searchable command reference (`tableau-desktop-commands-reference.json`) is a search INDEX, not a capability census, and its `opens_blocking_dialog` flag lies for a whole class of commands. Fifteen commands whose source is a `*DialogCommand` are marked `opens_blocking_dialog: false` AND `agent_can_invoke: true` — invoking them on an unattended session pops a modal that holds the UI thread and wedges every subsequent command. Live-proven 2026-07-19: `tabdoc:edit-existing-parameter` (marked non-blocking) hung a session 12s on a parameter dialog while `/v0/health` stayed OK.

---

## Scope Check

- Primary audience: Tableau agent authoring / command dispatch
- Authoring outcome improved: refine, create (avoiding a class of wedge)
- In-scope reason: Documents a reference-metadata trust bug that would otherwise hang unattended runs.
- Out-of-scope risk: This is about dispatch safety, not a workbook XML shape.
- Tags: command-reference, blocking-dialog, dispatch-safety, unattended, misclassification
- Relevant user prompts/search terms: "edit parameter", "sort dialog", "filter dialog", "custom sql", "goto sheet", "why did it hang"

## When to Use

Before invoking any `tabdoc:`/`tabui:` command via `execute-tableau-command` on a session with no human present. If the command name matches the list below (or its source is a `*DialogCommand`), do NOT call it headlessly — it will block. Prefer the document round-trip verb (`author-*`) for the same outcome where one exists.

## Best Practices

- **Trust the command's SOURCE name over the reference's `opens_blocking_dialog` flag.** A `source_file` ending in `DialogCommand` opens a dialog regardless of what the flag says. The reference misclassifies 15 such commands as non-blocking.
- **Prefer an author-* verb for the same intent.** Parameters → `author-parameter` (reopen path); actions → `author-action`; sorts/filters/labels → the document round-trip. These never open a dialog.
- **If a run must probe a dialog command, do it only with a human at the screen** (probe discipline: no dialog-risk probes on an unattended screen).

## Common Mistakes

1. **Reading `opens_blocking_dialog: false` as "safe to call headlessly".** For the 15 below it is false-negative; the command blocks.
2. **Invoking `edit-existing-parameter` / `create-new-parameter` to author a parameter.** Both are `ParameterDialogCommand` — blocking. Use `author-parameter`.
3. **Calling `show-sort-dialog` / `edit-filter-dialog` to sort or filter headlessly.** Blocking dialogs; use the round-trip.

## Implementation

The 15 misclassified commands (source is a `*DialogCommand`, reference marks `opens_blocking_dialog: false` + `agent_can_invoke: true`):

```
tabdoc:launch-map-service-edit-dialog        (MapServiceEditDialogCommand)
tabdoc:show-goto-sheet-dialog                (GotoSheetDialogCommand)
tabui:show-feature-flag-dialog               (ShowFeatureFlagDialogCommand)
tabdoc:edit-filter-dialog                    (FilterDialogCommand)
tabdoc:launch-shared-filter-dialog           (FilterDialogCommand)
tabdoc:launch-map-services-dialog            (MapServicesDialogCommand)
tabdoc:get-button-config-dialog              (GetButtonConfigDialog)
tabui:launch-accelerator-data-mapper-dialog  (AcceleratorDataMapperDialogCommand)
tabdoc:launch-custom-sql-dialog              (CustomSqlDialogCommand)
tabdoc:launch-web-url-dialog                 (WebUrlDialogCommand)
tabdoc:show-action-list-dialog-for-dashboard (HybridActionsListDialogCommand)
tabdoc:show-action-list-dialog-for-worksheet (HybridActionsListDialogCommand)
tabdoc:show-sort-dialog                      (SortDialogCommand)
tabdoc:create-new-parameter                  (ParameterDialogCommand)
tabdoc:edit-existing-parameter               (ParameterDialogCommand)
```

Detection heuristic (for a future reference-generator fix): if `source_file` matches `/Dialog(Command)?/`, force `opens_blocking_dialog: true` and `agent_can_invoke: false`. The generator currently derives these flags from classification metadata that does not see the dialog-ness of the source class.

### What does NOT work

- Invoking any of the above headlessly (they block on `dlg.DoModal()` in the monolith; `create/edit-parameter` confirmed at `SchemaViewerUICommands.cpp` / `ParametersEdit.cpp`).
- Assuming the reference's dialog flag is authoritative — it is derived, not observed.

## Source and Confidence

- Source/evidence type: static analysis of the shipped command reference + live probe on Tableau Desktop (main.26.0715)
- Source: 2026-07-19 CODA — `edit-existing-parameter` live modal hang (receipt `coda-param-doors-20260719.jsonl`); the 15-command set derived by cross-referencing `source_file =~ /Dialog/` against `opens_blocking_dialog:false && agent_can_invoke:true` in `tableau-desktop-commands-reference.json`.
- Customer-identifying details removed: yes
- Confidence: one command (edit-existing-parameter) live-confirmed blocking; the other 14 share the same source-class signature (strong, not each live-probed)
- Last reviewed: 2026-07-19
