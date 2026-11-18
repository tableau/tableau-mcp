---
sidebar_position: 4
---

# List Pulse Metrics from Metric IDs

{/* availability */}
<span className="toolAvailability">Available June 2026 and later.</span>
{/* /availability */}

Retrieves a list of published Pulse metrics for a list of metric IDs on the current
site. Use it to resolve a set of known metric IDs — for example, the `metric_id`
values returned by a Pulse metric subscription — into their full metric records.
This tool is read-only.

## Access requirements

- **User/site role:** `Viewer` or higher in the MCP role hierarchy; Tableau content
  permissions and site capabilities also apply.
- **Declared registration minimum:** `Viewer`. See [role enforcement](../overview.md#role-enforcement)
  for when this filters the tool list and which roles qualify.
- **Registration conditions:** `RequiresPulse`.
  See [site capabilities](../overview.md#site-capabilities) for what is checked.

## APIs called

Talks to the **Tableau REST API** (Tableau Cloud or Server), specifically its
**Pulse** endpoints, to batch-fetch the metric records for the supplied IDs. The
MCP-layer OAuth gate requires the `tableau:insight_metrics:read` scope cited per
operation below, plus `tableau:mcp_site_settings:read` to read per-site MCP
configuration overrides (e.g. data source [tool scoping](../../configuration/mcp-config/tool-scoping.md))
when MCP site settings are enabled.

- **Batch-fetch the Pulse metrics for the given IDs.** Returns the full metric record
  for each requested metric ID in a single call.
  - `POST /api/-/pulse/metrics:batchGet` — return the metric records for the requested
    metric IDs. Issued against the Tableau REST API's Pulse endpoints; requires the
    `tableau:insight_metrics:read` OAuth scope.
    [Batch list metrics](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_pulse.htm#MetricQueryService_BatchGetMetricsByPost)

## Required arguments

### `metricIds`

The list of Pulse metric IDs to list metrics for — the metric IDs themselves, not
metric names or metric definition IDs. Each ID is a 36-character metric ID. These IDs
can come from the
[List Metrics for Definition](list-pulse-metrics-from-metric-definition-id.md) tool or
the [List Metric Subscriptions](list-pulse-metric-subscriptions.md) tool (use the
`metric_id` field of a subscription).

#### Example

```json
{ "metricIds": ["fd6c4aa0-f6d3-469e-b75b-d597435ae199"] }
```

## Notes and caveats

- When data source [tool scoping](../../configuration/mcp-config/tool-scoping.md) is
  configured for the site, metrics whose data source is not in the allowed set are
  filtered out of the result; if every returned metric is filtered, the tool reports
  that none are available.

## Example result

```json
[
  {
    "id": "fd6c4aa0-f6d3-469e-b75b-d597435ae199",
    "specification": {
      "filters": [],
      "measurement_period": {
        "granularity": "GRANULARITY_BY_MONTH",
        "range": "RANGE_CURRENT_PARTIAL"
      },
      "comparison": {
        "comparison": "TIME_COMPARISON_PREVIOUS_PERIOD"
      }
    },
    "definition_id": "9ad098f4-49cf-4e8a-bec0-0ca803091dd0",
    "is_default": true,
    "schema_version": "1.0.0",
    "metric_version": 2,
    "is_followed": true
  }
]
```

## Related

- [`list-pulse-metric-subscriptions`](list-pulse-metric-subscriptions.md) — list the current user's Pulse metric subscriptions, whose `metric_id` values feed this tool
- [`list-pulse-metrics-from-metric-definition-id`](list-pulse-metrics-from-metric-definition-id.md) — list the metrics belonging to a single Pulse metric definition
