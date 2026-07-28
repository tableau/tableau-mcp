# Corpus-wide template placeholder generalization

## Decision

Use base-name placeholders in bindable field positions:

```text
{{field_base_1}}
{{field_base_2}}
...
```

The placeholder replaces only the base field token. Tableau structure remains authored in XML:

```text
[{{field_base_1}}]
[none:{{field_base_1}}:nk]
[sum:{{field_base_2}}:qk]
[{{DATASOURCE}}].[sum:{{field_base_2}}:qk]
SUM([{{field_base_2}}])
```

Whole-reference placeholders were rejected. They would duplicate derivation, role, datasource qualification, and compound table-calculation syntax in metadata, making the manifest a second XML dialect. Base-name placeholders let the existing structural rewriter continue to own all supported reference classes: base columns, column instances, compound derivations, calculated-field formulas and captions, computed sorts, style rules, filters, attributes, and text nodes.

`{{field_base_N}}` is template-local and positional. `slot_id` remains the stable routing/proposal API and is not renumbered or renamed. The manifest maps stable semantics to template-local syntax.

## Manifest contract

`SlotSpec` gains an optional `purpose` string during migration. A migrated template must provide a non-empty purpose for every bindable slot; the corpus lint enforces this. It remains optional in the runtime schema until the grandfather list reaches zero so unmigrated manifests continue to load.

The existing fields remain authoritative:

- `slot_id`: stable binding identity used by routing and proposals.
- `template_field`: the exact base placeholder in XML, such as `{{field_base_1}}`.
- `kind`: expected semantic data type (`quantitative` = continuous measure, `categorical` = categorical dimension, `temporal` = date/datetime dimension, `geo` = geographic dimension).
- `role`: structural use such as rows, cols, color, sort, filter, or calc input.
- `derivation`: Tableau aggregation/date-grain short form.
- `required`: coverage policy.
- `purpose`: human-readable reason the chart needs the field.

This extends the manifest rather than creating a sidecar or second metadata store. Calculation slots remain concrete template-internal names because they are authored artifacts, not donor dataset fields.

## Substitution flow

1. Binding resolves `slot_id` to a dataset field and emits mapping keys using `template_field`.
2. The inject core reserves `field_base_N` tokens from generic template-parameter substitution.
3. Mapping aliases keyed by stable `slot_id` are normalized to the manifest's `template_field`, including derivation-qualified keys.
4. Optional field pruning and facet/dateparse splices run while placeholders are still present.
5. The DOM rewriter maps the placeholder base name through every supported Tableau reference class and fills `{{DATASOURCE}}`.
6. The survivor guard checks manifest-declared slots using placeholder identities.
7. A final placeholder-residue scan rejects any `{{field_base_N}}` left in an attribute or text node.

The dateparse path converts its placeholder-named temporal column to a template-owned calculated field. Calc namespacing replaces the placeholder with an internal calculation name before final validation, so a parsed-string time axis cannot leak placeholder syntax.

## Guard adaptation

- Required-slot survivor scan: keys on `template_field`, which is now the placeholder token.
- Optional prune: removes references to the placeholder token before any mapped rename.
- Fail-loud datasource check: unchanged; required bindable slots still require a datasource.
- Facet splice: resolves the optional categorical facet through manifest slot metadata instead of the donor literal `Facet`.
- Formula/caption rewriting and computed sorts: unchanged structurally; their field token is now a placeholder.
- Final residue guard: catches undeclared, missed, or malformed migration paths even when no literal donor name is known.

## Pilot

### `ranking-ordered-bar` — clean rename

- `region` → `{{field_base_1}}`: ranked category.
- `sales` → `{{field_base_2}}`: bar length and sort measure.
- `facet_row` → `{{field_base_3}}`: optional row facet.
- Expected output is byte-stable after binding, apart from serializer-controlled workbook UUIDs.

### `deviation-diverging-bar` — data-hardcoded

- `sub_category`, `profit`, and `sales` become placeholders 1–3.
- Remove the source-only `Region='Central'` filter, its Region dependency/instance, and Filters-shelf slice.
- Do not parameterize `Central`: the binder has schema metadata but no member-value catalog, so selecting an arbitrary member would remain unsafe and dataset-specific.
- Remove `HARDCODED_FILTER_MEMBERS`; keep `render_verified: none` until live render verification.

### `trend-line-chart` — derivation/dateparse rich

- `order_date`, `sales`, and `facet_col` become placeholders 1–3.
- Preserve `tmn`/`Month-Trunc` in XML; the placeholder changes only the base token.
- The parsed-string path namespaces the placeholder-backed date calc to an internal calc name, leaving zero placeholder residue.
- Normal real-date binding remains byte-stable after substitution.

## Corpus lint and migration classes

The lint inventories all 47 XML templates. Migrated templates must have placeholder-backed bindable slots, non-empty purposes, no undeclared bindable base columns or formula inputs, and no placeholder residue after representative binding. Every other template must appear in one explicit grandfather set. The initial post-pilot grandfather count is 44 and must only decrease.

