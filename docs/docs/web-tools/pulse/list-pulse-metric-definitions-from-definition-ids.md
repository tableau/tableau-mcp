---
sidebar_position: 2
---

# List Pulse Metric Definitions from Metric Definition IDs

{/* availability */}
<span className="toolAvailability">Available June 2026 and later.</span>
{/* /availability */}

Retrieves a list of specific Pulse metric definitions from a list of metric definition IDs. Use it
when you already know the definition IDs (for example, from the
[`list-all-pulse-metric-definitions`](list-all-pulse-metric-definitions.md) tool) and want the full
definition records for just those IDs.

## Access requirements

- **User/site role:** `Viewer` or higher in the MCP role hierarchy; Tableau content
  permissions and site capabilities also apply.
- **Declared registration minimum:** `Viewer`. See [role enforcement](../overview.md#role-enforcement)
  for when this filters the tool list and which roles qualify.
- **Registration conditions:** `RequiresPulse`.
  See [site capabilities](../overview.md#site-capabilities) for what is checked.

## APIs called

This tool reads Pulse metric definitions from Tableau's Pulse REST API (on Tableau Cloud or Server),
fetching every requested definition in a single batch request. It is gated by the
`tableau:mcp:pulse:read` MCP scope, and additionally reads per-site MCP configuration through the
`tableau:mcp_site_settings:read` OAuth scope.

- Batch-retrieve the specified Pulse metric definitions by their definition IDs, honoring the
  optional `view`. Issued against the Pulse REST API; requires the
  `tableau:insight_definitions_metrics:read` OAuth scope.
  - `POST /api/-/pulse/definitions:batchGet` — batch-retrieve the metric definitions for the supplied IDs. [Batch list metric definitions](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_pulse.htm#MetricQueryService_BatchGetDefinitionsByPost)

## Required arguments

### `metricDefinitionIds`

The list of metric definition IDs to retrieve, each a 36-character definition ID (for example, one
returned by the [`list-all-pulse-metric-definitions`](list-all-pulse-metric-definitions.md) tool). At
least one ID is required.

#### Example

```json
{ "metricDefinitionIds": ["9ad098f4-49cf-4e8a-bec0-0ca803091dd0"] }
```

## Optional arguments

### `view`

The range of metrics to return for a definition. Defaults to `DEFINITION_VIEW_BASIC` if not
specified.

Possible values:

| Value                     | Description                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------- |
| `DEFINITION_VIEW_BASIC`   | Return only the specified metric definition. This is the default if not specified. |
| `DEFINITION_VIEW_FULL`    | Return the metric definition and the specified number of metrics.                  |
| `DEFINITION_VIEW_DEFAULT` | Return the metric definition and the default metric.                               |

:::note[Full view metric cap]
With `DEFINITION_VIEW_FULL`, the response includes at most 5 metrics per definition. To see more
metrics for a definition, retrieve them with the
[`list-pulse-metrics-from-metric-definition-id`](list-pulse-metrics-from-metric-definition-id.md)
tool.
:::

## Example result

```json
[
  {
    "metadata": {
      "name": "Tableau MCP",
      "description": "",
      "id": "9ad098f4-49cf-4e8a-bec0-0ca803091dd0",
      "schema_version": "1.0.0",
      "metric_version": 1,
      "definition_version": 0
    },
    "specification": {
      "datasource": {
        "id": "2d935df8-fe7e-4fd8-bb14-35eb4ba31d45"
      },
      "basic_specification": {
        "measure": {
          "field": "Profit",
          "aggregation": "AGGREGATION_SUM"
        },
        "time_dimension": {
          "field": "Order Date"
        },
        "filters": []
      },
      "is_running_total": true
    },
    "extension_options": {
      "allowed_dimensions": ["City"],
      "allowed_granularities": [
        "GRANULARITY_BY_DAY",
        "GRANULARITY_BY_WEEK",
        "GRANULARITY_BY_MONTH",
        "GRANULARITY_BY_QUARTER",
        "GRANULARITY_BY_YEAR"
      ],
      "offset_from_today": 0
    },
    "metrics": [],
    "total_metrics": 1,
    "representation_options": {
      "type": "NUMBER_FORMAT_TYPE_NUMBER",
      "number_units": {
        "singular_noun": "",
        "plural_noun": ""
      },
      "sentiment_type": "SENTIMENT_TYPE_NONE",
      "row_level_id_field": {
        "identifier_col": "City"
      },
      "row_level_entity_names": {
        "entity_name_singular": "",
        "entity_name_plural": ""
      },
      "row_level_name_field": {
        "name_col": ""
      },
      "currency_code": "CURRENCY_CODE_UNSPECIFIED"
    },
    "insights_options": {
      "settings": [
        {
          "type": "INSIGHT_TYPE_RISKY_MONOPOLY",
          "disabled": false
        },
        {
          "type": "INSIGHT_TYPE_TOP_DRIVERS",
          "disabled": false
        },
        {
          "type": "INSIGHT_TYPE_CURRENT_TREND",
          "disabled": false
        },
        {
          "type": "INSIGHT_TYPE_BOTTOM_CONTRIBUTORS",
          "disabled": false
        },
        {
          "type": "INSIGHT_TYPE_TOP_DETRACTORS",
          "disabled": false
        },
        {
          "type": "INSIGHT_TYPE_NEW_TREND",
          "disabled": false
        },
        {
          "type": "INSIGHT_TYPE_UNUSUAL_CHANGE",
          "disabled": false
        },
        {
          "type": "INSIGHT_TYPE_RECORD_LEVEL_OUTLIERS",
          "disabled": false
        },
        {
          "type": "INSIGHT_TYPE_CORRELATED_METRIC",
          "disabled": false
        }
      ]
    },
    "comparisons": {
      "comparisons": [
        {
          "compare_config": {
            "comparison": "TIME_COMPARISON_PREVIOUS_PERIOD"
          },
          "index": 0
        },
        {
          "compare_config": {
            "comparison": "TIME_COMPARISON_YEAR_AGO_PERIOD"
          },
          "index": 1
        }
      ]
    },
    "datasource_goals": []
  }
]
```

## Related

- [`list-all-pulse-metric-definitions`](list-all-pulse-metric-definitions.md) — list every published metric definition to obtain the IDs to pass here
- [`list-pulse-metrics-from-metric-definition-id`](list-pulse-metrics-from-metric-definition-id.md) — list the published metrics under a single definition
