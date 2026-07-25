# Cross-Sheet Filter Authoring in Workbook XML

Enforced-by: categorical-filter-slices

Use this when one Tableau filter control needs to affect multiple worksheets, especially dashboard-wide filters that must survive workbook XML round-trip. This entry covers scope and propagation. For the base filter syntax, use `expertise://tableau/tactics/viz/filters`.

## Scope Check

- Primary audience: Tableau agent / SE authoring XML
- Authoring outcome improved: create, troubleshoot
- In-scope reason: Cross-sheet filters require the same worksheet filter shape on every target sheet, shared `filter-group` values, correct `slices`, and valid `user:` namespace handling.
- Out-of-scope risk: none
- Tags: cross-sheet-filter, dashboard-wide-filter, filter-group, shared-filter, datasource-scoped-filter, global-filter, user-namespace, slices, column-instance, groupfilter
- Relevant user prompts/search terms: "filter apply to all worksheets", "Region controls all dashboard charts", "shared filter across sheets", "dashboard-wide filter", "datasource scoped filter", "global filter in workbook XML", "filter-group integer synchronize worksheets", "xmlns:user namespace binding categorical filter", "filter disappears after round-trip missing slices"

## When to Use

Use this guidance when a Tableau authoring task asks for a filter to apply across more than one worksheet: "make Region filter every dashboard chart", "apply this Top N filter to all sheets", or "one filter control should scope all views."

This entry exists because ordinary worksheet filters are local. A per-worksheet `<filter>` under one worksheet's `<view>` affects that worksheet. To make multiple worksheets respond, the confirmed workbook-XML pattern is to put equivalent filters on every target worksheet, all pointing at the same shared datasource field and carrying the same `filter-group` integer. `expertise://tableau/tactics/viz/filters` already covers the filter node syntax; this entry covers the multi-sheet scope decision.

## Best Practices

1. **Prefer the confirmed per-worksheet pattern.** Add the filter, field dependency, column-instance, and `slices` entry to every worksheet that should respond, then reuse the same `filter-group` integer across those worksheets.
2. **Use a shared datasource field.** Cross-sheet synchronization assumes each target sheet can resolve the same datasource/field reference. If sheets use different datasources, treat that as a data-modeling or blend-propagation problem, not a simple shared filter.
3. **Use column-instance (CI) format for `filter column`.** `expertise://tableau/tactics/viz/filters` corrects the format: categorical filter `column` uses forms like `[Sample - Superstore].[none:Region:nk]`, not `[Sample - Superstore].[[Region]]`.
4. **Keep `groupfilter level` unqualified.** The nested `level` uses the CI without datasource prefix, for example `[none:Region:nk]`.
5. **Preserve `user:` attributes and namespace binding.** Categorical enumerate filters use `user:ui-marker`, `user:ui-enumeration`, and related attributes. When serializing XML yourself, register or preserve `xmlns:user="http://www.tableausoftware.com/xml/user"` so those attributes are emitted as `user:*`, not Clark notation.
6. **Be conservative with datasource-scoped/global filters.** This repo has no confirmed local `group-filter` or datasource-level filter example. If a fresh Desktop-authored workbook contains a datasource-level `<group-filter>` or equivalent global filter construct, copy it exactly and verify by readback. Do not invent that shape from memory. <!-- TODO-VERIFY-LIVE -->
7. **Verify after apply.** Re-read the workbook or target worksheets and confirm each target sheet still has the `<filter>` and matching `<slices>` entry.

## Common Mistakes

1. **Only adding the filter to one worksheet.** A worksheet filter is local unless the target worksheets also carry synchronized filter metadata.
2. **Putting the filter only in dashboard XML.** Dashboard zones display sheets; they do not by themselves define worksheet filter logic.
3. **Using double-bracket field form.** `[DS].[[Region]]` is not the confirmed filter-column format in `expertise://tableau/tactics/viz/filters`; use `[DS].[none:Region:nk]` or the appropriate CI.
4. **Using different `filter-group` integers.** Filters synchronize only when the matching filters use the same integer.
5. **Omitting `slices`.** The repo's validation warns when a categorical filter lacks a matching `slices` column. Whether Tableau strips every missing-slice case is still listed as an unverified live probe in `expertise://tableau/tactics/viz/filters`, so include `slices` and do not rely on the warning-only path.
6. **Assuming a datasource-scoped filter crosses blends.** Blend filters remain source-scoped unless the relevant linking fields are active; see the blend filter propagation entry.

