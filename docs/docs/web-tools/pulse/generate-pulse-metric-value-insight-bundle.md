---
sidebar_position: 6
---

# Generate Pulse Metric Value Insight Bundle

{/* availability */}
<span className="toolAvailability">Available June 2026 and later.</span>
{/* /availability */}

Generates an insight bundle for the current aggregated value of a Pulse metric. You supply the full
Pulse metric and Pulse metric definition information (most of it comes from data returned by the
other Pulse tools). The `bundleType` argument selects which bundle shape is generated:

- `ban` (default) — current aggregated value, period-over-period change, and the highest-ranked insight for each filterable dimension
- `basic` — like a springboard insight, but focused on low-bandwidth dimensions with small value sets
- `springboard` — current value, period-over-period change, and the highest-ranked insight for the metric
- `detail` — performance over time, a summary visualization of highs, lows, and trends, per-dimension top-contributor breakdowns, and follow-up insights
- `exploration` — performance trends with BAN, anchor, and follow-up insight groups

## APIs called

Talks to the Tableau REST API (Tableau Cloud or Server) Pulse Insights service. A single call
generates the requested bundle, with `bundleType` selecting the bundle shape via the route's path
segment. This tool is gated by the `tableau:mcp:insight:create` MCP scope; the union of Tableau API
scopes it uses is `tableau:insights:read` and `tableau:mcp_site_settings:read`.

