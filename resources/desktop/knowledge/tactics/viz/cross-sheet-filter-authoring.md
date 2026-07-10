# Cross-Sheet Filter Authoring in Workbook XML

Enforced-by: categorical-filter-slices

Use this when an agent needs one filter control to affect multiple worksheets, especially in dashboards where a data-source-scoped filter must survive workbook-level apply.

## Scope Check


- Primary audience: Tableau agent / SE authoring XML
- Authoring outcome improved: create, troubleshoot
- In-scope reason: Cross-sheet filters require correct filter-group synchronization, slices nodes, and namespace handling, all essential for dashboard-wide filter controls that survive round-trip.
- Out-of-scope risk: none
- Tags: cross-sheet-filter, dashboard-wide-filter, filter-group, categorical-filter-slices, shared-filter, user-namespace, filter-column-format, column-instance-slices, groupfilter-level-members
- Relevant user prompts/search terms: "filter apply to all worksheets", "Region controls all dashboard charts", "shared filter across sheets", "filter disappears after round-trip missing slices", "user:ui-marker enumerate user:ui-enumeration all", "filter column double-bracket raw field form", "filter-group integer synchronize worksheets", "xmlns:user namespace binding categorical filter"

## When to Use

Use this guidance when a Tableau authoring task asks for a dashboard-wide or cross-sheet filter such as "Region controls all charts", "make this filter apply to all worksheets", or "share this Top N / categorical filter across dashboard sheets."

This is narrower than ordinary worksheet filtering. For a single worksheet, use `tactics/viz/filters.md`. For cross-sheet filters, author every target worksheet consistently: the same field dependency, the same `filter-group`, and the same `slices` entry must appear in each target sheet's `view`.

## Best Practices

- **Author per worksheet, then use a shared `filter-group`.** Do not rely on the dashboard node alone; each responding worksheet needs its own filter node.
- **Preserve the `user:` namespace on filter attributes.** Categorical enumerate filters use attributes such as `user:ui-marker` and `user:ui-enumeration`; if a worksheet fragment uses those attributes, the root XML submitted to Tableau must bind `xmlns:user`.
- **Always include `<slices>`.** Missing slices are the common reason a categorical filter appears in the proposed XML but disappears after Tableau round-trips the workbook.
- **Use both column formats in the right places.** `filter column` uses the raw/double-bracket field form (`[DS].[[Region]]`) for many categorical filters; nested `groupfilter level` and `slices` often use the column-instance form (`[DS].[none:Region:nk]`).
- **Verify after apply.** Re-read the workbook or target worksheet and confirm both `filter` and `slices` survived. A successful apply response is not enough.

## Common Mistakes

- **Only adding the filter to one worksheet.** The visible quick filter may control that one worksheet but not the other dashboard sheets.
- **Putting the filter only in dashboard XML.** Dashboard zones can display sheets; they do not define the filter logic for each sheet.
- **Omitting `slices`.** Tableau may silently strip categorical filters on load when the `slices` node does not list the filtered column-instance.
- **Submitting `user:` attributes without a namespace binding.** Worksheet-level apply can reject fragments when `user:` attributes are present but `xmlns:user` is absent on the submitted root.
- **Using a different `filter-group` per worksheet.** Filters synchronize only when all target worksheets share the same integer.

## Implementation

Confirmed working shape for a Region filter shared across two worksheets:

```xml
<view>
  <datasources>
    <datasource name="Sample - Superstore" caption="Sample - Superstore" />
  </datasources>
  <datasource-dependencies datasource="Sample - Superstore">
    <column name="[Region]" role="dimension" type="nominal" datatype="string" />
    <column-instance name="[none:Region:nk]" column="[Region]" derivation="None" pivot="key" type="nominal" />
  </datasource-dependencies>
  <filter column="[Sample - Superstore].[[Region]]"
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

What does **not** work:

```xml
<filter column="[Sample - Superstore].[none:Region:nk]" class="categorical" filter-group="7">
  <groupfilter function="level-members" level="[none:Region:nk]" />
</filter>
```

That omits `slices` and uses column-instance format in `filter column`. It can appear plausible in generated XML but fail to survive Tableau's round-trip. A warning from `categorical-filter-slices` should be treated as a prompt to add the missing slice before trusting the apply.

## Source and Confidence

- Source/evidence type: field-tested
- Source: Cross-sheet filter-group/slices/namespace XML patterns; provenance not fully attested post-IA-migration
- Customer-identifying details removed: yes
- Confidence: needs review
- Last reviewed: 2026-07-02

