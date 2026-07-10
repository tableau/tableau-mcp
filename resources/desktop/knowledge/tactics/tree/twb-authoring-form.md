# TWB Authoring Form: Version, Manifest & the Construction Playbook

How to generate a `.twb` that actually opens in Tableau: choosing the version/manifest form, wiring the datasource so fields aren't silently stripped, and decoding the cryptic load-error codes.

The single most load-bearing reference for hand-authoring workbook XML.

## Scope Check

- Primary audience: Tableau user
- Authoring outcome improved: create, validate, troubleshoot
- In-scope reason: The difference between a `.twb` that opens with all fields/sheets intact and one that fails to load or silently drops fields — version-form choice, the datasource linkage rule, and the error-code→fix table when an apply fails.
- Out-of-scope risk: none (REST publish errors 406/403132 omitted as Cloud/Server, not Desktop authoring)
- Tags: twb, twbx, version, manifest, manifestbyversion, document-format-change-manifest, datasource, column-instance, error-codes, won-t-open, repository-location
- Relevant user prompts/search terms: "workbook won't open", "fields stripped on load", "internal error 2805CF18", "501CF476", "what version should the workbook be", "ManifestByVersion", "version 18.1 vs 26.1", "build a twb from scratch", "fields not available in the datasource", "filter dropped invalid", "colors showing default not my hex"

## When to Use

Use this when hand-authoring or heavily editing workbook XML and you need it to open cleanly — choosing `version=`/manifest form, wiring a datasource, or debugging a "won't open" / silent-field-strip / cryptic-internal-error failure after a `tableau-apply-workbook`. For the on-disk tree shape see [Tableau Workbook File Structure](data/knowledge/strategy/data-modeling/workbook-anatomy.md); for the column-instance `[deriv:field:resulttype]` casing and nk/ok/qk enums see `expertise://tableau/tactics/tree/enums`; for calc-field authoring see [Calculated Fields, Parameters & Table Calculations](data/knowledge/strategy/analytics/calc-fields-strategy.md); for dashboard zones see `expertise://tableau/tactics/dashboard/zones`.

## Best Practices

### Version: what the number means

The `<workbook version=…>` / `original-version` attribute is the **file-format base, not the product release**. Real Desktop-saved files almost always carry **`version='18.1'`** — the base of the post-2018.1 format system. **`18.1` is not "old," and you must not blindly "upgrade" it.** The real "version" of a document is its **manifest**: the `<document-format-change-manifest>` list of format-change feature names the document actually uses, checked at load against the build's capabilities. If a manifest name isn't in the program's capabilities, the file won't load. (`version='18.1'` ≠ Tableau 2018.1 — the build is in `source-build`.)

> *Verify by opening (Desktop 2026.2):* the version/manifest mechanics in this section are adapted from the source plugin (which traces them to the Tableau File Format team) but have **not** been re-confirmed against a Desktop save in this repo. Before relying on them — especially the `18.1`-vs-`26.1` save behavior — save a file from your target Desktop build and inspect its `version`/manifest. Treat the specifics as strong leads, not settled fact, until opened.

### Two valid authoring forms — pick deliberately

| | **Modern (recommended for fresh/agent-authored)** | **Classic (to match/round-trip a real file)** |
|---|---|---|
| `version` / `original-version` | `26.1` | `18.1` |
| manifest body | `<ManifestByVersion />` (or omit the manifest entirely — see below) | explicit list of the format-change names actually used |
| when to use | generating fresh workbooks; simplest to get right | matching a specific Desktop build or round-tripping an existing file — copy its exact `version` + manifest from a known-good same-build file, don't invent it |

`<ManifestByVersion/>` is shorthand that, at load, is understood to resolve the **frozen capability set for the targeted shipped version** (26.1, 26.2 — not the dev "current") and expand it to the full feature-flag list, so you don't hand-write the manifest. It must live **inside** `<document-format-change-manifest>`. *(This expansion mechanism is from the source plugin's read of the product source — verify by opening before treating the exact behavior as settled.)*

