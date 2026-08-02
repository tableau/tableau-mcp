# PRD — Desktop template tool surface redesign

**Status:** proposed · **Owner:** Matthew Miller · **Last updated:** 2026-08-01 (added
optional-field handling modes + table-calc semantics)

A lightweight requirements doc for collapsing the current desktop template/binder tool
cluster into a small, verb-clear, agent-legible surface. Companion to
[`template-placeholder-generalization.md`](./template-placeholder-generalization.md) and the
`.tbm`-native inference work (`src/desktop/templates/`).

## Motivation

The template flow today exposes **seven** overlapping tools — `list-templates`,
`list-xml-templates`, `bind-template`, `propose-template`, `validate-proposal`,
`inject-template`, `build-and-apply-worksheet` — plus `plan-dashboard-creation`. Two of them
list, four are bind/inject variants of the same injection core, and the split between "bind"
and "inject" is an implementation detail (bind = inject + field-selection intelligence) that
leaks into the agent's decision space. Agents shouldn't have to learn that taxonomy.

Two design commitments drive the redesign:

1. **Metadata is augmentation, never a prerequisite.** A template dropped in as a `.tbm`
   bookmark with no hand-authored manifest must be fully discoverable, matchable, and
   applicable. When a curated manifest sidecar *does* exist, it enriches the response
   (verified purposes, `intent_keywords`, render stamps) — it does not gate anything. This is
   already the `resolveTemplateSlots` merge semantics (infer first, overlay curated
   field-by-field); the redesign routes every tool through it.
2. **Drop the word "bind."** The surface is described in terms of what the agent wants —
   *discover*, *recommend*, *build*, *apply* — not the internal binding machinery.

## Target surface: four layered tools

The tools form a stack. An agent can enter at any layer; higher layers delegate downward.

```
list-templates                 ← discover / search (read-only)
      │
show-me                        ← recommend by data shape (Show Me port)
      │  delegates to
build-worksheets-from-templates ← construct worksheets from columns + templates
      │  delegates to
upsert-worksheet               ← surgical insert/replace of one worksheet (apply)
```

Net agent-facing verbs replacing the old cluster:

| Old tool | Fate |
|----------|------|
| `list-templates` | **kept**, re-scoped (search + metadata-optional) |
| `list-xml-templates` | **removed** — folded into `list-templates` |
| `bind-template` | **removed** — role split into `show-me` + `build-worksheets-from-templates` |
| `propose-template` / `validate-proposal` | **removed** — proposal/dry-run folded into the above |
| `inject-template` | **removed** — mechanical fill becomes `build-worksheets-from-templates` |
| `build-and-apply-worksheet` | **removed / superseded** by `upsert-worksheet` |
| `plan-dashboard-creation` | out of scope for this PRD (dashboards); revisit separately |

---

### 1. `list-templates` — discovery & search

**Purpose (agent-facing):** *Use this when you're not sure what chart templates are available
or which one best fits your purpose.* Returns 0+ templates with enough information to decide
which (if any) to apply.

**Input**
- `query` (optional, string): a free-text search. When present, run **fuzzy / vector search**
  across, in priority order:
  - curated metadata (`intent_keywords`, `description`, `avoid_when`) when the sidecar exists;
  - the **bookmark title** (template name);
  - **concrete donor field captions** (from the `.tbm`'s `<column caption>` — the same source
    that already feeds slot `hint`s);
  - **semantic types** (slot `kind`: quantitative / categorical / temporal / geo …).
- `family` (optional, enum): existing family filter, retained.
- (No `query` → return the full catalog, as today.)

**Output** — per template:
- `template` (name), `description`
- `slots[]`: `slot_id`, `kind`, `role`, `required`, `purpose`, `hint?`, `derivation`,
  `ideal_cardinality?` (the current rich projection, preserved)
- `source` tier: `inferred` | `curated` | `render-verified`
- optional curated metadata when present: `intent_keywords`, `avoid_when`, `family`,
  `fast_path_eligible`, `calc_count`
- match score / matched-on fields when `query` was supplied

**Notes**
- Iterates `listTemplateNames()` (already lists `.tbm` **and** `.xml`) and resolves each
  through a new manifest-level resolver (`resolveTemplateManifest`, the full-manifest analog
  of `resolveTemplateSlots`). This is what surfaces `.tbm`-only templates with their inferred
  hints + required slots.
- Search backend TBD (see open questions) — start with a local fuzzy match over the fields
  above; a vector index over descriptions/captions is a possible upgrade.

