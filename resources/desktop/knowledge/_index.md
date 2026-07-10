# Tableau Authoring Knowledge — Navigation Map

Start here. This map routes an authoring task to the right expertise module. It is a
**navigation aid, not an expertise module** — read it to decide *where to go*, then
read the specific module before authoring.

How agents reach this knowledge:
- **`search_knowledge`** — fuzzy ranking by concept/keyword. Best when you don't know
  the slug. Returns `expertise://tableau/<slug>` hits; read the top one.
- **This map** — when you want the deliberate general → specific path.
- **`read_knowledge_resource`** (or MCP `resources/read`) — read a known slug.

Slug = path under `data/knowledge/` with `.md` stripped. URI =
`expertise://tableau/<slug>`.

## The three domains

| Domain | What it holds | Routing test |
| --- | --- | --- |
| **`tactics/`** | Objective, factual "how Tableau works." XML you generate, node/attribute rules, confirmed-working patterns, version-stamped behavior. | Names a Tableau XML node/attribute or product-specific mechanic. |
| **`strategy/`** | The technique for the *best* analytical outcome, fast: chart choice, design, storytelling, when to push back, how to disambiguate a request, what "best" looks like. | Would still be true for another BI tool. |
| **`personalization/`** | What a user or org is most likely to **modify**: Tableau's suggested defaults, an org style guide, solution-routing choices. | A default or preference an org would override. |

The routing test (one question): *Would this statement still be true for another BI
tool?* Yes → `strategy/` or `personalization/`; if it names a Tableau XML
node/attribute or a Tableau-specific mechanic → `tactics/`.

Folders are a human/slug aid — agents navigate by `search_knowledge` + this map. Many
topics have a **tactics file (the XML/how) and a strategy companion (the when/why)**
that cross-link bidirectionally: land on either, hop to the other via its
`**Tactics companion:**` / related-knowledge line.

## Task → where to look

Entries show the tactics slug and, where one exists, its strategy companion.

### "I'm building / editing a viz (worksheet)"
- Choosing a chart type (strategy) → `strategy/viz-design/chart-selection`
- Overlaying / stacking / nesting multiple pie charts (readability pushback + alternatives) → `strategy/viz-design/overlaid-and-stacked-pie-readability`
- Filters → `tactics/viz/filters` · strategy: `strategy/viz-design/filter-strategy`
- Marks, encodings, color/size/label, sorts → `tactics/viz/marks-and-encodings` · strategy: `strategy/viz-design/encoding-strategy`
- Discrete groups vs. gradient (color "which group", not the raw measure) → strategy: `strategy/viz-design/discrete-groups-vs-gradient` · tactics: `tactics/viz/marks-and-encodings` ("Discrete-tier color")
- Worksheet + window structure → `tactics/viz/worksheets` · strategy: `strategy/viz-design/worksheet-strategy`
- Year-over-year / period comparison → `tactics/viz/workbook-date-yoy-comparison`
- Period-over-period calcs (this period vs prior, % change, DATEDIFF from a max date) → `tactics/data/period-over-period-calcs`
- Analytics pane (trend, forecast, clustering, stat fns) → `tactics/viz/analytics-pane-reference`
- Viz extensions → `tactics/viz/building-viz-extensions`
- Enums (mark types, field roles, CI suffixes, zone/filter classes) → `tactics/tree/enums`
- Color, typography, design principles, storytelling, advanced builds (strategy) → `strategy/viz-design/*`

