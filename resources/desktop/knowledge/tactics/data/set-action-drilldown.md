# Parameter-Free Click-to-Expand Drilldown with Set Actions

Use a dimension set, an on-select set action, and row-level calculations when a user
wants one branch of a bar view to expand on click without a parameter. This is the
Tableau-specific mechanism behind a collapsed `+` that becomes the selected Category
name while that Category reveals its Sub-Categories.

- Relevant user prompts/search terms: "click to expand", "drill down without parameter", "set action toggle expand collapse category into sub-category", "plus label expands sub-categories", "Category Set drilldown"
- Related knowledge: `expertise://tableau/tactics/data/sets-usage-and-creation` explains general set behavior; `expertise://tableau/tactics/workflow/templates` explains the current `author-*` command lane.

## When to Use

Use this pattern when all of these are true:

- The view starts at a parent dimension such as `[Category]`.
- Selecting one parent should reveal only that parent's child members, such as
  `[Sub-Category]`, while other parents remain collapsed.
- A collapsed row needs a visible `+` affordance and an expanded row needs that label
  replaced with the parent name.
- The drill state must be parameter-free.

This is not the same as placing a native Category → Sub-Category hierarchy on Rows.
The interaction state lives in a Category set, and a set action changes membership when
the viewer selects a mark.

## Best Practices

- **Treat the set as the drill state.** A Category outside `[Category Set]` is collapsed;
  a Category inside it is expanded.
- **Run the set action on Select.** Target the worksheet that displays the Category
  marks and the Category set. Configure selection to add/remove membership, or use the
  available toggle-equivalent behavior so a click changes the selected branch without
  a parameter.
- **Keep the calculations row-level.** The set, Category, and Sub-Category are
  dimensions; no aggregation is needed in the drill or label formulas.
- **Keep the child calculation on the same discrete axis as the parent/header fields.**
  The blank string for collapsed members prevents every Sub-Category from appearing at
  once.
- **Verify both states.** Readback can prove that the set, calculations, shelves, and
  action exist, but only an interaction test can prove that clicking expands and
  collapses the intended branch.

### Set membership syntax

In a Tableau calculation, a set field is already a boolean membership predicate. The
row-level child calc is:

```tableau
IF [Category Set] THEN [Sub-Category] ELSE '' END
```

Some requests describe this as
`IF ISMEMBEROF([Category Set]) THEN [Sub-Category] ELSE '' END`. Do not emit that
formula: Tableau's `ISMEMBEROF()` checks whether the signed-in user belongs to a
Tableau Server/Cloud group; it does not test membership in a data set. Use
`[Category Set]` directly.

## Common Mistakes

1. **Using a native hierarchy.** A normal Category → Sub-Category hierarchy can expose
   hierarchy controls, but it does not implement this set-driven `+`/Category label
   swap or asymmetric one-branch expansion.
2. **Using a parameter.** This ask class explicitly forbids a parameter driving the
   expanded Category. A parameter action is therefore not an equivalent solution.
3. **Authoring the action before the set.** The action needs a real target set. Create
   `[Category Set]` first or the action cannot bind to its target.
4. **Creating the set but omitting the action.** A static set leaves the viewer unable
   to change the expanded Category.
5. **Showing all children at once.** Putting raw `[Sub-Category]` directly on the axis
   without guarding it by set membership expands every Category.
6. **Leaving `+` visible after expansion.** The header calc must return the Category
   name for IN members and `+` only for OUT members.
7. **Using metadata XML apply for this lane.** General set guidance records that
   `<groups>` can be stripped by metadata apply. Use the dedicated `author-set` and
   `author-action` command verbs, then verify readback, rather than assuming a
   hand-spliced set/action survived.

## Implementation

Use the authoring lane in dependency order:

1. **`author-set` first:** create an initially empty set named `Category Set` on
   `[Category]`.
2. **`author-calc` next:** create the drill/detail and label calculations.
3. **`author-action` next:** create an on-select worksheet-source set action targeting
   `[Category Set]`, with add/remove or toggle-equivalent membership behavior.
4. **Bind and place fields last:** use `bind-template` for the Sales bar shell
   when eligible, then `add-field` to place the Category/header/drill fields on
   the same discrete Rows axis and `SUM([Sales])` on Columns. If the shell already
   exists, add the fields directly instead of rebinding it.
5. Apply, read back, and interactively test one collapsed and one expanded Category.

Never substitute `author-parameter` or a native hierarchy for this ask shape.

### Confirmed golden-derived example

The following structure is derived from the committed WW2025 W39 golden reconstruction,
not newly live-authored for this entry. The golden uses one Category set, two row-level
calculations, and an on-select set action (authored via `author-action`) targeting that set:

```tableau
Category Set = set on [Category], initially empty

Title  = IIF([Category Set], [Sub-Category], [Category])
Header = IIF([Category Set], [Category], '+')

Rows    = [Category] / [Header] / [Title]
Columns = SUM([Sales])

Action  = on-select set action
Target  = [Sample - Superstore].[Category Set]
```

In the collapsed state, `Header` is `+` and `Title` is Category. After the action adds
that Category to the set, `Header` becomes the Category name and `Title` resolves to
Sub-Category. This preserves collapsed siblings and uses no drill-state parameter.

The equivalent split-field axis form uses the child calc shown earlier
(`IF [Category Set] THEN [Sub-Category] ELSE '' END`) beside Category and the header
calc. The golden's `Title` calc combines the collapsed Category and expanded
Sub-Category values into one field; both forms are the same set-membership pattern.


### Live-confirmed action XML (2026-07-26, build 0000.26.0715.2311)

A set action serializes as **`<edit-group-action>`** — sets are groups in workbook XML;
there is no `<set-action>` element, and `<edit-parameter-action>` targeting a set is malformed
(Desktop persists it, then throws blocking internal-error modal CDEAC1A9 on interaction).
This exact node round-trips a live /v0 apply byte-faithfully (Desktop mints the action
name and backfills `add-or-remove-marks='assign'` when omitted):

```xml
<edit-group-action caption='Expand Category' name='[Action1]'>
  <activation type='on-select' />
  <source type='sheet' worksheet='se-eval-scratch' />
  <single-select value='true' />
  <add-or-remove-marks value='assign' />
  <params>
    <param name='selection-clear-set-option' value='do-nothing' />
    <param name='target-group' value='[federated.1syzfv90anwuu119p4zra1ga299n].[Category Set]' />
  </params>
</edit-group-action>
```

Rules that do not bend:
- Child order is fixed: `<activation>`, `<single-select>`, `<add-or-remove-marks>`, `<params>` (with `<source>` second).
- `'target-group'` qualifies with the datasource's **`name` attribute** (`federated.*`), never its caption.
- `'selection-clear-set-option'` ∈ `'do-nothing'` | `'show-all'` | `'exclude-all'`. Do NOT emit `<clear-option>` on a group action.
- Apply-time validation does NOT resolve `'target-group'` — a dangling target is accepted silently. Always read back and byte-compare the `<actions>` block.
- The empty set the action targets is `<group caption='Category Set' name='[Category Set]' name-style='unqualified' user:ui-builder='filter-group'><groupfilter function='empty-level' member='[Category]' user:ui-domain='database' user:ui-enumeration='inclusive' user:ui-marker='enumerate' /></group>` inside the target datasource.