---

### 2. `show-me` — recommend by data shape

**Purpose:** given the columns/column-instances an agent has in hand, recommend the charts
that best fit their **data shape** — a direct port of Tableau's Show Me.

**Source of truth:** `power-tools-workbook-cli/src/Tableau.ContentCli/Desktop/ShowMe/`
(extracted from the monolith). The C# is written for a 1:1 TypeScript port — pure functions
over a `ClassifiedFields` record:
- `ClassifiedFields.cs` — buckets caller fields into `ContinuousMeasures`,
  `ContinuousDimensions`, `Discrete`, `DatesConvertedToDiscrete`, `Latitude`, `Longitude`,
  `Spatial`, `DiscreteGeo`, `Tooltip` (+ `IsAggregated`, `IsHierarchicalDatasource`). Note the
  dedicated **`Tooltip` bucket** and `HasNonTooltipFields` gate — see §Slot-inference below.
- `ShowMeRule.cs` — one decision-table row: `CanApply(fields) → bool`, `Rating(fields) →
  double`, `UiPriority`.
- `ShowMeRules.cs` — the rule catalog (the 8×3 grid).
- `ShowMeAutoPicker.cs` — walks the grid, returns the winning viz + every tile's
  enabled/rating verdict. For "recommend N," take the **top-N enabled tiles by rating**
  instead of top-1.
- `ShowMeFieldClassifier.cs` — maps caller fields → `ClassifiedFields`.

**Input**
- `columns` / column-instances the agent wants to chart (see open question on input format).
- `count` (int): how many charts to recommend.
- `mode`: one of
  - **recommend** — return the matched template names + ratings/rationale only;
  - **buildAndReturn** — build the top-N matched worksheets and return their XML;
  - **buildAndApply** — auto-apply the top-N matched worksheets.

**Output (structured)** — depending on mode: the ranked matched-template list; or the built
worksheet XML(s); or the applied worksheets.

**Under-supply rule:** if fewer templates match the data shape than `count` requested, return
/ apply only that many (never pad with poor fits).

**Delegation:** in build/apply modes, `show-me` calls `build-worksheets-from-templates` with
the matched templates.

---

### 3. `build-worksheets-from-templates` — construct

**Purpose:** the deterministic constructor. Given a set of columns + column-instances (and the
template(s) to use), produce worksheets — either returned for the agent to refine, or applied
directly.

**Input**
- `columns` / column-instances to bind into the template slots.
- `count` (optional int): number of worksheets.
- **`mode` (mandatory):** `buildAndApply` | `buildAndReturn`.
- `insertAfter` (optional): **integer index** of a tab to insert after, **or** an existing
  **worksheet name** to insert after. On *any* error case — invalid index, unknown worksheet
  name, or omitted — default to inserting **at the end**, matching Desktop's own UI behavior.
- `optionalFieldHandling` (optional enum, default `remove`): how to dispose of any **optional
  slot the agent left unbound** — `remove` | `datasourceFieldPlaceholder` |
  `typeInCalcPlaceholder`. See §Optional-field handling for the semantics and the filter
  constraint (only `datasourceFieldPlaceholder` preserves filters).

**Output:** the built worksheet XML(s) (`buildAndReturn`), or the applied worksheets
(`buildAndApply`).

**Delegation:** calls `upsert-worksheet` per worksheet to do the actual insert/replace.

---

### 4. `upsert-worksheet` — surgical apply

**Purpose:** the single place that inserts or replaces one worksheet in the live workbook,
with validation. Used by both `show-me` and `build-worksheets-from-templates`.

**Input**
- worksheet XML to apply.
- `worksheetName` (optional): when it names an existing worksheet, **replace it in place**
  (and make the requisite updates elsewhere in the workbook — window/tab entries, references —
  plus validation). When absent (or not found), insert as new.

**Implementation**
- **For now:** use the **full-XML replace** path on the External Client API.
- **Pending:** an External Client API method to replace an *individual* worksheet in situ is
  planned; `upsert-worksheet` should be the seam that swaps to it when available, with no
  change to callers.

---

## Slot-inference refinement: LOD-preserving fields are optional slots

**Requirement.** A field that does **not change the level of detail (LOD) of the view or its
display** should be inferred as an **optional** slot, not a required one. Marking more slots
optional raises the chance a template is a "hit" for a given data shape (fewer hard
requirements to satisfy).

**Rule.** A field is **optional** only if removing it changes **neither the view's LOD nor its
display**. Both prongs must hold; the test is LOD/display impact, not shelf name.