### "I'm working with data / calculations"
- Calculated fields, parameters, table calcs → `tactics/data/calc-fields` · strategy: `strategy/analytics/calc-fields-strategy`
- What-if parameters + scenario bands (adjustable target/slider, best/worst/expected, shaded range, forecast override) → `tactics/data/parameters-and-scenario-bands`
- Calc named the same as a datasource field → ignored → BLANK viz → `tactics/data/calc-name-collides-with-field`
- Calc named the same as an existing *calc* → STALE formula kept → renders WRONG (not blank); namespace template calcs per apply → `tactics/data/calc-formula-shadowed-by-stale-datasource-calc`
- Parse a number out of a compound string (SPLIT/REGEXP, don't INT the whole thing → flat/zero) → `tactics/data/parse-number-from-compound-string`
- LOD & table-calc recipes → `tactics/data/lod-and-table-calc-patterns`
- Ratios, moving-window %, and grand totals of a calc (SUM/SUM not AVG-of-ratios; Total using) → `tactics/data/aggregate-ratio-window-total-semantics`
- Prior-year calc that must respond to the date filter (order-of-operations trap; valid date derivations) → `tactics/data/year-over-year-date-filter-calc`
- Rolling-window & previous-value table calcs (rolling 12M vs prior/adjacent window, LOOKUP(-1), addressing) → `tactics/data/rolling-period-and-prior-value-table-calcs`
- LOD lookup across a relationship, conditional match-and-sum, and the LOD-vs-table-calc order-of-operations choice → `tactics/data/lod-across-relationships-and-conditional-aggregation`
- Sets → `tactics/data/sets-usage-and-creation` (⚠ sets do NOT survive MCP apply — see below)
- LOD membership tier calc (top/bottom/everyone-else via apply-safe calcs) → `tactics/data/lod-membership-tier-calc`
- Date derivations / parsing → `tactics/data/tableau-date-handling`
- Datasources, connections, injection → `tactics/data/datasources` · strategy: `strategy/data-modeling/datasource-strategy`
- Filters not crossing a data blend (secondary-source scope, linking fields, filter actions) → `tactics/data/blend-filter-propagation`
- SQL → Tableau translation → `tactics/data/sql-translation` · strategy: `strategy/analytics/sql-translation-strategy`
- Clean calc authoring (naming, comments, errors) → `strategy/analytics/calc-authoring-best-practices`
- Field roles / types / mark-type reference → `strategy/analytics/field-types-reference`
- Round-trip normalization (what Tableau rewrites on save) → `tactics/data/round-trip-normalization`
- Performance / efficient workbooks → `tactics/data/dashboard-performance-efficient-workbooks`

### "I'm building / editing a dashboard"
- Zones, layout, actions, navigation (XML) → `tactics/dashboard/zones`
- Parameter actions (click a mark to set a parameter) → `tactics/dashboard/parameter-actions`
- Parameter-driven views (a parameter that reshapes what the viz shows) → `tactics/dashboard/parameter-driven-views`
- Sizing modes / container tree (XML) → `tactics/dashboard/dashboard-layout-structure`
- Layout patterns, content placement, archetypes (strategy) → `strategy/dashboard-design/*`
- Layout & actions decisions (strategy) → `strategy/dashboard-design/dashboard-layout-and-actions`
- Too many KPIs / overloaded dashboard → `strategy/dashboard-design/dashboard-overload`
- What every dashboard should include (standard anatomy) → `strategy/dashboard-design/dashboard-template-anatomy`
- Building a KPI / BAN tile (big number + trend) → `strategy/dashboard-design/kpi-tile-construction`
- Reviewing a dashboard before publishing (checklist) → `strategy/dashboard-design/dashboard-peer-review-checklist`

### "I'm choosing an approach / scoping the request"
- Native vs Exchange vs build a custom viz → `personalization/choosing-a-custom-viz-solution`
- Discovery / alignment before building → `personalization/discovery-first-authoring`
- Validate data availability & quality before building → `personalization/validate-data-before-building`
- Frame the business question before building → `personalization/frame-the-question-before-building`
- When Tableau is the wrong layer (fix belongs upstream) → `strategy/workflow/interim-report-pattern`
- Example workbooks & templates → `personalization/workbook-viz-templates`

### "Something went wrong / governance / tooling"
- Recovering from a failed apply (MCP) → `tactics/workflow/recovery` · general troubleshooting: `strategy/workflow/troubleshooting-workbooks`
- Python helper templates → `tactics/workflow/python-helpers` · tool-selection strategy: `strategy/workflow/automation-tool-selection`
- Template injection workflow → `tactics/workflow/templates`
- Bulk UI text edits / translation (tooltips, labels, zones; calc captions = flag, never rename) → `tactics/workflow/ui-translation-bulk-text-edit`
- Don't guess `execute_tableau_command` names → `tactics/workflow/execute-command-crash-risk`
- Export dashboard / worksheet image → `tactics/workflow/export-dashboard-image`, `tactics/workflow/export-worksheet-image-full-canvas`
- Hidden filters are not security; PII / fair-lending exclusions → `tactics/governance/hidden-filter-not-security`, `tactics/governance/pii-and-fair-lending-exclusions`

### Workbook XML structure (reference)
- TWB tree / file anatomy → `tactics/tree/workbook-structure` · strategy: `strategy/data-modeling/workbook-anatomy`
- TWB authoring form → `tactics/tree/twb-authoring-form` · XML grammar → `tactics/tree/twb-xml-grammar`

## SME contributions

There is no separate staging tree. SME-authored knowledge lands directly in the
three domains above (routed by the same test the agent uses), and a maintainer
curates it to the house format at PR review. Agent/tool-behavior change requests
are maintainer notes under `docs/proposed-core-updates/`, not knowledge entries.
