# Parameter Actions: Clicking a Mark Sets a Parameter (edit-parameter-action)

## Scope Check

- Primary audience: Tableau agent / SE authoring XML
- Authoring outcome improved: create, troubleshoot
- In-scope reason: Establishes the click-to-set-parameter pattern and the common failure of using the Parameters pseudo-datasource as the action source-field, which has no real datasource.
- Out-of-scope risk: none
- Tags: parameter-action, edit-parameter-action, click-to-set, dashboard-action, change-parameter, on-select, clickable, interactive, set-parameter-from-click, period-switch, mark-click
- Relevant user prompts/search terms: "make clicking switch the period / option", "clicking a tile or mark should change the parameter", "let me click instead of using the dropdown", "a button that sets the parameter", "click a mark to drive the rest of the dashboard", "how do I wire a click to a parameter", "on-select parameter action"

## When to Use

Enforcement: judgment-only

Use this when the requirement is **"clicking something changes what the dashboard shows"** and the thing it changes is a parameter (period, metric, top-N, scenario). A parameter action maps a field from a clicked mark onto a parameter, so selecting a mark on one sheet recomputes every view that reads that parameter. This is how the WOW W44 dashboard switches Month/Quarter/Year — there are no period BAN tiles to click; a small control sheet's marks are clicked, setting `p.Period`.

This is the INTERACTIVITY half of `parameter-driven-views`: that entry says model the shared dimension once as a parameter; this entry wires the click that sets it.

## Best Practices

1. **Use a parameter action (`change-parameter`), not a filter action, when the goal is to RECOMPUTE.** A filter action removes rows; a parameter action changes a value the calcs read, re-ranking/recomputing the whole view. "Clicking re-ranks the chart for that period" is recompute → parameter action.
2. **The action lives on the DASHBOARD, in `<actions>`, with `activation type='on-select'`.** It names a source sheet, a `source-field` (the field on the clicked mark), and a `target-parameter`.
3. **Have a small dedicated control sheet to click.** In the reference build it's a one-field sheet (`[:Measure Names]`); clicking its marks is what fires the action. Keep the control compact and obvious; the main viz stays the consumer of the parameter.
4. **The control sheet's clickable field MUST come from the REAL datasource, never `[Parameters]`.** The `source-field` is a field on a mark, and marks render only off a *connected* datasource. In the W44 build the clickable field is `[Sample - Superstore].[:Measure Names]` (the real Superstore datasource), NOT the parameter. A parameter can be the action's *target*, never the source mark's field — `[Parameters]` is a connectionless pseudo-datasource and a worksheet bound to it "does not have a valid data source." Build the selector tiles from a real string/Measure-Names dimension whose members map to the parameter's options (see Implementation).
5. **`clear-option type='do-nothing'`** so deselecting doesn't reset the parameter to an empty state mid-interaction.

## Common Mistakes

1. **Wiring a filter action when you meant to switch a parameter.** The chart then filters rows instead of recomputing per the new value — top/bottom membership won't re-rank.
2. **No control to click.** A parameter action needs a source mark; without a sheet whose marks carry the source-field, there's nothing to select. (A parameter shown only as a dropdown is fine too, but then there's no "click" — match the ask.)
3. **Trying to put the PARAMETER itself on the selector sheet's shelf → "does not have a valid data source."** The most common failure on this build: the agent reaches for `[Parameters].[…]` as the clickable field, but marks must render off a *connected* datasource and `Parameters` has none, so the apply is rejected (the worksheet has no valid data source) and the selector never renders. FIX: the source-field is a real dimension from the data connection — e.g. `[Sample - Superstore].[:Measure Names]` filtered to the period members, or a small string-dimension calc whose values equal the parameter's allowed values. The parameter is only the action's `target-parameter`, never the source mark's field.
4. **Target view doesn't read the parameter.** The action sets the parameter, but a view whose calcs don't reference it won't change — see `parameter-driven-views` mistake "views that don't read the parameter."
5. **Putting the `<actions>` block on a worksheet.** Parameter/dashboard actions belong under the `<dashboard>`'s `<actions>`, not a worksheet.

## Implementation in Tableau Desktop

