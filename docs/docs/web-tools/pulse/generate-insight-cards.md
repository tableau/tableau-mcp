---
sidebar_position: 8
---

# Generate Insight Cards

Generates a set of deterministic, governed **insight cards** for a published data source. Each card
summarizes one numeric measure's period-over-period movement (current month-to-date vs. the prior
period), the top contributing dimension members, where the change is most and least pronounced, what
is unusual, and suggested follow-ups. A single call fans out across the REST API, the VizQL Data
Service, and the Pulse Insights service, issuing one Pulse bundle request per measure.

:::warning[Disabled by default]
Registered only when
`INSIGHTS_TOOLS_ENABLED``=true`.
When the
flag is unset the tool is not registered and is unavailable to callers. Once enabled, it can be
scoped further with [`INCLUDE_TOOLS`](../../configuration/mcp-config/env-vars.md#include_tools) /
[`EXCLUDE_TOOLS`](../../configuration/mcp-config/env-vars.md#exclude_tools) (its tool group is
`insights`, e.g. `INCLUDE_TOOLS=insights`).
:::

## Access requirements

- **User/site role:** `Viewer` or higher in the MCP role hierarchy; Tableau content
  permissions and site capabilities also apply.
- **Declared registration minimum:** `Viewer`. See [role enforcement](../overview.md#role-enforcement)
  for when this filters the tool list and which roles qualify.
- **Availability:** `INSIGHTS_TOOLS_ENABLED=true`, VizQL Data Service access, and Pulse access.
- **Registration conditions:** `RequiresPulse`, `RequiresPulsePremium`.
  See [site capabilities](../overview.md#site-capabilities) for what is checked.

## APIs called

This tool talks to the **Tableau REST API** (Tableau Cloud or Server), the **VizQL Data Service
(VDS)** API, and the **Pulse Insights** service. It resolves the data source, reads its field
metadata to pick a time field and measures, then requests one Pulse bundle per measure. The
MCP-layer OAuth gate requires the `tableau:mcp:insight:create` and `tableau:mcp:datasource:read`
scopes; the union of Tableau API scopes it uses is `tableau:content:read`,
`tableau:viz_data_service:read`, `tableau:insights:read`, and `tableau:mcp_site_settings:read`.

- **Resolve the data source.** Turns the `datasource` argument into a LUID and display name. The
  bounded-context allow-list is enforced here, before any metadata or Pulse call.
  - `GET /api/{version}/sites/{siteId}/datasources?filter=contentUrl:eq:<contentUrl>` — resolve a
    content URL string to a data source. Issued against the Tableau REST API; requires the
    `tableau:content:read` OAuth scope.
    [Query Data Sources](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#query_data_sources)
  - `GET /api/{version}/sites/{siteId}/datasources/{datasourceId}` — look up the display name when
    `datasource` is given as `{ luid }`. Issued against the Tableau REST API; requires the
    `tableau:content:read` OAuth scope.
    [Query Data Source](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#query_data_source)
- **Read the data source's field metadata.** Enumerates fields and their data types to auto-select
  the time field, measures, and dimensions, and to validate any caller-supplied overrides before
  calling Pulse.
  - `POST /api/v1/vizql-data-service/read-metadata` — request the data source's field metadata.
    Issued against the VizQL Data Service (VDS) API; requires the `tableau:viz_data_service:read`
    OAuth scope.
    [Request data source metadata](https://help.tableau.com/current/api/vizql-data-service/en-us/reference/index.html#tag/HeadlessBI/operation/ReadMetadata)
- **Generate the insight bundle for each selected measure.** Called once per measure to build the
  card's trend, contributors, and insight text.
  - `POST /api/-/pulse/insights/detail` — generate the `detail` bundle for one measure. Issued
    against the Tableau REST API Pulse Insights service; requires the `tableau:insights:read` OAuth
    scope. Pulse is served at the fixed `/api/-` base, not a `{version}` path.
    [Detail](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_pulse.htm#PulseInsightsService_GenerateInsightBundleDetail)

`tableau:mcp_site_settings:read` is used across these calls to read per-site MCP configuration
overrides when MCP site settings are enabled.

## Required arguments

### `datasource`

The published data source to build cards for, given either as an exact, case-sensitive `contentUrl`
string, or as an object `{ luid }`.

#### Example

```json
"Superstore"
```

```json
{ "luid": "2d935df8-fe7e-4fd8-bb14-35eb4ba31d45" }
```

:::note[Bounded context]
When the server limits which data sources may be queried, a data source outside the allowed set
resolves to the same "could not resolve" outcome as one that does not exist — there is no existence
oracle for non-allowed data sources, and no metadata or Pulse call runs for them.
:::

:::note
The tool refuses with one of these messages. Could not resolve datasource from provided input. Could not determine a DATE/DATETIME time field for this datasource. Could not determine numeric measures for this datasource. timeField "the supplied caption" is not a DATE/DATETIME field in this datasource. measure "the supplied caption" is not a numeric field in this datasource. filter field "the supplied field" is not a categorical field in this datasource.
:::

## Optional arguments

### `measures`

Array of numeric field captions to build cards for. When omitted, the tool deterministically picks
the alphabetically-first numeric (`INTEGER`/`REAL`) fields, up to `maxCards`. Each supplied measure
is validated against the data source metadata (it must be a numeric field) before any Pulse call.

<hr />

### `timeField`

The `DATE`/`DATETIME` field caption to trend against. When omitted, the alphabetically-first
`DATE`/`DATETIME` field is used. A supplied value is validated against the metadata.

<hr />

### `maxCards`

The maximum number of measures (and therefore cards) to produce. Integer between 1 and 10. Defaults
to `4`.

<hr />

### `breakdownDimension`

A single categorical (`STRING`) field caption to scope the breakdown group to. When omitted, up to
the first five categorical fields are used as the active dimension set. Validated against the
metadata.

:::note
breakdownDimension "the supplied caption" is not a categorical field in this datasource.
:::

<hr />

### `filters`

Array of `{ field, value }` categorical equality filters that scope the metric instance to specific
dimension members (drill-down). Each `field` must be a categorical field in the data source.

#### Example

```json
[{ "field": "Region", "value": "West" }]
```

## Notes and caveats

- Every card's `provenance` is `governed`. The only non-governed fields are the static `actions`
  button labels.
- `warnings` reports measures whose bundle call failed while others succeeded (partial failure). If
  **every** measure fails, the tool returns the first bundle error instead of an empty success, so a
  Pulse contract failure is not mistaken for a legitimately empty data source.
- `briefConfig` echoes the exact
  [`generate-pulse-metric-value-insight-bundle`](generate-pulse-metric-value-insight-bundle.md) call
  that produced the card, so a client can re-run or deep-link the underlying bundle.
- Measure aggregation is summed (`AGGREGATION_SUM`), and the measurement period is fixed to the
  current partial month compared with the previous period.

## Example result

```json
{
  "datasource": {
    "luid": "2d935df8-fe7e-4fd8-bb14-35eb4ba31d45",
    "contentUrl": "Superstore",
    "name": "Superstore"
  },
  "dimensions": ["Region", "Segment", "Category"],
  "cards": [
    {
      "id": "2d935df8-fe7e-4fd8-bb14-35eb4ba31d45:Sales:trend",
      "measure": "Sales",
      "timeField": "Order Date",
      "label": "Sales vs prior period",
      "headline": "1.2M",
      "deltaPct": 5,
      "direction": "up",
      "explanation": "Sales up 5% month to date compared to the prior period.",
      "context": "3× the trailing average of +4%",
      "comparison": {
        "current": { "label": "May 2026", "subLabel": "MTD", "value": 1200000, "formatted": "1.2M" },
        "prior": { "label": "Apr 2026", "subLabel": "", "value": 1140000, "formatted": "1.1M" }
      },
      "series": [
        { "date": "2026-05-01", "label": "May 1", "value": 100, "lower": 90, "upper": 110, "dashed": false }
      ],
      "breakdown": [{ "label": "West", "value": 500 }],
      "breakdownDimension": "Region",
      "contributors": [
        { "label": "West", "value": 500, "formatted": "$500", "sharePct": 40 }
      ],
      "pronounced": {
        "strongest": { "label": "West", "value": 12, "formatted": "+12%" },
        "weakest": { "label": "East", "value": -3, "formatted": "-3%" }
      },
      "unusual": { "text": "Within the expected range considering seasonal patterns.", "factor": null, "baselineWindow": null },
      "followUps": ["What's driving West?", "Compare across Region"],
      "actions": [{ "id": "drill", "label": "Drill into this", "primary": true }],
      "provenance": "governed",
      "briefConfig": {
        "tool": "generate-pulse-metric-value-insight-bundle",
        "args": { "bundleRequest": {}, "bundleType": "detail" }
      }
    }
  ],
  "warnings": [{ "measure": "Profit", "error": "..." }]
}
```

## Related

- [`generate-pulse-metric-value-insight-bundle`](generate-pulse-metric-value-insight-bundle.md) — the per-measure Pulse primitive this tool orchestrates
- [`query-datasource`](../data-qna/query-datasource.md) — same VizQL Data Service metadata path
