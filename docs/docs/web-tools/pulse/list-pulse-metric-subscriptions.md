---
sidebar_position: 5
---

# List Pulse Metric Subscriptions for Current User

{/* availability */}
<span className="toolAvailability">Available June 2026 and later.</span>
{/* /availability */}

Retrieves a list of published Pulse Metric Subscriptions for the current user.

## APIs called

Talks to the Tableau REST API (Tableau Cloud or Server) Pulse endpoints. The MCP-layer OAuth
gate requires the `tableau:mcp:pulse:read` scope; reading the effective per-site configuration to
determine data source scoping requires the `tableau:mcp_site_settings:read` scope.

- List the current user's published Pulse Metric Subscriptions.
  - `GET /pulse/subscriptions` — retrieve the subscriptions for the current user. Issued against
    the Tableau REST API Pulse endpoints; requires the `tableau:metric_subscriptions:read` OAuth
    scope. [List Subscriptions](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_pulse.htm#PulseSubscriptionService_ListSubscriptions)
- When data source [tool scoping](../../configuration/mcp-config/tool-scoping.md) is enabled,
  batch-fetch the metrics referenced by those subscriptions so subscriptions whose metric's data
  source is out of scope can be filtered out.
  - `POST /pulse/metrics:batchGet` — fetch the metrics for the subscribed metric IDs. Issued
    against the Tableau REST API Pulse endpoints; requires the `tableau:insight_metrics:read` OAuth
    scope. [Batch Get Metrics](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_pulse.htm#MetricQueryService_BatchGetMetricsByPost)

## Notes and caveats

- This tool does not directly provide information about Pulse Metric Definitions. To resolve the
  definitions behind your subscriptions: first retrieve the Pulse Metrics from the metric IDs
  returned in the subscriptions, then retrieve the Pulse Metric Definitions from the metric
  definition ID returned in those metrics.

## Example result

```json
[
  {
    "id": "47ec9252-0ac2-4b30-9a4f-af28554cc893",
    "metric_id": "fd6c4aa0-f6d3-469e-b75b-d597435ae199"
  }
]
```

## Related

- [`list-pulse-metrics-from-metric-ids`](list-pulse-metrics-from-metric-ids.md) — resolve the
  metrics behind the `metric_id` values returned here
- [`list-pulse-metrics-from-metric-definition-id`](list-pulse-metrics-from-metric-definition-id.md) — list the metrics for a metric definition