- **Dimensions — LOD prong (aggregation).** An **aggregated** dimension (wrapped in
  `ATTR`/`MIN`/`MAX`/…) does not add rows to the view's LOD → LOD-neutral. A **disaggregated
  dimension** that partitions marks (rows/cols, or `detail`/`lod` at row level) **does** change
  LOD → **required**, always.
- **Measures — LOD prong is free.** A continuous measure never changes LOD, so it clears the
  LOD prong automatically. (This is why measures are the easy case.)
- **Display prong (both dims and measures).** A field is display-relevant — and therefore
  **required** — if it appears in **any** of: the **summary**, the **title**, a **filter**, the
  **tooltip**, a **marks encoding** (color/size/shape/angle/…), the **labels**, or the
  **rows/cols** shelves. A field is optional only if it is LOD-neutral **and** touches none of
  these.
- **Worked example (from `optional-fields.example.twb`).** `[Global Combo Company]` is an
  aggregated dimension (`attr:`) placed on `text`, `lod`, and `tooltip`, and referenced in the
  title/caption text. It is LOD-neutral (aggregated) but *display-relevant* (label + title), so
  it is optional-with-a-catch: safely omittable **only if** the omitted-slot handler rewrites
  its display uses (see §Optional-field handling below). A truly free case would be the same
  field used *only* in the tooltip.

**Why this supersedes the current heuristic.** Inference today marks a slot optional only when
its shelf is literally `tooltip` (`INCIDENTAL_SHELVES = {'tooltip'}` in `inferSlots.ts`). That
is a shallow proxy. The correct signal is LOD-neutrality via aggregation, which generalizes
across shelves and matches the monolith precedent below.

**Monolith precedent.** The extracted `ClassifiedFields` already carries a dedicated `Tooltip`
bucket and gates profile validity on `HasNonTooltipFields()` — i.e. Tableau's own Show Me
treats tooltip/LOD-neutral fields as *not chart-defining*. This inference rule is re-deriving a
distinction the product already ships.

---

## Optional-field handling: the agent chooses how omitted slots are dropped

When the agent applies a template but **declines to bind an optional slot**, the template must
not be left with a dangling `{{field_base_N}}` token, and — because an optional field can still
be *display-relevant* (title, label, tooltip, filter) — the injector must actively rewrite
every place the field was referenced. The build/apply tools therefore expose an
**`optionalFieldHandling`** choice, per apply, telling the injector *how* to dispose of any
optional slot the agent left unbound. Demonstrated concretely in
`optional-fields.example.twb` (worksheet `box-plot-chart (2)`).

### The three modes

| Mode | What the injector does | Filters | Later replaceable? |
|------|------------------------|---------|--------------------|
| **`remove`** | Strip every reference to the field — delete the encoding node, drop the field-reference `<run>` from title/caption, remove the filter + `<slices>` entry. The sheet renders as if the field was never there. | Filter dropped. | No — the slot is gone. |
| **`datasourceFieldPlaceholder`** | Substitute a **real datasource field** reference (a placeholder column that exists on the target ds) so the structure — including filters — stays intact and bindable. | **Filter preserved** (a filter can reference a real column). | Yes — rebind the placeholder column. |
| **`typeInCalcPlaceholder`** | Substitute a **string-literal calculated field** whose value is a human-readable placeholder, one calc per reference site. Keeps labels/tooltips/titles visually intact with a "fill me in" marker. | **Filter NOT supported** — a filter can't sit on a type-in calc; the filter is **dropped** unless the agent chose `datasourceFieldPlaceholder`. | Yes — find/replace the marker string. |

**It must be clear to the agent how these differ:** `remove` = the field vanishes;
`datasourceFieldPlaceholder` = swap in a live column (only mode that keeps filters);
`typeInCalcPlaceholder` = swap in static-text calcs so the layout survives with visible "fill
me in" markers, but filters using the field are dropped.

### The placeholder-string convention (dimension values)

For both placeholder modes, a **dimension** value uses a marker string of the shape
demonstrated in the example, so it is trivially find/replaceable later:

```
{{semantic field in plain English terms}}; original field [Global Combo Company]
```

- `{{…}}` carries a **plain-English semantic description** of what field belongs here (the slot
  `purpose`/`hint` is the natural source).
- `; original field [X]` records the donor's original field name for traceability.

### Demonstrated TWB XML (from `box-plot-chart (2)`)