## Implementation

### Confirmed per-worksheet shared filter shape

This shape extends the `expertise://tableau/tactics/viz/filters` cross-sheet rule: identical `filter-group` values on equivalent filters across worksheets synchronize them. The same view fragment should appear in each target worksheet, adjusted only for existing sheet content.

```xml
<view>
  <datasources>
    <datasource name="Sample - Superstore" caption="Sample - Superstore" />
  </datasources>
  <datasource-dependencies datasource="Sample - Superstore">
    <column name="[Region]" role="dimension" type="nominal" datatype="string" />
    <column-instance name="[none:Region:nk]" column="[Region]" derivation="None" pivot="key" type="nominal" />
  </datasource-dependencies>
  <filter column="[Sample - Superstore].[none:Region:nk]"
          class="categorical"
          filter-group="7">
    <groupfilter user:ui-marker="enumerate"
                 user:ui-enumeration="all"
                 function="level-members"
                 level="[none:Region:nk]" />
  </filter>
  <slices>
    <column>[Sample - Superstore].[none:Region:nk]</column>
  </slices>
  <aggregation value="true" />
</view>
```

Repeat the same filter structure in every worksheet that should respond, keeping `filter-group="7"` and the slice column consistent. Choose a group id that is not already used by unrelated filters in those worksheets.

If applying worksheet XML directly and `user:` attributes appear anywhere in the fragment, submit a root with a namespace binding:

```xml
<worksheet name="Sales by Region"
           xmlns:user="http://www.tableausoftware.com/xml/user">
  <!-- table/view/filter omitted -->
</worksheet>
```

### Datasource-scoped/global filter path

The episode-mining gap mentions datasource-scoped filters using a datasource-level `<group-filter>`/filter construct. This repo does not contain a confirmed example of that XML shape. <!-- TODO-VERIFY-LIVE -->

Conservative handling:

1. If the user needs "apply to all worksheets" and all target worksheets share one datasource, author the confirmed duplicated per-worksheet `filter-group` pattern first.
2. If the workbook already contains a Desktop-authored datasource-scoped filter, preserve and clone that exact structure only after a fresh readback.
3. If you cannot find a real datasource-scoped filter in the workbook, do not fabricate one. Ask the user to create it in Tableau Desktop, then read back the XML, or use the per-worksheet pattern.

What does **not** work:

```xml
<!-- Dashboard-only or single-sheet-only filter does not define cross-sheet scope. -->
<filter column="[Sample - Superstore].[none:Region:nk]" class="categorical">
  <groupfilter function="level-members" level="[none:Region:nk]" />
</filter>
```

That omits the shared `filter-group`, omits `slices`, and only affects the sheet where it is placed. It may be a valid local filter scaffold, but it is not a cross-sheet filter.

## Related Knowledge

- `expertise://tableau/tactics/viz/filters` — the confirmed filter syntax, `filter-group`, and `slices` rules this entry builds cross-sheet scope on top of.
- `expertise://tableau/tactics/data/blend-filter-propagation` — why a shared filter does not automatically propagate across blended datasources.
- `expertise://tableau/tactics/workflow/python-helpers` — namespace registration guidance for `user:` attributes.

## Source and Confidence

- Source/evidence type: repo evidence plus pilot episode mining
- Source: `expertise://tableau/tactics/viz/filters` cross-sheet `filter-group` guidance and filter column-format audit; `expertise://tableau/tactics/workflow/python-helpers` namespace guidance; `expertise://tableau/tactics/data/blend-filter-propagation`; June 2026 interaction-learning episode reporting failed cross-sheet/datasource-scoped filter authoring.
- Customer-identifying details removed: yes
- Confidence: needs review
- Last reviewed: 2026-07-12
