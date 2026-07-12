# Dashboard Performance and Designing Efficient Workbooks

Strategy for designing fast Tableau dashboards and diagnosing slow ones — the author-controlled levers (data, calculations, worksheets, layout), a performance budget, and when to push back on a request that cannot be fast.


**Tactics companion:** `expertise://tableau/tactics/data/datasources` (extract/connection mechanics) and `expertise://tableau/tactics/data/calc-fields` (calc XML) — the authoring mechanics behind these performance decisions.

## Scope Check

- Primary audience: Tableau user / SE assisting a Tableau user
- Authoring outcome improved: create, refine, troubleshoot
- In-scope reason: Helps Claude guide users to build fast dashboards by applying author-controlled performance levers.
- Out-of-scope risk: none
- Tags: performance, extract, materialization, mark count, filters, filter-controls, quick-filter, dashboard-performance, workbook size, lazy loading, LOD, table calculations, production dashboards, VizQL, data source, Hyper
- Relevant user prompts/search terms: "quick filter for each dimension", "quick filters for all dimensions", "quick filters for every dimension", "show only relevant values quick filters", "categorical quick filters on every dimension", "a filter control per dimension", "filter card per dimension", "visible filter shelf for dimensions", "add filters for all dimensions", "too many quick filters", "quick-filter performance", "dashboard is slow", "make my workbook faster", "efficient workbook", "reduce mark count"

## When to Use

Use this guidance when:
- A customer's dashboard is slow and you need to identify where to focus
- A user is building a new production dashboard and needs to design for speed from the start
- A customer is asking why their dashboard is faster on Desktop than on Server (or vice versa)
- A user is adding features and asking what the performance trade-off is

This applies to:
- Tableau users building dashboards for production deployment (Tableau Server or Cloud)
- SEs diagnosing slow workbooks during POCs, deployments, or health checks

**The anatomy of performance.** Every Tableau dashboard load passes through four stages: Query Time → Calculation Time → Rendering Time → Layout Computation. Authors control all four through their data, calculations, worksheets, and dashboard design. Most performance problems are authoring mistakes, not infrastructure problems.

**Performance budget.** Treat load time like a budget. Target an acceptable load time (a common starting point: ≤5 seconds for executive dashboards, ≤30 seconds for analyst dashboards, ≤60 seconds for technical/specialized views). Every chart, filter, LOD calc, and mark spends from that budget. Each unneeded element is waste.

---

## Best Practices

### Data Source

1. **Use Hyper extracts whenever possible.** Extracts are the single most impactful change for most workbooks. They are columnar, in-memory, and purpose-built for Tableau queries. If a workbook is slow, the first test is always: take an extract and compare.

2. **Size your extract for the workbook, not the database.** Before publishing: hide unused fields (Data Source tab → right-click field → Hide), apply a data source filter to exclude unneeded rows, and aggregate to the granularity the dashboard actually needs. Each unneeded row and column adds processing overhead.

3. **Materialize calculations in the extract.** After adding calculated fields, force Tableau to pre-compute them: Data menu → select your data source → Extract → Compute Calculations Now. Materialized calcs are stored in the extract and do not run at query time. Note: Tableau cannot materialize calculations that use parameters, NOW(), TODAY(), table calcs, LOD expressions, or external functions.

4. **Prefer the Logical Layer (Relationships) over the Physical Layer (Joins) for multi-table data.** Relationships allow Tableau to query tables independently and respect granularity. This avoids row multiplication that makes aggregations incorrect and extracts bloated.

5. **Avoid Custom SQL in production.** Custom SQL becomes a subquery that wraps every Tableau query, creating complex and hard-to-optimize SQL. Alternatives: use a database view, take a Hyper extract, or redefine joins in Tableau's UI instead.

### Calculations