**Type-in calc placeholder** — one string-literal calc column per reference site, referenced via
its aggregated column-instance (`attr:`), exactly as a dimension-on-a-mark would be:

```xml
<column caption='"{{semantic field in plain English terms}}; original field [G...'
        datatype='string' name='[Calculation_1110948630913025]' role='dimension' type='nominal'>
  <calculation class='tableau'
    formula='"{{semantic field in plain English terms}}; original field [Global Combo Company]"' />
</column>
<column-instance column='[Calculation_1110948630913025]' derivation='Attribute'
                 name='[attr:Calculation_1110948630913025:nk]' pivot='key' type='nominal' />
```

- The encoding node then points at the calc's CI instead of the original field:
  `<text column='[…].[attr:Calculation_1110948630913025:nk]' />`.
- **One calc per site.** The example emits three separate `Calculation_*` columns for the three
  uses (text, lod, tooltip) — each reference site gets its own calc so they can diverge later.

**Title / caption (static-text replacement).** The original title carries the field as an inline
`<run>` between `&lt;`/`&gt;` delimiters; the handler **deletes that field-reference run** and
replaces it with a plain static-text run carrying the same marker string:

```xml
<!-- before: three runs, the middle one a live field reference -->
<run>&lt;Sheet Name&gt;&#10;&lt;</run>
<run>[federated…].[attr:Global Combo Company:nk]</run>
<run>&gt;</run>
<!-- after: the field-reference run replaced with static text -->
<run>&lt;Sheet Name&gt;&#10;</run>
<run fontcolor='#000000'>{{semantic field in plain English terms}}; original field [Global Combo Company]</run>
```

This is the difference the user demonstrated between "edit the text to entirely replace the
field reference with static text" (title/caption) and "replace the field reference with a
type-in calculation consisting of static text" (encodings). Both leave the same marker string.

### Residue-guard reconciliation (decision needed — see open questions)

The placeholder marker uses `{{…}}` braces, which **collides with the plan's §5 any-`{{…}}`
residue scan** and the unresolved-slot guard. Those guards must be scoped to reject only
**unfilled slot tokens** (`{{field_base_N}}`, `{{DATASOURCE}}`, `{{TITLE}}`, and registered
placeholders) while **allowing** an intentional optional-field marker the handler deliberately
emitted. Recommended: the guard keys on the strict slot-token grammar (`{{field_base_\d+}}`
etc.), and the optional-field marker is recognized by its `; original field [X]` suffix (or a
dedicated sentinel) and whitelisted. This must be resolved before shipping either placeholder
mode, or a correct apply will fail its own residue check.

---

## Table-calc semantics: relative vs absolute addressing decides mandatory dimensions

Table calcs must be represented in the semantic templatization logic — e.g. *"running sum of
[measure] by [addressing dimension] for each [partition dimension]."* Whether a table calc's
dependent dimensions are **mandatory** turns on its **addressing (Compute Using)**, read from
the `<table-calc>` element (see `resources/desktop/knowledge/tactics/data/table-calcs.md`):

- **Relative addressing → dependent dimensions NOT mandatory.** Positional `ordering-type`
  values (`Rows`, `Columns`, `Table`, `TableCol`, `RowInPane`, `ColumnInPane`, `Pane`,
  `PaneCol`, `CellInPane`) walk *whatever marks are in the view* and name no specific dimension.
  The calc adapts to whatever dimensions the agent binds — so its partition/addressing fields
  stay **optional**. Represent it as *"running sum along the table"* (direction only).
- **Absolute addressing → dependent dimensions ARE mandatory.** `ordering-type="Field"` with
  `ordering-field="[ds].[field]"` (Specific Dimension), plus `level-break` (YTD),
  `level-address` (YoY), and the nested-calc `field="[ds].[…]"` attributes, **name concrete
  dimensions**. Those named dimensions are load-bearing: the agent must provide replacements so
  we can rewrite the reference. Represent it as *"running sum of [measure] by [dimension 1] for
  each [dimension 2]"* and mark those dimension slots **required**.

**Inference gap to close.** `inferSlots.ts` deliberately does **not** tokenize inside
`table-calc@ordering-field` (§1 finding: bracketed values there are not field references for the
*datasource*-name rewrite). But for an **absolute** table calc, the dimension named in
`ordering-field`/`level-break`/`level-address`/`field=` must be surfaced as a (required) slot
**and** rewritten on bind. This is a distinct pass from the datasource-name protection: skip it
for the `{{DATASOURCE}}` substitution, but *do* emit a required slot + rewrite it for
field-binding. Quick table calcs keep their base measure's aggregation derivation and add
`<table-calc>` children to the CI (never `derivation="User"`); the base measure is the primary
slot and the addressing dimension(s) are the extra required slots when addressing is absolute.

