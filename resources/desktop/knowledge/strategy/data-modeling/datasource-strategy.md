# Datasources: Connections, Data Models & Relationships

Strategy guide for datasource modeling decisions — when to use a live connection vs. an extract vs. a published source, when relationships beat joins, when (and when not) to accept custom SQL, and how to push back on choices that will hurt the customer. This is a judgment companion; it defers the XML and connection-editing mechanics to the tactics file.

Tags: datasources, relationships, joins, custom-sql, data-model

**Tactics companion:** `expertise://tableau/tactics/data/datasources` — the XML/authoring mechanics for this topic.

## Scope Check


- Primary audience: Tableau user / SE assisting a Tableau user
- Authoring outcome improved: create, refine, troubleshoot
- In-scope reason: This guides Claude when deciding between relationships versus joins, refactoring custom SQL, and building entity-level scoring calculations like RFM that support dashboard analysis.
- Out-of-scope risk: none
- Tags: datasources, relationships, joins, custom-sql, data-model, extract, published-datasource, live-connection, rfm, entity-scoring, fan-out, chasm-trap
- Relevant user prompts/search terms: "should I use a relationship or a join", "custom SQL vs native tables in Tableau", "when to publish a datasource", "how to refactor custom SQL in Tableau", "RFM scoring in Tableau", "my joins are inflating row counts", "extract vs live connection", "per-customer scores aggregating wrong", "GROUP BY before Tableau sees the data", "relationship fan-out problem", "relationships vs joins", "custom SQL datasource", "how do I connect to a published datasource", "sqlproxy connection class", "refactor custom SQL to native tables", "RFM segmentation calculated fields", "contentUrl not working", "fan-out chasm trap"

## When to Use

Use this guide when:
- **A customer asks about relationships vs. joins** in the data model
- **Explaining how to refactor a custom SQL datasource** into native tables
- **Discussing published vs. embedded datasources** and when to use each
- **Building RFM segmentation calculated fields** on a CRM datasource
- **Explaining connection class differences** (live vs. extract vs. published)

---

## Connection Types

| Type | How it works | When to use |
|---|---|---|
| **Live connection** | Queries the database in real-time | Always-fresh data; small/fast databases |
| **Extract (.hyper)** | Snapshot stored locally; queries run in-memory | Performance; dashboards for users without DB access; offline |
| **Published datasource** | Centrally managed on Tableau Server/Cloud | Shared, governed data; single source of truth for multiple workbooks |

Decision guidance: default to **live** when the source is fast and freshness matters; switch to an **extract** when query latency, offline use, or relieving load on the source database dominates; recommend **publishing** the moment more than one workbook depends on the same fields and refresh. For the extract/publish mechanics, see the tactics companion.

---

## The Tableau Data Model: Relationships vs. Joins

### Relationships (recommended default)

Relationships are the modern way to connect multiple tables in Tableau (introduced in 2020.2). They are the default option in the data model.

**How they work:**
- Tables stay separate — Tableau queries each at the right level of detail and merges results
- No row duplication (no fan-out/chasm trap)
- Measures from each table aggregate correctly at their own grain
- Null behavior is handled gracefully

**When to use:** whenever you're connecting two or more tables that each have their own grain (e.g., Orders and Customers, Transactions and Dates).

### Joins (legacy / specific use cases)

Joins flatten multiple tables into a single combined table at query time.

**Downsides:**
- Fan-out: joining a fact table to a dimension with multiple matching rows duplicates rows, inflating SUM aggregates
- Chasm trap: joining two fact tables through a shared dimension can produce cartesian products

**When joins are still appropriate:**
- Combining columns from tables with a strict 1:1 row relationship
- Using data sources that don't support relationships (some older connector types)
- When the customer needs a cross-database join (two different databases)

**Push-back rule:** if someone reaches for a join to combine tables of different grain "because that's how SQL does it," steer them to a relationship instead — the join will silently inflate their SUMs via fan-out. Reserve joins for strict 1:1 column-stitching, unsupported connectors, or cross-database needs. For where joins are configured (the physical layer), see the tactics companion.

---

