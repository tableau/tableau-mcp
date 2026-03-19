---
sidebar_position: 4
---

# List Metrics

Retrieves a list of published Pulse metrics from a list of metric IDs.

## APIs called

- [Batch list metrics](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_pulse.htm#MetricQueryService_BatchGetMetricsByPost)

## Required arguments

### `metricIds`

The list of metric IDs potentially retrieved by the
[List Metrics for Definition](list-pulse-metrics-from-metric-definition-id.md) or
[List Metric Subscriptions](list-pulse-metric-subscriptions.md) tool.

Example: `["fd6c4aa0-f6d3-469e-b75b-d597435ae199"]`

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