Migration classes:

1. **Clean rename:** replace bindable base tokens and manifest `template_field`; retain Tableau derivation/role syntax.
2. **Calculation/derivation rich:** also update formula refs, calc input metadata, table-calc ordering refs, style sidecars, and qualified-key groups.
3. **Data-hardcoded:** neutralize/remove donor member filters when they are incidental; add an explicit data-value parameter only when the chart's semantics require a caller-selected value and the caller can validate it.
4. **Raw orphan:** either author and validate a manifest before migration or deprecate/remove it from the searchable corpus. A raw XML file must not become implicitly routable.

## Remaining waves

### Wave 1 — simple clean renames (low effort, low risk)

`kpi-text`, `magnitude-simple-bar`, `ranking-ordered-column`, `ranking-dot-strip-plot`, `part-to-whole-pie-chart`, `part-to-whole-stacked-bar-chart`, `part-to-whole-treemap-chart`, `quota-attainment-bullet`, `funnel-chart`, `correlation-bubble-chart`, `correlation-dual-axis-chart`, `correlation-highlight-table`, `spatial-choropleth-map`, `spatial-symbol-map`, `spatial-symbol-map-latlon`.

Batch size: 4–6. Risk: optional geo LOD pruning, generated fields, pseudo fields, and stamped XML need output-equivalence evidence.

### Wave 2 — calculated/table-calc templates (medium effort, medium/high risk)

`box-plot-chart`, `bullet-variance-chart`, `change-over-time-area-chart`, `change-over-time-calendar-heatmap`, `change-over-time-stacked-area-chart`, `connected-scatterplot`, `control-chart-xmr`, `correlation-scatter-plot-chart`, `deviation-arrow`, `deviation-gain-loss-chart`, `gantt-chart`, `gantt-task-rollup-chart`, `gantt-timeline-chart`, `pareto-chart`, `part-to-whole-waterfall`, `slope-chart`, `ww-floating-bars`, `ww-ou-arrow`, `ww-ou-diff`.

Batch size: 2–3. Risk: calc dependency closure, compound derivations, table-calc ordering, parameters/pseudo fields, datasource-style sidecars, and source-shape assumptions. `ww-ou-*` also need explicit treatment of excluded years `1966`/`2025`; those values must not survive as donor data.

### Wave 3 — donor-data remediation (high effort, high risk)

- `distribution-histogram`: replace fixed bin width `283` with a validated numeric data parameter or keep deprecated/propose-only until a bin policy exists.
- `magnitude-paired-bar` and `magnitude-paired-column-chart`: remove fixed year exclusions `2024`/`2025`; derive comparison periods at bind/apply time or deprecate.
- `part-to-whole-proportional-stacked-bar`: replace the South/Central/East ordered domain with a caller-validated category-order parameter, or remove the manual order.
- `deviation-spine-chart`: deprecate until its missing datasource placeholder and Men/Women/Weighted Sample domain assumptions are replaced by explicit category-value parameters and a datasource-safe rewrite.
- `distribution-bar-code-chart`, `deviation-spine-chart`, and any blocker-marked formula templates receive calculation-specific review before eligibility changes.

Batch size: one template. Risk: data-value semantics cannot be inferred from schema-only metadata.

### Wave 4 — raw orphans (decision required before implementation)

- `ranking-bullet-chart`: recommend deprecation in place until a manifest is authored; it carries Machines/Paper/Phones/Storage/Supplies/Tables exclusions.
- `part-to-whole-waterfall-chart`: recommend manifest admission only if it is intentionally distinct from manifest-backed `part-to-whole-waterfall`; otherwise deprecate the duplicate raw artifact.
- `spatial-filled-map`: recommend deprecation in favor of manifest-backed `spatial-choropleth-map`, unless a distinct routing intent is documented and a geo manifest is authored.

Batch size: one. Risk: making an orphan searchable without a manifest bypasses semantic binding and guards.

## Hashes and render evidence

Both XML directories must remain byte mirrors. Regenerate `template-manifests.index.json` and `content-manifest.json` with `src/scripts/buildTemplateManifests.ts`.

Changing placeholder source bytes invalidates a raw-template `xml_sha256` stamp even when substituted output is byte-equivalent. The migration must not silently forge live evidence: either re-earn the live stamp or explicitly document why deterministic pre-Desktop output equivalence transfers the evidence and update the stamp policy first. Templates without fresh live evidence remain non-eligible.

## Risks and unknowns

- No member-value catalog exists, so semantically meaningful data-value placeholders cannot yet be validated against actual members.
- Live Tableau render verification is outside unit tests; source-hash stamps may need re-earning after migration.
- External callers that bypass manifest-backed explicit binding and address old donor keys directly have no stable compatibility contract; `slot_id` is the supported stable alias.
- XML formulas can contain string literals that resemble donor values. Lint can prove field-token generalization, but data-value portability still needs template-specific review.