## Custom SQL Datasources

Some customers connect to databases using a **custom SQL query** instead of selecting tables. Tableau can use these as a datasource.

**Pros:** lets customers use views, CTEs, complex pre-aggregations, or SQL expressions that Tableau can't express natively.

**Cons:** blocks Tableau's query optimizer; hides the data model; aggregations computed in SQL can't be re-sliced by Tableau dimensions without re-running the SQL; prevents using relationships.

**Push-back rule:** accept custom SQL only when it does something Tableau genuinely cannot express natively (a CTE, a view, a window pre-aggregation the customer truly needs). If the SQL exists only to compute a column or a `GROUP BY` rollup, that logic belongs in a Tableau calculated field or `FIXED` LOD instead — keeping it in SQL throws away re-slicing and optimization for no benefit. For where to enter custom SQL, see the tactics companion.

### Refactoring Custom SQL to Native Tables

When a customer has a custom SQL datasource and wants to modernize it, the goal is to replace the SQL with native table connections using relationships.

**Step-by-step:**
1. **Read the SQL** to identify the physical tables (FROM and JOIN clauses) and the join keys
2. **Identify computed columns** — any `CASE`, `SUM() GROUP BY`, window functions, or derived expressions become Tableau calculated fields
3. **Set up the native connection** — add each table and define relationships using the identified join keys
4. **Translate computed columns** — see `expertise://tableau/tactics/data/sql-translation` for the SQL → Tableau lookup table
5. **Validate** — build side-by-side comparison views on the old vs. new datasource, checking that totals and breakdowns match

**Validation approach:** create one worksheet showing a key metric using the old custom SQL datasource, and a matching worksheet using the new native datasource. Place both on a dashboard and compare totals and per-dimension breakdowns.

---

## Published vs. Embedded Datasources

| | Embedded (in-workbook) | Published (on server) |
|---|---|---|
| Location | Stored inside the `.twb`/`.twbx` | Separate object on Tableau Server/Cloud |
| Sharing | Workbook carries the connection | Multiple workbooks can share one source |
| Governance | Each workbook has its own copy | Certified single source; updates propagate |
| Extract refresh | Scheduled per-workbook | One refresh schedule applies to all users |
| Best for | One-off or personal analysis | Shared, governed organizational data |

**When to recommend publishing a datasource:** if two or more workbooks use the same data (same fields, same extract), the customer should publish it once. Otherwise every workbook has its own refresh schedule and definition to maintain.

### Connecting to a Published Datasource via XML (sqlproxy)

**Confirmed working pattern (field-tested 2026-06-22).**

Use `class='sqlproxy'` with the datasource's `contentUrl` slug (not its LUID) as `dbname`. The `server` and `site` values come from the Tableau Server/Cloud config.

```xml
<datasource caption='My Published DS' inline='true' name='federated.mypubds01'>
  <connection class='sqlproxy'
              dbname='MyDatasourceContentUrl'
              server='https://10az.online.tableau.com/'
              site='mysitename' />
</datasource>
```

**Getting the `contentUrl`:** the LUID (the UUID you get from a datasource list response or the REST API list endpoint) is **not** the same as `contentUrl`. Retrieve it via the REST API:

```
GET /api/{version}/sites/{siteId}/datasources/{luid}
→ <datasource contentUrl="MyDatasourceContentUrl" ... />
```

**Key rules:**

| Attribute | Value |
|---|---|
| `class` | `sqlproxy` (always, for published datasources) |
| `dbname` | `contentUrl` slug from the REST API — **not** the LUID |
| `server` | Full Tableau Server/Cloud URL (e.g. `https://10az.online.tableau.com/`) |
| `site` | Site `contentUrl` (the slug after `/site/` in the browser URL; empty string for the default site) |

**What does NOT work:**
- Using the LUID as `dbname` → Tableau throws `errorCode=11` ("Datasource with URL ... could not be found")
- Omitting `server` or `site` → Tableau prompts the user to edit the connection

**Limitations:** Tableau Desktop must already be signed in to the server, or it will prompt for credentials on load. Programmatic authentication is not bypassed by this XML pattern.