**Product-blessed simplest form:** Tableau's own canonical test fixture (`minimal.twb`, v26.1, opens in product) uses `version='26.1'` with **no manifest and no `<ManifestByVersion/>` at all** — just the version attribute, columns, and an empty `<worksheets/>`. So version-attribute-only is valid for fresh authoring; `<ManifestByVersion/>` is a useful optional mechanism, not a requirement. Emit **plain, undecorated** element names — never copy the `_.fcp.*` feature-fork decorations seen in 18.1 files (those are written/read by an automated downgrade process, not hand-authored).

### The skeleton (modern 26.1)

```xml
<?xml version='1.0' encoding='utf-8' ?>
<workbook original-version='26.1' version='26.1'
  xmlns:user='http://www.tableausoftware.com/xml/user'>
  <document-format-change-manifest>
    <ManifestByVersion />
  </document-format-change-manifest>
  <!-- repository-location: include ONLY when authoring for Cloud/Server publishing (omit for a purely-local Desktop workbook) -->
  <repository-location id='WORKBOOK_ID' path='/t/SITE/workbooks' revision='1.0' site='SITE' />
  <preferences />
  <datasources> ... </datasources>
  <worksheets> ... </worksheets>
  <dashboards> ... </dashboards>
  <windows> ... </windows>
</workbook>
```

Top-level child **order is enforced** by the XSD sequence: `document-format-change-manifest → repository-location? → preferences? → … → datasources → … → worksheets → dashboards? → windows? → …`.

### The load-bearing rules

- **`<repository-location>` is publish-only.** It's needed on the workbook AND every worksheet AND dashboard *when authoring for Cloud/Server publishing* — missing it there is a "won't open" cause (error **501CF476**). For a purely-local Desktop workbook, **omit it** (don't hardcode a `/t/SITE/...` server path you don't have). This is also why the authoring skill's invariant says not to fabricate connection/repository-location values.
- **The datasource needs five linked pieces that must agree:** the `<connection>`/`<relation>`, the `<metadata-records>`, the field `<column>`s, the `<object-graph>`, and (per sheet) the `<datasource-dependencies>`. An ID mismatch among them is the most common cause of **silent field stripping** ("fields are used in the workbook but are not available in the datasource"). The `<object-id>` in each metadata-record must equal the `<object-graph>` object `id`, and the `[__tableau_internal_object_id__].[_OBJECT_ID]` table-type column links the object to the datasource.
- **Declare every pill in `<datasource-dependencies>`.** Every field referenced in `<rows>`, `<cols>`, an `<encodings>` child, a `<filter>`, a sort, or a label must appear as both a `<column>` (the field) and a `<column-instance>` (the specific pill). Omit it and Tableau strips the field on load.
- **Column-instance naming `[deriv:field:resulttype]`:** the name-token derivation is **lowercase** (`none`, `sum`, `avg`, `ctd`, `yr`…) but the `derivation=` **attribute is capitalized** (`None`, `Sum`, `Avg`, `CountD`, `Year`…). Both are required and both checked — e.g. `name='[sum:Sales:qk]'` carries `derivation='Sum'`. Result type: `nk` nominal, `ok` ordinal/date, `qk` quantitative.
- **`<mark>` uses `class`, never `type`.** `<mark class='Bar'/>` is the shipped form; `type=` only exists behind a test-only feature flag. A "`<mark> missing required attribute 'type'`" error means you validated against the wrong branch.
- **Two `<encoding>` forms — don't confuse them.** Mark encodings inside a `<pane>` use element-named children with `column=`: `<color column='[ds].[pill]'/>`. The `<encoding attr='color' field='…'/>` form is a *different* element used only inside `<style-rule>` for palette/axis formatting. Tableau's `marks_encodings_basic.twb` test fixture uses the `attr/field` form inside `<pane>` because it feeds a lenient indexer — do not copy that into a real worksheet.
- **Dashboard zones** live in a 0–100000 coordinate space; outermost `type-v2='layout-basic'`, containers `type-v2='layout-flow'` + `param='horz'|'vert'`, leaf zones carry `name=` only. `<zone-style>` comes *after* nested child zones. Full rules and the three production-observed assertions are in `expertise://tableau/tactics/dashboard/zones` — read it before hand-crafting dashboard XML.
- **Windows:** a worksheet `<window>` needs `<cards>`; a dashboard `<window>` needs a **non-empty** `<viewpoints>` listing every contained sheet, then `<active id='-1'/>`. An *empty* `<viewpoints/>` is the fatal, line-less `2805CF18` Internal Error. Put `<zoom type='entire-view'/>` on each viewpoint or a faceted Text/BAN sheet can clip to one glyph. Window identity is unique across worksheet *and* dashboard names — don't name a dashboard the same as a sheet it contains.