Confirmed-working `edit-parameter-action` from the WOW W44 dashboard (clicking a mark on the `Profit` control sheet sets the `p.Period` parameter):

```xml
<dashboard name='Top and Bottom Performers'>
  ...
  <actions>
    <edit-parameter-action caption='Set Period' name='[Action_SetPeriod]'>
      <activation type='on-select' />
      <source dashboard='Top and Bottom Performers' type='sheet' worksheet='Profit' />
      <agg-type type='attr' />
      <clear-option type='do-nothing' value='s:LROOT:' />
      <params>
        <param name='source-field' value='[Sample - Superstore].[:Measure Names]' />
        <param name='target-parameter' value='[Parameters].[p.Period]' />
      </params>
    </edit-parameter-action>
  </actions>
</dashboard>
```

1. Build the control sheet whose marks carry the `source-field` to click.
2. Build the consumer view(s) whose calcs read the `target-parameter`.
3. Add the `<edit-parameter-action>` to the dashboard's `<actions>`, mapping source-field → target-parameter, `on-select`.
4. Verify by clicking a control mark: the parameter value changes and the consumer view recomputes. (In a headless eval, set the parameter value directly to confirm the consumer re-ranks — see `parameter-driven-views`.)

### The selector control sheet (the piece agents get wrong)

The clickable sheet (`Profit` in W44) is bound to the REAL datasource and puts a discrete dimension on a shelf — here `[:Measure Names]`, filtered to just the period members so the sheet shows one clickable mark per period option. Note the `<datasource-dependencies>` is `Sample - Superstore` (the connected data), and the categorical filter pins `[:Measure Names]` to exactly the period set. Transcribed from the published W44 workbook:

```xml
<worksheet name='Profit'>
  <table>
    <view>
      <datasources>
        <datasource caption='Sample - Superstore' name='federated.xxxx' />
      </datasources>
      <datasource-dependencies datasource='federated.xxxx'>
        <!-- the period calcs that ARE the clickable options -->
      </datasource-dependencies>
      <!-- limit [:Measure Names] to just the period members -> one mark per period -->
      <filter class='categorical' column='[Sample - Superstore].[:Measure Names]'>
        <groupfilter function='union' user:op='manual'>
          <groupfilter function='member' level='[:Measure Names]'
            member='&quot;[Sample - Superstore].[sum:QTD:qk]&quot;' />
          <groupfilter function='member' level='[:Measure Names]'
            member='&quot;[Sample - Superstore].[sum:YTD:qk]&quot;' />
          <!-- ...one <groupfilter member> per period option... -->
        </groupfilter>
      </filter>
    </view>
    <panes>
      <pane>
        <mark class='Automatic' />
        <encodings>
          <text column='[Sample - Superstore].[:Measure Names]' />
        </encodings>
      </pane>
    </panes>
    <rows />
    <cols>[Sample - Superstore].[:Measure Names]</cols>
  </table>
</worksheet>
```

The action's `source-field` (`[Sample - Superstore].[:Measure Names]`) is exactly the field on this sheet's `<cols>` — that alignment is what lets a click resolve to a parameter value. If the selector sheet instead tried to carry `[Parameters].[…]`, it would fail to render ("no valid data source") because `Parameters` has no connection.

(Simpler alternative when you don't need Measure-Names tiles: make a small string-dimension calc, e.g. `// PeriodOptions` returning the literal option labels, put it on Rows/Text of a sheet bound to the real datasource, and map THAT field as `source-field`. Same rule: the clickable field is a real connected dimension, never the parameter.)

## Related Knowledge

- `tactics/dashboard/parameter-driven-views.md` — model the shared dimension once; this is the click that sets it.
- `tactics/data/period-over-period-calcs.md` — the period calc the parameter switches.
- `tactics/dashboard/zones.md` — placing the control + consumer as dashboard zones.

## Source and Confidence

- Source/evidence type: field-tested
- Source: Transcribed from a WOW2021 W44 published workbook (confirmed-working edit-parameter-action + selector sheet XML)
- Customer-identifying details removed: yes
- Confidence: field-tested
- Last reviewed: 2026-07-03
