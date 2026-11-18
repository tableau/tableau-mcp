---
sidebar_position: 3
---

# List Pulse Metrics from Metric Definition ID

{/* availability */}
<span className="toolAvailability">Available June 2026 and later.</span>
{/* /availability */}

Retrieves a list of published Pulse metrics for a single Pulse metric definition. Use this tool
when a user wants the metrics that belong to a specific Pulse metric definition on the current site.

## Access requirements

- **User/site role:** `Viewer` or higher in the MCP role hierarchy; Tableau content
  permissions and site capabilities also apply.
- **Declared registration minimum:** `Viewer`. See [role enforcement](../overview.md#role-enforcement)
  for when this filters the tool list and which roles qualify.
- **Registration conditions:** `RequiresPulse`.
  See [site capabilities](../overview.md#site-capabilities) for what is checked.

## APIs called

This tool reads from the Tableau REST API (Tableau Cloud or Server) through its Pulse endpoints. It
requires the `tableau:mcp:pulse:read` MCP scope. The MCP-layer OAuth gate requires the union of the
scope cited on the operation below (`tableau:insight_definitions_metrics:read`) plus
`tableau:mcp_site_settings:read`, which is used to read per-site MCP configuration overrides (e.g. the
datasource scoping that filters the returned metrics) when MCP site settings are enabled.

- **List the metrics for the definition.** Reads the published Pulse metrics that belong to the
  supplied metric definition ID.
  - `GET /api/-/pulse/definitions/{pulseMetricDefinitionID}/metrics` — list the definition's metrics.
    Issued against the Pulse API; requires the `tableau:insight_definitions_metrics:read` OAuth scope.
    [List metrics in definition](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_pulse.htm#MetricQueryService_ListMetrics)

## Required arguments

### `pulseMetricDefinitionID`

The ID of the Pulse metric definition to list metrics for — the definition's ID, not its name. Must
be a 36-character ID, potentially retrieved by the
[List All Metric Definitions](list-all-pulse-metric-definitions.md) or
[List Metric Definitions](list-pulse-metric-definitions-from-definition-ids.md) tool.

#### Example

```json
{ "pulseMetricDefinitionID": "9ad098f4-49cf-4e8a-bec0-0ca803091dd0" }
```

## Notes and caveats

:::note[Data caveats]
When the site's MCP configuration limits queries to a bounded set of datasources, metrics whose
datasource is not in the allowed set are filtered out of the result. If every returned metric is
filtered out this way, the tool reports that no metrics are available rather than an empty list.
:::

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

- [`list-all-pulse-metric-definitions`](list-all-pulse-metric-definitions.md) — list all Pulse metric definitions to find a definition ID
- [`list-pulse-metric-definitions-from-definition-ids`](list-pulse-metric-definitions-from-definition-ids.md) — fetch specific metric definitions by ID
- [`list-pulse-metrics-from-metric-ids`](list-pulse-metrics-from-metric-ids.md) — fetch specific metrics by their metric IDs
- [`list-pulse-metric-subscriptions`](list-pulse-metric-subscriptions.md) — list the current user's Pulse metric subscriptions
