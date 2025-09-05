---
sidebar_position: 1
---

# List All Metric Definitions

Retrieves a list of all published Pulse Metric Definitions.

## APIs called

- [List Metric Definitions](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_pulse.htm#MetricQueryService_ListDefinitions)

## Optional arguments

### `view`

The range of metrics to return for a definition.

Possible values:

| Value                     | Description                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------- |
| `DEFINITION_VIEW_BASIC`   | Return only the specified metric definition. This is the default if not specified. |
| `DEFINITION_VIEW_FULL`    | Return the metric definition and the specified number of metrics.                  |
| `DEFINITION_VIEW_DEFAULT` | Return the metric definition and the default metric.                               |

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
