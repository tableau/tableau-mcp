---
sidebar_position: 3
---

# List Metrics for Definition

Retrieves a list of published Pulse metrics from a Pulse metric definition ID.

## APIs called

- [List metrics in definition](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_pulse.htm#MetricQueryService_ListMetrics)

## Required arguments

### `pulseMetricDefinitionID`

The ID of the Pulse metric definition to list metrics for potentially retrieved by the
[List All Metric Definitions](list-all-pulse-metric-definitions.md) or
[List Metric Definitions](list-pulse-metric-definitions-from-definition-ids.md) tool.

Example: `9ad098f4-49cf-4e8a-bec0-0ca803091dd0`

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
