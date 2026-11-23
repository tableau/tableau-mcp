---
sidebar_position: 1
---

# List All Pulse Metric Definitions

{/* availability */}
<span className="toolAvailability">Available June 2026 and later.</span>
{/* /availability */}

Retrieves a list of all published Tableau Pulse metric definitions on the current site. Results are
fetched page by page and returned as a single combined list, capped by the effective result limit.

:::note[Pulse must be enabled]
These metric-definition calls require Tableau Pulse to be available on the current site. When Pulse
is not enabled for the site, the tool reports that Pulse is unavailable instead of returning
definitions.
:::

## APIs called

This tool talks to the **Tableau REST API** (Tableau Cloud or Server) via its Pulse endpoints. The
MCP-layer OAuth gate requires `tableau:mcp:pulse:read`; the underlying call needs the
`tableau:insight_definitions_metrics:read` OAuth scope, plus `tableau:mcp_site_settings:read` to read
per-site MCP configuration overrides (e.g.
[`MAX_RESULT_LIMIT`](../../configuration/mcp-config/env-vars.md#max_result_limit)) when MCP site
settings are enabled.

- **List all published Pulse metric definitions.** Pages through every metric definition on the
  current site and returns the combined list.
  - `GET /api/-/pulse/definitions` — list the published metric definitions (paginated via
    `page_token` / `page_size`). Issued against the Tableau REST API (Pulse); requires the
    `tableau:insight_definitions_metrics:read` OAuth scope.
    [List Metric Definitions](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_pulse.htm#MetricQueryService_ListDefinitions)

## Optional arguments

### `view`

The range of metrics to return for a definition. Defaults to `DEFINITION_VIEW_BASIC`.

Possible values:

| Value                     | Description                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------- |
| `DEFINITION_VIEW_BASIC`   | Return only the specified metric definition. This is the default if not specified. |
| `DEFINITION_VIEW_FULL`    | Return the metric definition and the specified number of metrics.                  |
| `DEFINITION_VIEW_DEFAULT` | Return the metric definition and the default metric.                               |

:::note[Full view returns a capped set of metrics]
With `DEFINITION_VIEW_FULL`, each definition includes only a limited number of its metrics. To
retrieve the full set of metrics for a definition, use
[`list-pulse-metrics-from-metric-definition-id`](list-pulse-metrics-from-metric-definition-id.md).
:::

<hr />

### `limit`

The maximum number of metric definitions to return. The tool returns at most this many definitions;
the effective cap is the tighter of this value and the server-configured result limit.

Example: `2000`

See also: [`MAX_RESULT_LIMIT`](../../configuration/mcp-config/env-vars.md#max_result_limit)

<hr />

### `pageSize`

The number of results per page. Controls how many definitions are fetched in each API request during
pagination.

Example: `25`

:::note
Optional. If not specified, the API uses its default page size of 10 definitions. Provide a larger
value if you know in advance that you have more than 10 definitions to retrieve.
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

- [`list-pulse-metric-definitions-from-definition-ids`](list-pulse-metric-definitions-from-definition-ids.md) — fetch specific definitions by their IDs
- [`list-pulse-metrics-from-metric-definition-id`](list-pulse-metrics-from-metric-definition-id.md) — list the metrics under a definition