6. **Materialize expensive calculations at the data layer.** Row-level calculations (string manipulation, date conversions, CASE grouping) should be pre-computed in the database or extract — not recalculated at query time. Move `LEFT()`, `FIND()`, `DATEPARSE()`, `DATEPART()` to the data layer when possible.

7. **Use CASE statements for grouping, not native Groups.** Native Groups load the entire domain of the dimension. CASE statements load only the named members. Order of performance (best to worst): CASE > Sets > Native Groups > IF/ELSEIF chains.

8. **Use ELSEIF, not ELSE IF.** `ELSEIF` is treated as a single statement and can be optimized to a CASE by the query engine. `ELSE IF` (with a space) creates nested logical statements. Also: put the most frequent outcomes first in IF chains — Tableau stops evaluating as soon as it finds a match.

9. **Prefer MIN/MAX over ATTR and AVG** when values are known to be non-duplicated. `ATTR` runs both MIN and MAX internally. Choosing one cuts the work in half.

10. **Avoid COUNTD when possible.** `COUNTD` is expensive at large data volumes. If you are counting a primary key, use `COUNT` or `SUM([Number of Records])`. In the relational model, use `CNT(Table)` for even faster counting directly on the dimension table.

11. **Use IN instead of OR for list comparisons.** `[Field] IN ('A', 'B', 'C')` is processed as a single list check. `[Field] = 'A' OR [Field] = 'B'` evaluates each condition individually.

12. **Aggregate parameters before evaluation.** A CASE statement that evaluates row-level values with a parameter runs on every row before aggregation. Wrapping the comparison in `SUM()` allows Tableau to aggregate first, then evaluate the parameter — far fewer comparisons. Example: `CASE [Param] WHEN 'Sales' THEN SUM([Sales]) END` is faster than `SUM(CASE [Param] WHEN 'Sales' THEN [Sales] END)`.

### Worksheets

13. **Minimize mark count.** Every bar, point, text cell, and shape is a mark Tableau must render. Check the mark count in the bottom-left of Desktop. High mark counts on complex charts slow dashboards significantly — aggregate to a higher level, filter, or break into separate views.

14. **Avoid polygon marks on Server.** Polygon mark types force server-side rendering on Tableau Server/Cloud, which sends an image instead of data and slows tooltips and hover interactions.

15. **Use text formatting for KPI arrows instead of shape calculations.** Format → Number → Custom → type `▲;▼;–` to display up/down indicators without a calculated field or shape assignment.

16. **Avoid the Page Shelf in production.** The Page Shelf queries all pages at once — it does not reduce data. It has the appearance of a filter but none of the performance benefit.

### Dashboard Layout

17. **Use fixed-size dashboards.** Fixed sizing allows Tableau Server to cache results predictably. Automatic sizing changes the layout per user, reducing cache effectiveness.

18. **Limit views per dashboard.** Every worksheet adds queries and marks. More than 5 visualizations on one dashboard is a signal to reconsider structure. Split into multiple focused dashboards connected by navigation actions.

19. **Limit filter controls to 3–5 per dashboard.** Each filter control adds rendering and query complexity. "Show Only Relevant Values" on filters issues a query per filter change to regenerate the list — avoid it unless essential, and use embedded Hyper extracts if you must.

20. **Use lazy loading: hide detail views until needed.** Float a container and add a Show/Hide button. Hidden containers are not rendered on initial load. Use this for drill-down views, detail tables, and secondary filters — load only what users actually need at first glance.

21. **Publish without tabs for production dashboards.** Tabs cause Tableau to load elements of all dashboards in the workbook at once. Use navigation buttons or URL actions for navigation instead.

22. **Clean up unused elements before publishing.** Remove unused calculated fields, worksheets, dashboards, and data sources. Tableau's VizQL engine parses the entire TWB file before rendering any dashboard — a larger file means a slower parse on every load.

### When to Say No

