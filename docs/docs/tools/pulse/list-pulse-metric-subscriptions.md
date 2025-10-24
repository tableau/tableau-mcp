---
sidebar_position: 5
---

# List Metric Subscriptions

Retrieves a list of published Pulse Metric Subscriptions for the current user.

## APIs called

- [List subscriptions](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_pulse.htm#PulseSubscriptionService_ListSubscriptions)
- [Batch list metrics](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_pulse.htm#MetricQueryService_BatchGetMetricsByPost)
  (if data source [tool scoping](../../configuration/mcp-config/tool-scoping.md) is enabled)

## Example result

```json
[
  {
    "id": "47ec9252-0ac2-4b30-9a4f-af28554cc893",
    "metric_id": "fd6c4aa0-f6d3-469e-b75b-d597435ae199"
  }
]
```