## Cross-cutting: metadata-optional resolver

All four tools sit on one resolver so the "augment if present, else still work" property holds
uniformly:

- **`resolveTemplateSlots(name)`** (exists) → merged `TemplateSlotReference[]` + `source` tier.
- **`resolveTemplateManifest(name)`** (new) → a full merged `TemplateManifest` (infer via
  `synthesizeManifest`, overlay curated field-by-field reusing `mergeSlots`), for the paths
  that need a manifest (the Show Me matcher, the constructor).
- **`resolveAllTemplateManifests()`** (new) → `Map<name, TemplateManifest>` over
  `listTemplateNames()`, replacing every `bundledIntelligenceProvider.listTemplateManifests()`
  call site (which is blind to `.tbm`-only templates).

## Open questions / decisions needed

1. **`show-me` vs `build-worksheets-from-templates` boundary.** This PRD models `show-me` as
   the recommender that delegates materialization to `build-worksheets-from-templates`. Both
   can "build/apply N worksheets from columns," so confirm the split is: `show-me` decides
   *which* templates (data-shape match + rank); `build-worksheets-from-templates` decides
   *how* to construct given templates. Confirm or collapse.
2. **Column / column-instance input format.** What exactly does the agent pass — datasource-
   qualified column refs, column-instances with derivation prefixes (`[sum:Sales:qk]`), or a
   lighter shape the tool resolves? Show Me's classifier needs enough to bucket into O/Q +
   geo + aggregation state.
3. **Search backend for `list-templates`.** Local fuzzy match to start; is a vector index over
   descriptions/captions in scope now, or a later upgrade? What embedding/store, if any?
4. ~~**Static-placeholder TWB XML** for excluded optional slots~~ — **RESOLVED.** Demonstrated
   in `optional-fields.example.twb` (`box-plot-chart (2)`) and captured in §Optional-field
   handling above (three modes; the `{{…}}; original field [X]` marker convention; type-in-calc
   and static-text-run XML shapes).
5. **Residue-guard vs optional-field marker collision (NEW, must resolve before shipping the
   placeholder modes).** The `{{…}}` marker trips the any-`{{…}}` residue scan. Scope the guard
   to strict slot-token grammar and whitelist the intentional marker (recommended: recognize the
   `; original field [X]` suffix). See §Optional-field handling → Residue-guard reconciliation.
6. **`plan-dashboard-creation` and dashboard flows** — out of scope here; they currently call
   into the removed cluster and will need a follow-up.

## References

- Show Me port: `power-tools-workbook-cli/src/Tableau.ContentCli/Desktop/ShowMe/`
  (`ClassifiedFields.cs`, `ShowMeRule.cs`, `ShowMeRules.cs`, `ShowMeAutoPicker.cs`,
  `ShowMeFieldClassifier.cs`) + tests `ShowMeFieldClassifierTests.cs`,
  `ShowMeAutoPickerTests.cs`.
- Metadata-optional merge: `src/desktop/templates/templateSlots.ts`
  (`resolveTemplateSlots`, `mergeSlots`, `overlaySpec`).
- Inference + current optional heuristic: `src/desktop/templates/inferSlots.ts`
  (`INCIDENTAL_SHELVES`, `hasAxisPlacement`, `synthesizeManifest`).
- Injection core (shared by all build/apply paths): `src/desktop/templates/injectTemplateCore.ts`
  (`buildInjectedWorkbookXml`).
- Template listing / `.tbm` reading: `src/desktop/templates/templatePath.ts`.
- Optional-field handling demonstration: `optional-fields.example.twb`, worksheet
  `box-plot-chart (2)` (static-text title replacement + three type-in-calc placeholder columns;
  filter left on the real field). Snapshots: `scripts/local/optional-fields-after.twb`,
  extracts `scripts/local/ws-box_plot_chart.xml` / `ws-box_plot_chart__2_.xml`.
- Table-calc XML + Compute Using semantics:
  `resources/desktop/knowledge/tactics/data/table-calcs.md` (relative vs `Field`/`level-break`
  addressing),
  `resources/desktop/knowledge/tactics/data/rolling-period-and-prior-value-table-calcs.md`
  (addressing is load-bearing; positional vs anchored windows).