### Validate, diff, open — the gate

1. **Well-formedness check (NOT structural):** the MCP `tableau-validate-workbook-xml` / `tableau-validate-worksheet-xml` tools check only that the XML is **well-formed (parseable)** — typos, unclosed tags, bad nesting. Their own description says "This does NOT validate against XSD schema." So a PASS means "parses," **not** "structurally valid" and **not** "Tableau will open it." Catching child-order/required-attr/enum mistakes is the job of the **diff-against-a-known-good real file** (step 2), and the final proof is opening it (step 3). *(Separately, the plugin's dev script `twb-validate.py` does run real XSD validation against the bundled schema — but that XSD is itself over-strict (rejects Tableau's own `minimal.twb`) and under-strict (blind to the load-time manifest/capabilities gate and `processContents="skip"` islands), so even it is a lint, not a gate.)*
2. **Diff against a known-good same-version real `.twb`** to surface any tag/attribute/enum/order yours uses that a file that *opens* never does — stronger than the lint for catching "won't open" bugs.
3. **The only proof is opening the workbook in Tableau** with all sheets/fields intact (apply via `tableau-apply-workbook(mode=file)`). Where the XSD and a real same-version file disagree, trust the real file.

**Bisect a line-less Internal Error.** A `2805CF18`/generic error with no line number can't be localized by reading XML. Start from a minimal file that opens (1 connection + 1 bar) and add one construct per probe — color map → dashboard → calc → filter — re-applying at each step. The step that breaks is the cause.

### Error reference

| Error / symptom | Root cause | Fix |
|---|---|---|
| **2805CF18** Internal Error, **no line number** | empty `<viewpoints/>` on a dashboard window (and similar line-less load failures) | viewpoints must list every sheet; when there's no line number, **bisect** — don't read XML |
| **501CF476** Internal Error on open *(publishing only)* | missing `<repository-location>` on workbook/worksheet/dashboard when publishing to Cloud/Server | add it to all three (publish path only; omit for local Desktop) |
| **D2E8DA72** DTD: `angle` | `<angle>` is not a valid encoding | use `<wedge-size>` for pie |
| **D2E8DA72** DTD: zone `type` | legacy `layout-vertical/horizontal/view` | use `type-v2='layout-basic'` / `'layout-flow' param=…`; leaf zones name-only |
| **D2E8DA72** DTD: window content model | `<simple-id>` without required preceding elements | worksheet→`<cards>`; dashboard→`<viewpoints>`/`<active id='-1'>` |
| "no declaration found for element 'computed-sort'" | `<computed-sort>` used without the `SortTagCleanup` manifest flag | add `<SortTagCleanup/>` to the manifest, or use the legacy `<sort>` form |
| "windows declares duplicate identity constraint" | a worksheet and a dashboard share a `name` | name dashboards distinctly from their sheets |
| Sheet renders tiny / clipped / packed top-left | viewpoint missing `<zoom type='entire-view'/>` | add it to every dashboard viewpoint |
| "The filter on X is invalid" (warning, filter dropped) | `<groupfilter level=>` uses the base column, not the column-instance | `level='[none:X:nk]'` matching the filter's `column=` |
| Colors render as Tableau defaults, not your hex | mapped column-instance not declared at **datasource scope**, or `palette=` present on the `<encoding>` | declare the `<column-instance>` at datasource scope; drop `palette=` |
| Fields stripped silently ("will be removed") | missing `<column-instance>` in deps, OR empty `<object-graph>` / missing table-type column | declare `<column>`+`<column-instance>` per pill; use a real object-graph + the table-type column |
| Malformed expression | space-separated measures on a shelf | join with `+` in parens: `([ds].[sum:a:qk] + [ds].[sum:b:qk])` |