Say no when:
- A customer wants to add a large crosstab with 6+ filters so users can export raw data — this is an ETL use case, not a dashboard. Tableau Prep or a direct query tool is the right answer.
- A user wants to embed pixel-perfect formatted financial reports (P&L, balance sheets) with complex formatting — performance and formatting control will both be poor. Flag Tableau Extensions or a report tool as alternatives.
- Someone expects a dashboard querying billions of live rows across a transatlantic connection to load in 2 seconds. This is a physics problem, not a Tableau problem — set realistic expectations and recommend extracts.

---

## Common Mistakes

### 1. Keeping a live connection to a slow database in production
- **Problem**: The workbook performs fine in development with a small dataset, but is slow in production with full data volume.
- **Why it is wrong**: Tableau can only be as fast as the underlying data source. A slow query in the database is a slow dashboard for every user on every load.
- **Fix**: Create a Hyper extract. This is the first test for any slow workbook. If the extract is also slow, the problem is in the calculations or rendering — not the data source.

### 2. Datasource filters skipped to "save time"
- **Problem**: Publishing a data source or extract that includes every field and every row "just in case."
- **Why it is wrong**: Every hidden field and unused row still increases the extract size and parse time. The more focused the extract, the faster the dashboard.
- **Fix**: Before publishing, apply a data source filter, hide all unused fields, and aggregate to the required level of detail. Run Extract → Compute Calculations Now.

### 3. Too many filters with "Show Only Relevant Values"
- **Problem**: Five dropdown filters all set to show only relevant values.
- **Why it is wrong**: Each filter interaction triggers a new query to regenerate all filter lists. Five filters with relevant values = five queries per selection change, compounding with every user interaction.
- **Fix**: Limit to 3–5 filters total. Use custom value lists or wildcard matches instead of "only relevant values" where possible. If you must use relevant values, use an embedded Hyper extract.

### 4. Native Groups for dimension grouping on live connections
- **Problem**: Using Tableau's drag-to-group functionality to create regional groups or category rollups.
- **Why it is wrong**: Native Groups load the entire domain of the dimension on every query. On large dimensions this adds substantial overhead.
- **Fix**: Replace with a CASE statement or add the grouping to the data source. CASE statements load only the named members.

### 5. Publishing with tabs enabled
- **Problem**: A workbook with 10 dashboards is published with "Show Sheets as Tabs" checked.
- **Why it is wrong**: Tableau loads elements of all dashboards and worksheets when tabs are displayed. A user opening Dashboard 1 still triggers processing for Dashboards 2–10.
- **Fix**: Uncheck "Show Sheets as Tabs" at publish time. Build navigation using buttons (Dashboard → Objects → Button) or URL actions.

### 6. Uncleaned workbooks with leftover development artifacts
- **Problem**: 40 worksheets, 15 unused calculated fields, 3 data sources, and 2 auto-generated device layouts in a workbook that only uses 5 sheets in production.
- **Why it is wrong**: VizQL parses the entire TWB file before rendering. Unused elements increase file size and parse time for every single load by every user.
- **Fix**: Delete unused worksheets, calculated fields, and data sources before publishing. Remove device-specific layouts that aren't needed. Large dashboard counts in a single workbook should be split into smaller workbooks.

### 7. Ignoring the Performance Recorder
- **Problem**: A user reports a slow dashboard but has no data on where the slowness is.
- **Why it is wrong**: Without measurement, optimization is guessing. The fix that takes most effort may not address the bottleneck.
- **Fix**: Start with the Performance Recorder (Desktop: Help → Settings and Performance → Start Performance Recording). It shows query time, calculation time, rendering time, and layout computation broken out. Look at the longest events first.

---

## Implementation

**Diagnosing a slow dashboard — the sequence:**

1. **Test Desktop vs. Server.** If slow only on Server, contact the server admin — the issue may be infrastructure, not authoring. If slow on Desktop, it is an authoring problem.

