# Parameter-Driven Views: Model a Shared Dimension Once, Don't Build N Static Copies

## Scope Check

- Primary audience: Tableau agent / SE authoring XML
- Authoring outcome improved: create, refine
- In-scope reason: Prevents the N-static-copies anti-pattern; models a shared dimension once so click-to-recompute has a foundation.
- Out-of-scope risk: none
- Tags: parameter, parameter-action, edit-parameter-action, switcher, selector, toggle, drill, interactive-dashboard, clickable, re-rank, recompute, shared-dimension, one-parameter-not-many, period-selector, metric-switcher, view-switching
- Relevant user prompts/search terms: "let the user switch between options", "clicking a tile changes the chart", "make the dashboard interactive so selecting one updates the others", "switch the view by period / region / metric", "a selector that drives the chart", "re-rank the chart when I pick a different option", "three buttons that change what the chart shows", "how do I make one click recompute the whole view", "don't want a separate sheet for every option", "make it so I can CLICK to change the period instead of using the dropdown", "clicking should set the period and re-sort the chart", "the top/bottom standouts should change between periods", "make the period selectable and re-rank per period"

## When to Use

Enforced-by: invalid-column-instance-pivot

Reach for this the moment a request implies **several views that differ only by which value of ONE dimension they show**, and especially when **clicking** one is supposed to **change** the others:

- "show it by Month, Quarter, or Year — and clicking one re-ranks the chart"
- "let me toggle between Region / Segment / Category"
- "pick a metric and the whole dashboard updates"
- any "N options, selecting one drives the rest" interaction.

The tell: the options are **values of the same dimension** (the periods, the regions, the metrics), and the deliverable is **switching among them**, not showing all at once.

## Best Practices

1. **Parameterize the shared dimension ONCE — do not build one static sheet per value.** The single most common structural mistake is authoring N hardcoded sheets ("KPI Month", "KPI Quarter", "KPI Year") — three frozen views that *cannot* respond to a click because there is nothing to select. Instead create ONE parameter (e.g. `[View Selector]`) whose value names the option, and ONE set of calcs/views that read it. This is the **spine**: the same parameter both *displays* the current selection and *drives* what every other view computes.
2. **Display and interactivity are two uses of the same parameter — design them together.** A KPI/BAN tile that shows "the total for the selected option" reads the parameter; the clickable control that switches the option *sets* the parameter. Build the parameter first and both fall out of it. If you build the display as static numbers, you have thrown away the hook the interactivity needs and will have to rebuild from scratch.
3. **The click is wired with a parameter action, not a filter.** A dashboard `<action>` of class change-parameter (an `edit-parameter-action`) maps a field on the source view to the parameter, so selecting a mark sets the parameter, which recomputes every view that reads it. Use a parameter action (not a filter action) when the goal is to *recompute/re-rank*, not merely to *filter rows*.
4. **Anything that must change on selection must DEPEND on the parameter.** A view re-ranks per option only if its sort/tier/measure calc references the parameter. A view placed on the dashboard but computed independently of the parameter will sit there unchanged — looking interactive, doing nothing.

## Common Mistakes

1. **N static copies instead of one parameter.** Building a separate sheet per option (one per period/region/metric) is the dead-end pattern: static sheets can't be selected or recomputed, so the interactivity step has no foundation and must be redone. Recognize the shared dimension and parameterize it once, up front.
2. **Wiring a filter action when the goal is recompute.** A filter action removes rows; it does not change a ranking or a per-option calc. If the ask is "re-rank when I pick X", the selection must drive a **parameter** the calcs read, not a row filter.
3. **A control that sets nothing.** A clickable tile/legend/control that is not bound to the parameter via an action changes nothing on click. The action is what makes the control live.
4. **Views that don't read the parameter.** Placing the parameter action but leaving the target view's calc independent of the parameter — the parameter changes, the view doesn't. Every element that should update must reference the parameter in its calc.

## Implementation

1. **Author the parameter** (a `<column>` with `param-domain-type='list'` and the allowed values) in the Parameters datasource — one parameter for the shared dimension, default to the first option.
2. **Make the views depend on it.** Any calc that should change per option references the parameter (e.g. a calc that selects/aggregates based on `[View Selector]`). Display tiles read it to show the current option's value; the main chart's sort/tier calc reads it so it re-ranks.
3. **Wire the click** with a dashboard parameter action. Confirmed-working shape (a change-parameter action mapping a clicked field to the parameter):

```xml
<actions>
  <action name="Select Option" class="change-parameter">
    <activation type="on-select"/>
    <source type="sheet" sheet="Selector"/>
    <command command="tablomatic-change-parameter">
      <param name="parameter" value="[Parameters].[View Selector]"/>
      <param name="field" value="[Option Label]"/>
    </command>
  </action>
</actions>
```

4. **Verify by switching the value.** Set the parameter to each option (or click each control) and confirm the dependent views actually change — the ranking/membership/total should differ per option. If a view looks identical for every value, it does not read the parameter (mistake #4).

## Related Knowledge

- `tactics/dashboard/zones.md` — placing the control + the dependent views as dashboard zones (and the zone-render assertions).
- `tactics/data/calc-fields.md` — authoring the parameter-reading calc.
- `strategy/dashboard-design/dashboard-archetypes.md` — when an interactive switcher is the right design vs. showing all options at once.

## Source and Confidence

- Source/evidence type: design best-practice
- Source: Standard interactive-dashboard design pattern, surfaced from authoring observation that agents default to one static sheet per option
- Customer-identifying details removed: yes
- Confidence: SME-reviewed
- Last reviewed: 2026-07-03