## Common Mistakes

- Treating `version='18.1'` as old and "upgrading" it — it's the format base, the norm in real files.
- Copying 18.1 idioms into fresh 26.1 authoring: `_.fcp.*` feature-fork decorations, `type=` zones, dual-written relations, `<layout dim-percentage>` (26.1 uses the `-v2` percentage forms and requires `dim-ordering`/`measure-ordering`/`show-structure` if `<layout>` is present).
- Emitting `<mark type=>` or `<worksheet number=>` or `default-aggregation` on `<column>` — all test-only/wrong branches; the product writes `<mark class=>`, plain `<worksheet name=>`, and aggregation on the per-pill column-instance.
- Trusting an XSD PASS as proof the file opens, or treating a FAIL as proof it won't — validate, diff against a real file, then open.
- Copying the `<encoding attr='color' field=>` form from a test fixture into a real `<pane>` instead of `<color column=>`.

## Implementation

For fresh authoring, start from a known-good same-version `.twb`, not from memory. Emit the modern form (`version='26.1'` + `<ManifestByVersion/>`, or version-attribute-only), plain undecorated element names, correct child order. Wire the five datasource pieces with matching IDs; declare every pill (including filters) as `<column>` + `<column-instance>`; add `<simple-id>` UUIDs (and `<repository-location>` only if publishing to Cloud/Server). Then run the MCP validate tools to catch **well-formedness** errors only (typos/unclosed tags — they do NOT check structure), diff against a known-good real file for the structural drift (child-order/required-attr/enum) that actually causes "won't open," and apply via `tableau-apply-workbook(mode=file)` and open to confirm all sheets/fields survive. When a load fails with a line-less error, bisect rather than reading XML.

## Related Knowledge

- Extends [Tableau Workbook File Structure](data/knowledge/strategy/data-modeling/workbook-anatomy.md): that documents the tree and the "do not modify the manifest" caution; this explains what the manifest/version *means* and which authoring form to emit.
- Pairs with `expertise://tableau/tactics/tree/enums` for the column-instance `derivation` casing (e.g. `ctd`→`CountD`, `yr`→`Year`) and the nk/ok/qk result-type tokens, and with [Field & Mark Type Reference](data/knowledge/strategy/analytics/field-types-reference.md) for field roles, data types, and mark types.
- Relates to [Calculation Authoring Best Practices](data/knowledge/strategy/analytics/calc-authoring-best-practices.md) (the 26.1 datasource `<layout>` `-v2` correction) and [Troubleshooting Common Tableau Issues](data/knowledge/strategy/workflow/troubleshooting-workbooks.md) (recovery after a failed apply).

## Source and Confidence

- Source/evidence type: published documentation
- Source: Adapted with permission from plugin-tableau-master (Jon Plax); underlying facts trace to Tableau file-format docs + the Apache-2.0 tableau-document-schemas XSD
- Customer-identifying details removed: yes
- Confidence: draft
- Last reviewed: 2026-07-03

## Runtime Classification

- Knowledge type: authoring-expertise
- Runtime visibility: server-side-only
- Version binding: Desktop/Studio version (26.1 / 26.2 format era)
- Customer customization allowed: no
- Tool/API dependency: `tableau-validate-workbook-xml`, `tableau-validate-worksheet-xml`, `tableau-apply-workbook`
- Eval candidate: yes
- Eval coverage: none
- Promotion target: system-instructions
