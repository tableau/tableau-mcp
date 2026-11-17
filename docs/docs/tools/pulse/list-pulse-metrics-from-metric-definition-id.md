---
sidebar_position: 3
---

# List Metrics for Definition

Retrieves a list of published Pulse metrics from a Pulse metric definition ID.

Follows REST continuation tokens automatically and returns the existing metric array. The result is
bounded by `limit`, the server's configured result limit, caller permissions and content
restrictions. `pageSize` controls each request, not the total. A definition's reported metric count
can differ from the visible result because of permissions, follower filtering or configured limits.

## APIs called

- [List metrics in definition](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_pulse.htm#MetricQueryService_ListMetrics)

## Required arguments

### `pulseMetricDefinitionID`

The ID of the Pulse metric definition to list metrics for potentially retrieved by the
[List All Metric Definitions](list-all-pulse-metric-definitions.md) or
[List Metric Definitions](list-pulse-metric-definitions-from-definition-ids.md) tool.

Example: `9ad098f4-49cf-4e8a-bec0-0ca803091dd0`

## Optional arguments

### `limit`

Positive integer maximum number of metrics to return. The lower of this value and the configured
server result limit applies. Omit it to retrieve every visible page allowed by the server limit.

### `pageSize`

Positive integer number of metrics per REST request. Omission uses the API's initial default page
size; the paginator can adjust subsequent requests using the reported total and remaining limit.

### `excludeMetricsWithoutFollowers`

Set `false` to include metrics without followers, or `true` to exclude them. Omission preserves the
REST API default. This setting does not bypass permissions or configured content restrictions.

For an inventory, use the same follower setting when comparing REST pages and reported counts. A
failure on a later page returns an error instead of a successful first-page array.

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