2. **Take an extract.** If on a live connection, create a Hyper extract and test again. If it becomes fast, the bottleneck was data source query speed.

3. **Run the Performance Recorder.** Identify whether the bottleneck is query time, calculation time, or rendering time.

4. **Check mark count.** High mark count (visible in bottom-left of Desktop) indicates over-rendering. Aggregate or filter.

5. **Check filter count and type.** Count active filter controls. Look for "Show Only Relevant Values." Look for filters on high-cardinality dimensions.

6. **Check calculations.** Look for COUNTD, Native Groups, IF/ELSE IF chains, and row-level string/date operations. Consider materialization.

7. **Clean up the workbook.** Remove unused sheets, calcs, and data sources. Check workbook file size.

**Performance Recording in Tableau Desktop:**

Help → Settings and Performance → Start Performance Recording → interact with the dashboard → Stop Performance Recording

Tableau opens a workbook showing each event timed in seconds. Sort by duration descending. Anything over 1 second is worth investigating. "Executing Query" events indicate data source speed. "Computing Layout" events indicate workbook structure complexity.

**Performance Recording on Tableau Server (URL method):**

Add `:record_performance=yes&` before the session ID in the URL. A Performance button appears in the toolbar.

**Workbook Optimizer (Tableau Desktop 2022.4+ and web authoring):**

The Workbook Optimizer automates the audit step. It evaluates the workbook against a rules engine and categorizes findings into three buckets:

- **Take action** — low-risk changes with clear performance benefit (e.g., hide unused fields, close unused data sources). Many have an **Autofix** button that applies the change in one click.
- **Needs review** — changes that require judgment (e.g., reduce dashboard view count, restructure a data source). These may involve significant redesign.
- **Passed** — guidelines already met.

To run it in Desktop: Server menu → Run Optimizer.

At publish time it also appears in the publishing dialog — a natural checkpoint before content goes to production.

**What the Optimizer checks** (key rules relevant to authoring):

| Rule | What it flags |
|---|---|
| Not an extract | Data source is live; extract recommended |
| Uncomputed calculations | Calculations not materialized in the extract |
| Unused fields | Fields in the data source not used in any sheet |
| Unused data sources | Data sources connected but not powering any sheet |
| LOD calculations | High count of LOD expressions |
| Nested calculations | Calcs that reference other calcs |
| Native Groups | Groups that load full dimension domain |
| Filters with "Only Relevant Values" | High query overhead on filter interaction |
| Conditional logic filters | Slower than list or wildcard filter types |
| Too many filters on a sheet | Excessive filter count adds query complexity |
| Too many views on a dashboard | Each view adds queries and render time |
| Too many layout containers | Unnecessary containers complicate rendering |
| Non-fixed dashboard size | Automatic sizing prevents effective caching |
| Data blending in use | Blending drives cardinality-based performance risk |
| Cross-database calculations | Cannot be optimized; must be computed locally |

**When to use it:** Run the Optimizer before every production publish. It is not a substitute for the Performance Recorder (which shows actual timing), but it catches structural problems quickly without needing to run and profile the workbook first.

**Ignoring rules:** If a rule doesn't apply (e.g., you intentionally keep unused fields in a template workbook), click Ignore on that guideline. It moves to "Passed and ignored" and won't appear in future runs.

---

## Sources

Synthesized from "Designing Efficient Production Dashboards" (Bausili & Hughes, InterWorks 2021; benchmark testing across 4,685 runs on Tableau Server 2020.4 via Scout), Alan Eldridge's "Designing Efficient Workbooks" whitepaper (2016), and Tableau Help on the Workbook Optimizer.

## Source and Confidence

- Source/evidence type: published documentation
- Source: Synthesized from an InterWorks benchmark study, Tableau Help on the Workbook Optimizer, and Alan Eldridge's performance whitepaper
- Customer-identifying details removed: yes
- Confidence: SME-reviewed
- Last reviewed: 2026-07-03