---

---

## Entity-Grain Scoring (RFM and Similar): a Modeling Decision

RFM (Recency, Frequency, Monetary) and similar customer-scoring techniques are the classic case where the *datasource grain* and the *analysis grain* diverge, and that divergence drives the modeling choice. The transactional source has one row per opportunity/order, but the question — "how valuable is this account?" — is per-account. That mismatch is exactly what `FIXED` LOD exists for.

**The strategic calls:**
- **Score at the entity grain, not the view grain.** Each base metric (recency, frequency, monetary) must be a per-account `FIXED` LOD so the value is stable however the viz is later sliced. A view-level `SUM` gives the wrong base for scoring and shifts as filters change.
- **Take cutoffs from the distribution.** Range- or percentile-based 1–5 scoring needs table-scoped `{FIXED : MIN/MAX}` (or `PERCENTILE`) over the per-account values — compute the entity values first, then the global distribution over them. Prefer percentile cutoffs over linear range-mapping when the distribution is skewed (see the calc-fields strategy file).
- **Guard the data-quality assumptions.** Filters like `Stage = 'Closed Won'` inside the LOD are case- and whitespace-sensitive; a near-miss returns all nulls. Confirm the literal matches the data before trusting the scores.

For the concrete base-metric, 1–5 scoring, and segment-label formulas, see `expertise://tableau/tactics/data/lod-and-table-calc-patterns` (RFM Segmentation section).

---

## Best Practices

- **Prefer relationships over joins** for multi-table datasources. Relationships handle grain differences correctly without row duplication.
- **Use published datasources for shared organizational data.** Embed datasources only for personal or one-off analysis.
- **Avoid custom SQL unless necessary.** It blocks query optimization and makes the data model opaque. If the SQL only exists to define a computed column, turn that into a Tableau calculated field instead.
- **For RFM or similar per-entity scoring, use FIXED LOD.** The per-account aggregation must be done at the account grain — a view-level SUM doesn't give you the right base for scoring.

---

## Common Mistakes

1. **Using joins when relationships would work.** Joins inflate row counts when the join key isn't 1:1. Relationships avoid this automatically.
2. **Custom SQL with a GROUP BY aggregating the data before Tableau can slice it.** Once data is pre-aggregated in SQL, Tableau can't disaggregate it — you lose the ability to drill down. Move the aggregation into a FIXED LOD so Tableau can re-aggregate at any level.
3. **Mixing published and embedded datasources on the same dashboard without realizing it.** Cross-datasource calculations won't work, and the field names in each source may not match for blending.
4. **RFM scores returning null or 0 for all accounts.** Check whether the `Stage = 'Closed Won'` filter in the FIXED LOD returns any results — if the stage name has a different case or whitespace, the LOD returns all nulls.
5. **Not validating after a custom SQL to native tables migration.** Always build side-by-side comparison views before decommissioning the old datasource.

---

## Implementation

This is a decision/governance workflow, not a connection-editing recipe:

1. **Establish freshness, performance, and sharing needs first** — they decide live vs. extract vs. published before any table is touched.
2. **Map the grains.** List each table's grain and the analysis grain. Different grains → relationships; strict 1:1 column-stitching → a join; entity-vs-transaction mismatch → `FIXED` LOD scoring.
3. **Interrogate any custom SQL.** Does it do something Tableau cannot? If not, plan to refactor it to native tables + calculated fields, and validate side-by-side before decommissioning.
4. **Recommend governance.** If more than one workbook needs the data, recommend publishing once rather than embedding copies.
5. **Hand off to mechanics.** Once the model is decided, build the connection, relationships, and extracts using `expertise://tableau/tactics/data/datasources`, then verify totals and breakdowns in Tableau.

## Source and Confidence

- Source/evidence type: SME-authored reference
- Source: Tableau datasource-modeling best practice (relationships vs joins, custom-SQL refactoring, RFM scoring) from SE consulting experience Published-datasource sqlproxy XML pattern contributed by @bhartSF (PR #101).
- Customer-identifying details removed: yes
- Confidence: SME-reviewed
- Last reviewed: 2026-07-02