- Generate the insight bundle for the metric's current aggregated value. Issued against the Tableau REST API Pulse Insights service; requires the `tableau:insights:read` OAuth scope (`tableau:mcp_site_settings:read` is also used to read per-site MCP configuration).
  - `POST /api/-/pulse/insights/{bundleType}` — generate the requested bundle; `{bundleType}` (`ban`, `basic`, `springboard`, `detail`, or `exploration`) selects the shape. Pulse is served at the fixed `/api/-` base, not a `{version}` path. Per-type references: [BAN](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_pulse.htm#PulseInsightsService_GenerateInsightBundleBAN), [Basic](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_pulse.htm#PulseInsightsService_GenerateInsightBundleBasic), [Springboard](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_pulse.htm#PulseInsightsService_GenerateInsightBundleSpringboard), [Detail](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_pulse.htm#PulseInsightsService_GenerateInsightBundleDetail), [Exploration](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_pulse.htm#PulseInsightsService_GenerateInsightBundleExploration)

## Required arguments

### `bundleRequest`

The request to generate a bundle for. Most of the information comes from data returned by the tools
that retrieve Pulse metric and Pulse metric definition information. When building the request, set
`options` using `output_format: 'OUTPUT_FORMAT_HTML'`, `time_zone: 'UTC'`,
`language: 'LANGUAGE_EN_US'`, and `locale: 'LOCALE_EN_US'`.

The `datasource` field under `metric.definition` requires an `id` (datasource LUID) and accepts an
optional `id_type`: omit `id_type` for standard published datasources (default), or use
`'DATASOURCE_ID_TYPE_WORKBOOK_DATASOURCE'` when the metric is based on an embedded workbook
datasource rather than a published one.

#### Anchoring the analysis to a specific date

Set `options.now` to anchor the analysis to a specific date instead of the current date, so the
bundle can target a past whole period rather than only today-relative windows. Format is
`'YYYY-MM-DD'` (or `'YYYY-MM-DD HH:MM:SS'`, 24-hour). To analyze a specific past month, set `now`
to the last day of that month with `measurement_period.range = 'RANGE_CURRENT_PARTIAL'` and
`granularity = 'GRANULARITY_BY_MONTH'` (e.g. `now: '2026-05-31'` yields the full month of May
2026); note that `RANGE_LAST_COMPLETE` targets the period *before* the anchor's period, not the
anchor's own. This shifts only the whole-period window. When `now` is set, `time_zone` is ignored;
omit it (or use an empty string) for today-relative analysis.

#### Targeting an explicit period or custom date range

To target an explicit period or an arbitrary date range, set `measurement_period.range` to
`'RANGE_BY_CONFIG'` and provide `measurement_period.specific_period`. This is the only way to
analyze a custom span (e.g. April 15-20). `measurement_period.specific_period` is only honored when
`measurement_period.range` is `'RANGE_BY_CONFIG'` (the refusal names the range it received); set
outside it, the request is refused rather than silently analyzed for another period. For a
today-relative window drop `specific_period`; to analyze the explicit period or span, set `range`
to `'RANGE_BY_CONFIG'`. `options.now` and `measurement_period.specific_period` cannot both be set —
they are alternative ways to target a period. Use `options.now` to anchor a relative whole period,
or `specific_period` (with range `RANGE_BY_CONFIG`) for an explicit period or span.

- `{ "date": "YYYY-MM-DD" }` — the single period (at the chosen `granularity`) that contains that date. E.g. `GRANULARITY_BY_MONTH` + `date: '2026-05-10'` is the month of May 2026.
- `{ "date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD" }` — a span from the start of `date`'s period through the end of `end_date`'s period. E.g. `GRANULARITY_BY_DAY` + `date: '2026-04-15'`, `end_date: '2026-04-20'` is April 15-20, 2026.

#### Rolling windows

Use `measurement_period.last_x_period` for a rolling window instead of a fixed span. The same
fail-closed checks apply as for `specific_period`, so an unsupported combination is refused rather
than analyzed for a different period:

- `measurement_period.last_x_period is only honored when measurement_period.range is 'RANGE_BY_CONFIG'` — the refusal names the range it received.
- `measurement_period.last_x_period and measurement_period.specific_period cannot both be set — use last_x_period for a supported rolling window or specific_period for a fixed span.`
- `a day-based measurement_period.last_x_period requires measurement_period.granularity = 'GRANULARITY_BY_DAY'.`
- `the trailing-year measurement_period.last_x_period requires measurement_period.granularity = 'GRANULARITY_BY_MONTH'.`
- `options.now` and `measurement_period.last_x_period` cannot both be set — rolling windows are
  relative to the live data offset, so anchoring the analysis to another date has no meaning for
  them.

#### Example

```json
{
  "bundle_request": {
    "version": 1,
    "options": {
      "output_format": "OUTPUT_FORMAT_HTML",
      "time_zone": "UTC",
      "language": "LANGUAGE_EN_US",
      "locale": "LOCALE_EN_US"
    },
    "input": {
      "metadata": {
        "name": "Pulse Metric",
        "metric_id": "fd6c4aa0-f6d3-469e-b75b-d597435ae199",
        "definition_id": "9ad098f4-49cf-4e8a-bec0-0ca803091dd0"
      },
      "metric": {
        "definition": {
          "datasource": {
            "id": "2d935df8-fe7e-4fd8-bb14-35eb4ba31d45"
          },
          "basic_specification": {
            "measure": {
              "field": "Sales",
              "aggregation": "AGGREGATION_SUM"
            },
            "time_dimension": {
              "field": "Order Date"
            },
            "filters": []
          },
          "is_running_total": false
        },
        "metric_specification": {
          "filters": [],
          "measurement_period": {
            "granularity": "GRANULARITY_BY_QUARTER",
            "range": "RANGE_LAST_COMPLETE"
          },
          "comparison": {
            "comparison": "TIME_COMPARISON_PREVIOUS_PERIOD"
          }
        },
        "extension_options": {
          "allowed_dimensions": [],
          "allowed_granularities": [],
          "offset_from_today": 0
        },
        "representation_options": {
          "type": "NUMBER_FORMAT_TYPE_NUMBER",
          "number_units": {
            "singular_noun": "unit",
            "plural_noun": "units"
          },
          "sentiment_type": "SENTIMENT_TYPE_NONE",
          "row_level_id_field": {
            "identifier_col": "Order ID",
            "identifier_label": ""
          },
          "row_level_entity_names": {
            "entity_name_singular": "Order"
          },
          "row_level_name_field": {
            "name_col": "Order Name"
          },
          "currency_code": "CURRENCY_CODE_USD"
        },
        "insights_options": {
          "show_insights": true,
          "settings": []
        },
        "goals": {
          "target": {
            "value": 100
          }
        }
      }
    }
  }
}
```

:::note[Datasource scoping]
When the server is configured to limit which data sources may be queried, the metric's
`metric.definition.datasource.id` must be within that allowed set; otherwise the tool refuses the
request.
:::

:::note[Refusals]
The tool refuses the request before calling Pulse when any of the following is true. `version must be 1` includes the version that was sent.

- `version must be 1 (got <version>).`
- `basic_specification.measure.field is empty.`
- `basic_specification.time_dimension.field is required when measurement_period.range and comparison are specified.`
- `definition.datasource.id is empty.`
- `is_running_total cannot be true with AGGREGATION_USER.`
- `metric_specification.comparison.comparison must be set (e.g., TIME_COMPARISON_PREVIOUS_PERIOD, TIME_COMPARISON_YEAR_AGO_PERIOD).`
- `metric_specification.measurement_period.granularity must be set (e.g., GRANULARITY_BY_DAY, GRANULARITY_BY_WEEK, GRANULARITY_BY_MONTH).`
- `metric_specification.measurement_period.range must be set (e.g., RANGE_CURRENT_PARTIAL, RANGE_LAST_COMPLETE).`
:::

## Optional arguments

### `bundleType`

The type of bundle to generate. Defaults to `ban`.

| Value         | Description                                                                                                                                                                                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ban`         | Return a basic insight bundle with the current aggregated value for the Pulse Metric, period over period change, and the highest ranked insight for each filterable dimension of the metric.                                                                                                      |
| `basic`       | Return a basic insight bundle. Similar to a springboard insight, but data is focused on the dimensions of a metric that are low bandwidth because they have small value sets. It shows the current value, period over period change, and the highest ranked insight for the metric for that data. |
| `springboard` | Return a springboard insight bundle with the current value, period over period change, and the highest ranked insight for the metric.                                                                                                                                                             |
| `detail`      | Shows insights on performance over time of the metric, a summary visualization of metric highs and lows and trends, breakdowns of top contributors for each filterable dimension of the metric, and followup insights based on the top ranked insights not already presented.                     |
| `exploration` | Return an exploration insight bundle focused on performance trends, with BAN, anchor, and follow-up insight groups. Available in API 3.26 (Tableau Cloud September 2025) and later. Not available for Tableau Server.                                                                             |

<hr />

### `verbosity`
Controls how much of the response is returned. Defaults to `full`.

- `full` — returns the response verbatim, including `viz`
- `slim` — strips the large `viz` (Vega chart-spec) blobs from every insight and summary result

<hr />

## Example result

```json
{
  "bundle_response": {
    "result": {
      "insight_groups": [
        {
          "type": "ban",
          "insights": [
            {
              "result": {
                "type": "popc",
                "version": 1,
                "content": "",
                "markup": "<span data-type=\"metric\">Pulse Metric</span> was 135.0K units (Q2 2025), <span data-type=\"insight-type-keyword\">up 7.7%</span> (9.7K units) compared to the prior quarter (Q1 2025).",
                "facts": {
                  "sentiment": "neutral",
                  "is_custom_comparison": false,
                  "result_hash": "+lA+/F4el3Q7+N5E3ERLYSwJ1fnexyT/ISrrAXrGcxY=",
                  "target_period_value": {
                    "raw": 134990.59600000002,
                    "formatted": "135.0K"
                  },
                  "comparison_period_value": {
                    "raw": 125288.82819999992,
                    "formatted": "125.3K"
                  },
                  "target_time_period": {
                    "range": "Q2 2025",
                    "label": "Q2 2025",
                    "granularity": "quarter",
                    "start_timestamp": "2025-04-01T00:00:00Z",
                    "end_timestamp": "2025-07-01T00:00:00Z"
                  },
                  "comparison_time_period": {
                    "granularity": "quarter",
                    "start_timestamp": "2025-01-01T00:00:00Z",
                    "end_timestamp": "2025-04-01T00:00:00Z",
                    "range": "Q1 2025",
                    "label": "Q1 2025"
                  },
                  "difference": {
                    "absolute": {
                      "raw": 9701.767800000103,
                      "formatted": "9.7K"
                    },
                    "relative": {
                      "raw": 0.07743521860155853,
                      "formatted": "7.7%"
                    },
                    "direction": "up"
                  }
                },
                "characterization": "CHARACTERIZATION_UNSPECIFIED",
                "question": "How did Pulse Metric change from Q1 2025 to Q2 2025?",
                "score": 0
              },
              "insight_type": "popc"
            }
          ],
          "summaries": []
        },
        {
          "type": "top",
          "insights": [
            {
              "result": {
                "type": "unusualchange",
                "version": 1,
                "content": "",
                "markup": "<span data-type=\"metric\">Pulse Metric</span> in Q2 2025 was 135.0K units and was <span data-type=\"insight-type-keyword\">within the expected range</span> of 109.6K units to 175.7K units considering seasonal patterns.",
                "facts": {
                  "sentiment": "neutral",
                  "last_complete_period": {
                    "granularity": "quarter",
                    "start_timestamp": "2025-04-01T00:00:00Z",
                    "end_timestamp": "2025-07-01T00:00:00Z",
                    "range": "Q2 2025",
                    "label": "Q2 2025"
                  },
                  "unusual_change_type": "notunusual",
                  "result_hash": "F4hh0qhCnU+hQkqqWFAyzFKngGalVQDZdO7raxcDOnU=",
                  "direction": "flat",
                  "value": {
                    "raw": 134990.59600000002,
                    "formatted": "135.0K"
                  },
                  "value_change": {
                    "relative": {
                      "raw": 0.07743521860155853,
                      "formatted": "7.7%"
                    },
                    "direction": "up",
                    "absolute": {
                      "formatted": "9.7K",
                      "raw": 9701.767800000103
                    }
                  },
                  "expected_value_change": {
                    "raw": 17353.50481379211,
                    "formatted": "17.4K"
                  }
                },
                "characterization": "CHARACTERIZATION_UNSPECIFIED",
                "question": "Is this change unexpected?",
                "score": 0.4333333333333333
              },
              "insight_type": "unusualchange"
            }
          ],
          "summaries": []
        },
        {
          "type": "timely",
          "insights": [],
          "summaries": []
        }
      ],
      "has_errors": false,
      "characterization": "CHARACTERIZATION_UNSPECIFIED"
    }
  }
}
```

:::note[Trimmed for readability]
The example above omits the large `viz` (Vega-Lite chart-spec) blobs that a `full` response returns
for each insight and summary. Pass `verbosity: 'slim'` to strip those blobs from the actual
response.
:::

## Related

- [`generate-pulse-insight-brief`](generate-pulse-insight-brief.md) — AI-powered conversational insight brief for Pulse metrics
- [`list-pulse-metrics-from-metric-ids`](list-pulse-metrics-from-metric-ids.md) — resolve the Pulse metric information used in `bundleRequest`
- [`list-pulse-metrics-from-metric-definition-id`](list-pulse-metrics-from-metric-definition-id.md) — list the Pulse metrics for a metric definition
- [`list-pulse-metric-definitions-from-definition-ids`](list-pulse-metric-definitions-from-definition-ids.md) — retrieve the Pulse metric definitions referenced by the request

{/* tool-details */}
## Arguments no longer accepted

These arguments were described on an earlier page and are not accepted by the current tool.

### `slim`

Deprecated: use `verbosity=slim`.
{/* /tool-details */}
