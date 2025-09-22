---
sidebar_position: 6
---

# Generate Insight Bundle

Generates an insight bundle for the current aggregated value for a Pulse metric.

## APIs called

- [Generate current metric value insight bundle](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_pulse.htm#PulseInsightsService_GenerateInsightBundleBAN)
- [Generate basic insight bundle](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_pulse.htm#PulseInsightsService_GenerateInsightBundleBasic)
- [Generate detail insight bundle](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_pulse.htm#PulseInsightsService_GenerateInsightBundleDetail)
- [Generate springboard insight bundle](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_pulse.htm#PulseInsightsService_GenerateInsightBundleSpringboard)

## Required arguments

### `bundleRequest`

The request to generate a bundle for.

Example:

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

## Optional arguments

### `bundleType`

The type of bundle to generate. The default is `ban`.

| Value         | Description                                                                                                                                                                                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ban`         | Return a basic insight bundle with the current aggregated value for the Pulse Metric, period over period change, and the highest ranked insight for each filterable dimension of the metric.                                                                                                      |
| `basic`       | Return a basic insight bundle. Similar to a springboard insight, but data is focused on the dimensions of a metric that are low bandwidth because they have small value sets. It shows the current value, period over period change, and the highest ranked insight for the metric for that data. |
| `springboard` | Return a springboard insight bundle with the current value, period over period change, and the highest ranked insight for the metric.                                                                                                                                                             |
| `detail`      | Shows insights on performance over time of the metric, a summary visualization of metric highs and lows and trends, breakdowns of top contributors for each filterable dimension of the metric, and followup insights based on the top ranked insights not already presented.                     |

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
                "viz": {
                  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
                  "encoding": {
                    "y": {
                      "field": "entityName",
                      "type": "nominal",
                      "sort": {
                        "field": "index",
                        "order": "ascending"
                      },
                      "axis": {
                        "title": null,
                        "offset": {
                          "expr": "contributorAxisOffset"
                        },
                        "domain": false,
                        "labelPadding": {
                          "expr": "includesNegativeValues ? contributorAxisLabelMaxWidth + 16 : contributorAxisLabelPadding"
                        },
                        "labelFont": {
                          "expr": "contributorAxisLabelFontFace"
                        },
                        "labelFontSize": {
                          "expr": "contributorAxisLabelFontSize"
                        },
                        "labelColor": {
                          "expr": "contributorAxisLabelColor"
                        }
                      }
                    },
                    "x": {
                      "axis": {
                        "labelOpacity": 0,
                        "grid": true,
                        "gridOpacity": {
                          "expr": "datum.value === 0 ? 1 : 0"
                        },
                        "title": null,
                        "gridWidth": {
                          "expr": "contributorAxisDomainWidth"
                        },
                        "gridColor": {
                          "expr": "contributorAxisDomainColor"
                        },
                        "gridCap": {
                          "expr": "contributorAxisDomainCap"
                        },
                        "domain": false,
                        "zindex": 1
                      },
                      "stack": null,
                      "field": "value",
                      "type": "quantitative",
                      "scale": {
                        "padding": {
                          "expr": "xScalePadding"
                        }
                      }
                    }
                  },
                  "layer": [
                    {
                      "name": "bar-chart",
                      "description": "Layer for the bar chart",
                      "params": [
                        {
                          "name": "highlight",
                          "select": {
                            "type": "point",
                            "on": "pointerover"
                          }
                        },
                        {
                          "name": "select",
                          "select": "point"
                        }
                      ],
                      "mark": {
                        "cornerRadiusTopLeft": {
                          "expr": "datum.value >= 0 ? 0 : barCornerRadius"
                        },
                        "cornerRadiusBottomLeft": {
                          "expr": "datum.value >= 0 ? 0 : barCornerRadius"
                        },
                        "binSpacing": 0,
                        "strokeWidth": 1,
                        "type": "bar",
                        "height": 24,
                        "cornerRadiusTopRight": {
                          "expr": "datum.value < 0 ? 0 : barCornerRadius"
                        },
                        "cornerRadiusBottomRight": {
                          "expr": "datum.value < 0 ? 0 : barCornerRadius"
                        }
                      },
                      "encoding": {
                        "color": {
                          "condition": [
                            {
                              "empty": false,
                              "value": {
                                "expr": "\n                  if(datum.average, contributorBarColorAverageActive,\n                    if(mode === 'favorable', contributorBarColorFavorableActive,\n                      if(mode === 'unfavorable', contributorBarColorUnfavorableActive,\n                        contributorBarColorUnspecifiedActive\n                      )\n                    )\n                  )"
                              },
                              "param": "select"
                            },
                            {
                              "param": "highlight",
                              "empty": false,
                              "value": {
                                "expr": "\n                  if(datum.average, contributorBarColorAverageHover,\n                    if(mode === 'favorable', contributorBarColorFavorableHover,\n                      if(mode === 'unfavorable', contributorBarColorUnfavorableHover,\n                        contributorBarColorUnspecifiedHover\n                      )\n                    )\n                  )"
                              }
                            }
                          ],
                          "value": {
                            "expr": "\n              if(datum.average, contributorBarColorAverage,\n                if(mode === 'favorable', contributorBarColorFavorable,\n                  if(mode === 'unfavorable', contributorBarColorUnfavorable,\n                    contributorBarColorUnspecified\n                  )\n                )\n              )"
                          }
                        },
                        "stroke": {
                          "value": {
                            "expr": "\n              if(datum.average, contributorBarBorderColorAverage,\n                if(mode === 'favorable', contributorBarBorderColorFavorable,\n                  if(mode === 'unfavorable', contributorBarBorderColorUnfavorable,\n                    contributorBarBorderColorUnspecified\n                  )\n                )\n              )"
                          }
                        }
                      }
                    },
                    {
                      "name": "value-text-label",
                      "description": "Layer for the absolute value text labels",
                      "mark": {
                        "align": {
                          "expr": "datum.value < 0 ? 'right' : 'left'"
                        },
                        "text": {
                          "expr": "datum.formattedValue"
                        },
                        "color": {
                          "expr": "\n            if(datum.average, barValueLabelColorAverage,\n              if(mode === 'favorable', barValueLabelColorFavorable,\n                if(mode === 'unfavorable', barValueLabelColorUnfavorable,\n                  barValueLabelColorUnspecified\n                )\n              )\n            )"
                        },
                        "limit": {
                          "expr": "includesNegativeValues ? contributorAxisLabelMaxWidth : barValueLabelMaxWidth "
                        },
                        "baseline": "middle",
                        "fontWeight": {
                          "expr": "barValueLabelFontWeight"
                        },
                        "dx": {
                          "expr": "datum.value < 0 ? barValueLabelPadding * -1 : barValueLabelPadding"
                        },
                        "fontSize": {
                          "expr": "barValueLabelFontSize"
                        },
                        "type": "text",
                        "font": {
                          "expr": "barValueLabelFontFace"
                        }
                      }
                    }
                  ],
                  "width": "container",
                  "config": {
                    "axis": {
                      "ticks": false
                    }
                  },
                  "height": "container",
                  "params": [
                    {
                      "name": "barCornerRadius",
                      "value": 4
                    },
                    {
                      "value": "#343A3F",
                      "name": "barValueLabelColorAverage"
                    },
                    {
                      "name": "barValueLabelColorFavorable",
                      "value": "#1EA562"
                    },
                    {
                      "name": "barValueLabelColorUnfavorable",
                      "value": "#C6154A"
                    },
                    {
                      "name": "barValueLabelColorUnspecified",
                      "value": "#1678CC"
                    },
                    {
                      "value": "'SF Pro Text', 'SF Pro Display', system-ui, -apple-system, blinkmacsystemfont, 'Segoe UI', roboto, ubuntu, 'Fire Sans', 'Helvetica Neue', sans-serif",
                      "name": "barValueLabelFontFace"
                    },
                    {
                      "name": "barValueLabelFontSize",
                      "value": 14
                    },
                    {
                      "name": "barValueLabelFontWeight",
                      "value": 500
                    },
                    {
                      "name": "barValueLabelMaxWidth",
                      "value": 72
                    },
                    {
                      "name": "barValueLabelPadding",
                      "value": 4
                    },
                    {
                      "name": "contributorAxisDomainCap",
                      "value": "round"
                    },
                    {
                      "name": "contributorAxisDomainColor",
                      "value": "#343A3F"
                    },
                    {
                      "name": "contributorAxisDomainWidth",
                      "value": 2
                    },
                    {
                      "value": "#343A3F",
                      "name": "contributorAxisLabelColor"
                    },
                    {
                      "name": "contributorAxisLabelPadding",
                      "value": 10
                    },
                    {
                      "name": "contributorAxisLabelMaxWidth",
                      "value": 72
                    },
                    {
                      "value": "'SF Pro Text', 'SF Pro Display', system-ui, -apple-system, blinkmacsystemfont, 'Segoe UI', roboto, ubuntu, 'Fire Sans', 'Helvetica Neue', sans-serif",
                      "name": "contributorAxisLabelFontFace"
                    },
                    {
                      "name": "contributorAxisLabelFontSize",
                      "value": 14
                    },
                    {
                      "name": "contributorAxisOffset",
                      "value": 2
                    },
                    {
                      "name": "contributorBarColorAverage",
                      "value": "#C8CED8"
                    },
                    {
                      "name": "contributorBarColorAverageHover",
                      "value": "#6B7280"
                    },
                    {
                      "value": "#4D555C",
                      "name": "contributorBarColorAverageActive"
                    },
                    {
                      "name": "contributorBarColorFavorable",
                      "value": "#66DDA3"
                    },
                    {
                      "name": "contributorBarColorFavorableHover",
                      "value": "#1C9B5C"
                    },
                    {
                      "value": "#157445",
                      "name": "contributorBarColorFavorableActive"
                    },
                    {
                      "name": "contributorBarColorUnfavorable",
                      "value": "#FA5F8D"
                    },
                    {
                      "name": "contributorBarColorUnfavorableHover",
                      "value": "#F9437A"
                    },
                    {
                      "name": "contributorBarColorUnfavorableActive",
                      "value": "#C6154A"
                    },
                    {
                      "name": "contributorBarColorUnspecified",
                      "value": "#5FB5FF"
                    },
                    {
                      "name": "contributorBarColorUnspecifiedHover",
                      "value": "#058AFF"
                    },
                    {
                      "name": "contributorBarColorUnspecifiedActive",
                      "value": "#146EBD"
                    },
                    {
                      "name": "contributorBarBorderColorAverage",
                      "value": "#6B7280"
                    },
                    {
                      "name": "contributorBarBorderColorFavorable",
                      "value": "#1C9B5C"
                    },
                    {
                      "name": "contributorBarBorderColorUnfavorable",
                      "value": "#F9437A"
                    },
                    {
                      "name": "contributorBarBorderColorUnspecified",
                      "value": "#058AFF"
                    },
                    {
                      "name": "xScalePadding",
                      "value": 0
                    },
                    {
                      "name": "mode",
                      "value": "unspecified"
                    },
                    {
                      "name": "includesNegativeValues",
                      "value": false
                    },
                    {
                      "name": "xDomain",
                      "value": [0, 134990.59600000002]
                    }
                  ],
                  "data": {
                    "values": [
                      {
                        "entityName": "Q1 2025",
                        "value": 125288.82819999992,
                        "formattedValue": "125.3K",
                        "average": true,
                        "index": 0
                      },
                      {
                        "formattedValue": "135.0K (+7.7%)",
                        "average": false,
                        "index": 1,
                        "entityName": "Q2 2025",
                        "value": 134990.59600000002
                      }
                    ]
                  },
                  "view": {
                    "stroke": null
                  }
                },
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
          "summaries": [
            {
              "result": {
                "id": "",
                "markup": "",
                "viz": {
                  "params": [
                    {
                      "name": "axisLabelFontFace",
                      "value": "'SF Pro Text', 'SF Pro Display', system-ui, -apple-system, blinkmacsystemfont, 'Segoe UI', roboto, ubuntu, 'Fire Sans', 'Helvetica Neue', sans-serif"
                    },
                    {
                      "name": "axisLabelFontSize",
                      "value": 13
                    },
                    {
                      "name": "axisLabelAngle",
                      "value": 0
                    },
                    {
                      "name": "axisLabelPadding",
                      "value": 0
                    },
                    {
                      "name": "axisLabelOffset",
                      "value": 0
                    },
                    {
                      "value": "#4D555C",
                      "name": "axisLabelColorDefault"
                    },
                    {
                      "name": "axisLabelColorActive",
                      "value": "#040507"
                    },
                    {
                      "value": "#058AFF",
                      "name": "currentValueCircleColor1"
                    },
                    {
                      "name": "currentValueCircleColor2",
                      "value": "#fff"
                    },
                    {
                      "name": "currentValueCircleSize",
                      "value": 120
                    },
                    {
                      "name": "currentValueCircleStrokeWidth",
                      "value": 3
                    },
                    {
                      "name": "currentValueFontFace",
                      "value": "'SF Pro Text', 'SF Pro Display', system-ui, -apple-system, blinkmacsystemfont, 'Segoe UI', roboto, ubuntu, 'Fire Sans', 'Helvetica Neue', sans-serif"
                    },
                    {
                      "name": "currentValueFontSize",
                      "value": 13
                    },
                    {
                      "name": "currentValueFontWeight",
                      "value": 600
                    },
                    {
                      "name": "currentValuePadding",
                      "value": 12
                    },
                    {
                      "value": 12,
                      "name": "leftYAxisOffset"
                    },
                    {
                      "name": "lineColor",
                      "value": "#058AFF"
                    },
                    {
                      "name": "lineStrokeWidth",
                      "value": 3
                    },
                    {
                      "name": "lineStrokeDash",
                      "value": [6, 3]
                    },
                    {
                      "name": "normalRangeColor",
                      "value": "#E3F2FF"
                    },
                    {
                      "name": "normalRangeOpacity",
                      "value": 1
                    },
                    {
                      "name": "xAxisScalePadding",
                      "value": -20
                    },
                    {
                      "name": "xAxisOffset",
                      "value": 20
                    },
                    {
                      "value": "#6B7280",
                      "name": "xAxisGridColorDefault"
                    },
                    {
                      "name": "xAxisGridColorActive",
                      "value": "#040507"
                    },
                    {
                      "name": "xAxisLabelFontWeightDefault",
                      "value": "normal"
                    },
                    {
                      "name": "xAxisLabelFontWeightActive",
                      "value": 600
                    },
                    {
                      "name": "mode",
                      "value": "LastComplete"
                    },
                    {
                      "value": ["2025-04-01T00:00:00Z", "2023-07-01T00:00:00Z"],
                      "name": "xAxisLabelsDataValues"
                    },
                    {
                      "name": "yAxisLabelsDataValues",
                      "value": ["130449.3752"]
                    },
                    {
                      "name": "lastPointCircleMode",
                      "value": "filled"
                    },
                    {
                      "name": "activeLabelAndGridDate",
                      "value": "2025-04-01T00:00:00Z"
                    }
                  ],
                  "encoding": {
                    "x": {
                      "axis": {
                        "grid": true,
                        "labelAlign": {
                          "condition": [
                            {
                              "test": "datum.index === 0",
                              "value": "left"
                            },
                            {
                              "test": "datum.index === 1",
                              "value": "right"
                            }
                          ],
                          "value": "center"
                        },
                        "values": {
                          "expr": "xAxisLabelsDataValues"
                        },
                        "labelColor": {
                          "condition": [
                            {
                              "test": "activeLabelAndGridDate === datum.value",
                              "expr": "axisLabelColorActive"
                            }
                          ],
                          "expr": "axisLabelColorDefault"
                        },
                        "offset": {
                          "expr": "xAxisOffset"
                        },
                        "gridOpacity": {
                          "expr": "datum.index === 0 ? 0 : 1"
                        },
                        "labelOverlap": true,
                        "gridColor": {
                          "condition": [
                            {
                              "test": "activeLabelAndGridDate === datum.value",
                              "expr": "xAxisGridColorActive"
                            }
                          ],
                          "expr": "xAxisGridColorDefault"
                        },
                        "labelFontWeight": {
                          "condition": [
                            {
                              "test": "activeLabelAndGridDate === datum.value",
                              "expr": "xAxisLabelFontWeightActive"
                            }
                          ],
                          "expr": "xAxisLabelFontWeightDefault"
                        },
                        "format": {
                          "custom": true,
                          "mapName": "xAxis"
                        }
                      },
                      "scale": {
                        "type": "point",
                        "padding": {
                          "expr": "xAxisScalePadding"
                        }
                      },
                      "field": "truncDate",
                      "type": "ordinal"
                    }
                  },
                  "resolve": {
                    "axis": {
                      "y": "independent"
                    }
                  },
                  "customFormatterMaps": {
                    "yAxis": {
                      "130449.3752": "130.4K"
                    },
                    "xAxis": {
                      "2023-07-01T00:00:00Z": "Q3 23",
                      "2025-04-01T00:00:00Z": "Q2 25"
                    }
                  },
                  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
                  "height": "container",
                  "config": {
                    "customFormatTypes": true,
                    "axis": {
                      "domain": false,
                      "title": null,
                      "labelFontSize": {
                        "expr": "axisLabelFontSize"
                      },
                      "ticks": false,
                      "labelLineHeight": {
                        "expr": "axisLabelFontSize"
                      },
                      "labelFont": {
                        "expr": "axisLabelFontFace"
                      },
                      "labelAngle": {
                        "expr": "axisLabelAngle"
                      },
                      "labelPadding": {
                        "expr": "axisLabelPadding"
                      },
                      "labelOffset": {
                        "expr": "axisLabelOffset"
                      }
                    }
                  },
                  "view": {
                    "stroke": null
                  },
                  "data": {
                    "values": [
                      {
                        "tooltipMarkup": "<span data-type=\"period\">Q2 2025</span><span data-type=\"actual-label\">Actual</span><span data-type=\"actual-value\">135.0K (134,990.60)</span>",
                        "ci0": "109561.9349",
                        "truncDate": "2025-04-01T00:00:00Z",
                        "tooltipText": "",
                        "showIsolatedPoint": 0,
                        "formattedRawValue": "135.0K",
                        "point": 1,
                        "formattedTruncDate": "Q2 2025",
                        "changeSentiment": "neutral",
                        "segment": "1",
                        "ci1": "175722.7311",
                        "dashed": false,
                        "rawValue": "134990.5960"
                      },
                      {
                        "tooltipMarkup": "<span data-type=\"period\">Q1 2025</span><span data-type=\"actual-label\">Actual</span><span data-type=\"actual-value\">125.3K (125,288.83)</span>",
                        "changeSentiment": "neutral",
                        "tooltipText": "",
                        "segment": "1",
                        "ci0": "85415.8193",
                        "formattedRawValue": "125.3K",
                        "formattedTruncDate": "Q1 2025",
                        "ci1": "149951.9070",
                        "point": 0,
                        "dashed": false,
                        "rawValue": "125288.8282",
                        "truncDate": "2025-01-01T00:00:00Z",
                        "showIsolatedPoint": 0
                      },
                      {
                        "formattedRawValue": "236.7K",
                        "formattedTruncDate": "Q4 2024",
                        "showIsolatedPoint": 0,
                        "dashed": false,
                        "changeSentiment": "neutral",
                        "ci0": "168285.6908",
                        "point": 0,
                        "tooltipText": "",
                        "tooltipMarkup": "<span data-type=\"period\">Q4 2024</span><span data-type=\"actual-label\">Actual</span><span data-type=\"actual-value\">236.7K (236,745.24)</span>",
                        "segment": "1",
                        "ci1": "237625.9108",
                        "rawValue": "236745.2438",
                        "truncDate": "2024-10-01T00:00:00Z"
                      },
                      {
                        "formattedRawValue": "145.5K",
                        "tooltipText": "",
                        "rawValue": "145538.9762",
                        "showIsolatedPoint": 0,
                        "changeSentiment": "neutral",
                        "ci1": "181915.0816",
                        "ci0": "120216.6475",
                        "point": 0,
                        "truncDate": "2024-07-01T00:00:00Z",
                        "formattedTruncDate": "Q3 2024",
                        "dashed": false,
                        "tooltipMarkup": "<span data-type=\"period\">Q3 2024</span><span data-type=\"actual-label\">Actual</span><span data-type=\"actual-value\">145.5K (145,538.98)</span>",
                        "segment": "1"
                      },
                      {
                        "point": 0,
                        "tooltipMarkup": "<span data-type=\"period\">Q2 2024</span><span data-type=\"actual-label\">Actual</span><span data-type=\"actual-value\">136.8K (136,809.14)</span>",
                        "ci1": "147232.4450",
                        "changeSentiment": "neutral",
                        "ci0": "90096.1571",
                        "formattedRawValue": "136.8K",
                        "truncDate": "2024-04-01T00:00:00Z",
                        "rawValue": "136809.1450",
                        "formattedTruncDate": "Q2 2024",
                        "dashed": false,
                        "segment": "1",
                        "showIsolatedPoint": 0,
                        "tooltipText": ""
                      },
                      {
                        "formattedRawValue": "94.8K",
                        "showIsolatedPoint": 0,
                        "segment": "1",
                        "rawValue": "94840.2150",
                        "ci0": "66542.0564",
                        "dashed": false,
                        "point": 0,
                        "tooltipText": "",
                        "tooltipMarkup": "<span data-type=\"period\">Q1 2024</span><span data-type=\"actual-label\">Actual</span><span data-type=\"actual-value\">94.8K (94,840.21)</span>",
                        "truncDate": "2024-01-01T00:00:00Z",
                        "formattedTruncDate": "Q1 2024",
                        "changeSentiment": "neutral",
                        "ci1": "124277.9977"
                      },
                      {
                        "tooltipText": "",
                        "rawValue": "182912.2542",
                        "formattedTruncDate": "Q4 2023",
                        "changeSentiment": "neutral",
                        "tooltipMarkup": "<span data-type=\"period\">Q4 2023</span><span data-type=\"actual-label\">Actual</span><span data-type=\"actual-value\">182.9K (182,912.25)</span>",
                        "segment": "1",
                        "truncDate": "2023-10-01T00:00:00Z",
                        "point": 0,
                        "formattedRawValue": "182.9K",
                        "dashed": false,
                        "ci1": "217804.5577",
                        "ci0": "156012.2328",
                        "showIsolatedPoint": 0
                      },
                      {
                        "changeSentiment": "neutral",
                        "formattedTruncDate": "Q3 2023",
                        "point": 0,
                        "formattedRawValue": "130.4K",
                        "dashed": false,
                        "ci1": "155769.5390",
                        "tooltipText": "",
                        "segment": "1",
                        "truncDate": "2023-07-01T00:00:00Z",
                        "showIsolatedPoint": 0,
                        "tooltipMarkup": "<span data-type=\"period\">Q3 2023</span><span data-type=\"actual-label\">Actual</span><span data-type=\"actual-value\">130.4K (130,449.38)</span>",
                        "ci0": "93831.3645",
                        "rawValue": "130449.3752"
                      }
                    ],
                    "name": "series"
                  },
                  "layer": [
                    {
                      "name": "normal-range",
                      "description": "The normal range band around the line",
                      "mark": {
                        "color": {
                          "expr": "normalRangeColor"
                        },
                        "opacity": {
                          "expr": "normalRangeOpacity"
                        },
                        "type": "errorband"
                      },
                      "encoding": {
                        "y": {
                          "field": "ci1",
                          "type": "quantitative",
                          "scale": {
                            "zero": false
                          },
                          "title": "Normal range",
                          "axis": null
                        },
                        "y2": {
                          "field": "ci0"
                        }
                      }
                    },
                    {
                      "name": "line",
                      "description": "The line based of time series data",
                      "mark": {
                        "clip": true,
                        "type": "line",
                        "stroke": {
                          "expr": "lineColor"
                        },
                        "strokeWidth": {
                          "expr": "lineStrokeWidth"
                        },
                        "opacity": 1
                      },
                      "encoding": {
                        "strokeDash": {
                          "field": "dashed",
                          "type": "nominal",
                          "legend": null,
                          "condition": {
                            "value": {
                              "expr": "lineStrokeDash"
                            },
                            "test": "datum.dashed"
                          }
                        },
                        "y": {
                          "field": "rawValue",
                          "type": "quantitative",
                          "axis": null
                        }
                      },
                      "detail": {
                        "field": "segment",
                        "type": "nominal"
                      }
                    },
                    {
                      "description": "Manual left x-axis grid line to overlay the errorband that occludes the real axis grid line",
                      "mark": {
                        "type": "rule",
                        "color": {
                          "expr": "xAxisGridColorDefault"
                        },
                        "opacity": {
                          "expr": "length(data('series')) > 0 && datum.truncDate === peek(data('series')).truncDate ? 1 : 0"
                        }
                      },
                      "name": "left-x-axis-overlay"
                    },
                    {
                      "name": "isolated-point-value-circle",
                      "description": "Circle for isolated points in data series",
                      "mark": {
                        "filled": true,
                        "fill": {
                          "expr": "currentValueCircleColor1"
                        },
                        "size": {
                          "expr": "datum.showIsolatedPoint*currentValueCircleSize"
                        },
                        "opacity": 1,
                        "strokeWidth": {
                          "expr": "currentValueCircleStrokeWidth"
                        },
                        "type": "point"
                      },
                      "encoding": {
                        "y": {
                          "axis": null,
                          "field": "rawValue",
                          "type": "quantitative"
                        }
                      }
                    },
                    {
                      "encoding": {
                        "y": {
                          "field": "rawValue",
                          "type": "quantitative",
                          "axis": {
                            "labelAlign": "right",
                            "labelBaseline": {
                              "condition": {
                                "test": "datum.value === 0",
                                "value": "bottom"
                              },
                              "value": "middle"
                            },
                            "labelColor": {
                              "expr": "datum.index === 1 ? axisLabelColorActive : axisLabelColorDefault"
                            },
                            "offset": {
                              "expr": "leftYAxisOffset"
                            },
                            "values": {
                              "expr": "yAxisLabelsDataValues"
                            },
                            "grid": false,
                            "format": {
                              "custom": true,
                              "mapName": "yAxis"
                            }
                          }
                        }
                      },
                      "name": "current-value-circle",
                      "description": "Circle at the end of the line on the current data point",
                      "mark": {
                        "filled": true,
                        "fill": {
                          "expr": "lastPointCircleMode === 'empty' ? currentValueCircleColor2 : currentValueCircleColor1"
                        },
                        "size": {
                          "expr": "datum.point*currentValueCircleSize"
                        },
                        "opacity": 1,
                        "stroke": {
                          "expr": "lastPointCircleMode === 'empty' ? currentValueCircleColor1 : currentValueCircleColor2 "
                        },
                        "strokeWidth": {
                          "expr": "currentValueCircleStrokeWidth"
                        },
                        "type": "point"
                      }
                    },
                    {
                      "mark": {
                        "fontSize": {
                          "expr": "currentValueFontSize"
                        },
                        "font": {
                          "expr": "currentValueFontFace"
                        },
                        "fontWeight": {
                          "expr": "currentValueFontWeight"
                        },
                        "align": "left",
                        "text": {
                          "expr": "datum.point === 1 ? datum.formattedRawValue : \"\""
                        },
                        "dx": {
                          "expr": "currentValuePadding"
                        },
                        "type": "text"
                      },
                      "encoding": {
                        "y": {
                          "axis": null,
                          "field": "rawValue",
                          "type": "quantitative"
                        }
                      },
                      "name": "current-value-text",
                      "description": "The current value text after the end of the line"
                    }
                  ],
                  "width": "container"
                },
                "generation_id": ""
              }
            }
          ]
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
                "viz": {
                  "layer": [
                    {
                      "mark": {
                        "color": {
                          "expr": "normalRangeColor"
                        },
                        "opacity": {
                          "expr": "normalRangeOpacity"
                        },
                        "borders": {
                          "color": {
                            "expr": "lineColor"
                          },
                          "opacity": {
                            "expr": "normalRangeOpacity"
                          },
                          "strokeWidth": {
                            "expr": "normalRangeStrokeWidth"
                          }
                        },
                        "type": "errorband"
                      },
                      "encoding": {
                        "y": {
                          "field": "ci1",
                          "type": "quantitative",
                          "scale": {
                            "zero": false
                          },
                          "title": "Normal range",
                          "axis": null
                        },
                        "y2": {
                          "field": "ci0"
                        }
                      },
                      "name": "normal-range",
                      "description": "The normal range band around the line"
                    },
                    {
                      "encoding": {
                        "detail": {
                          "field": "segment",
                          "type": "nominal"
                        },
                        "color": {
                          "field": "changeSentiment",
                          "type": "ordinal",
                          "legend": null
                        },
                        "strokeDash": {
                          "condition": {
                            "test": "datum.dashed",
                            "value": {
                              "expr": "lineStrokeDash"
                            }
                          },
                          "field": "dashed",
                          "type": "nominal",
                          "legend": null
                        },
                        "y": {
                          "field": "rawValue",
                          "type": "quantitative",
                          "axis": null
                        }
                      },
                      "name": "line",
                      "description": "The line based of time series data",
                      "mark": {
                        "type": "line",
                        "clip": true,
                        "stroke": {
                          "expr": "\n            if(datum.changeSentiment === 'positive', colorDesiredChange,\n              if(datum.changeSentiment === 'negative', colorUndesiredChange, lineColor)\n            )\n          "
                        },
                        "strokeWidth": {
                          "expr": "lineStrokeWidth"
                        },
                        "opacity": 1
                      }
                    },
                    {
                      "name": "left-x-axis-overlay",
                      "description": "Manual left x-axis grid line to overlay the errorband that occludes the real axis grid line",
                      "mark": {
                        "color": {
                          "expr": "xAxisGridColorDefault"
                        },
                        "opacity": {
                          "expr": "length(data('series')) > 0 && datum.truncDate === peek(data('series')).truncDate ? 1 : 0"
                        },
                        "type": "rule"
                      }
                    },
                    {
                      "description": "Circle for isolated points in data series",
                      "mark": {
                        "filled": true,
                        "fill": {
                          "expr": "currentValueCircleColor1"
                        },
                        "size": {
                          "expr": "datum.showIsolatedPoint*currentValueCircleSize"
                        },
                        "opacity": 1,
                        "strokeWidth": {
                          "expr": "currentValueCircleStrokeWidth"
                        },
                        "type": "point"
                      },
                      "encoding": {
                        "y": {
                          "field": "rawValue",
                          "type": "quantitative",
                          "axis": null
                        }
                      },
                      "name": "isolated-point-value-circle"
                    },
                    {
                      "encoding": {
                        "y": {
                          "field": "rawValue",
                          "type": "quantitative",
                          "axis": {
                            "labelBaseline": {
                              "condition": {
                                "test": "datum.value === 0",
                                "value": "bottom"
                              },
                              "value": "middle"
                            },
                            "offset": {
                              "expr": "leftYAxisOffset"
                            },
                            "values": {
                              "expr": "yAxisLabelsDataValues"
                            },
                            "grid": false,
                            "format": {
                              "custom": true,
                              "mapName": "yAxis"
                            },
                            "labelAlign": "right"
                          }
                        }
                      },
                      "name": "current-value-circle",
                      "description": "Circle at the end of the line on the current data point",
                      "mark": {
                        "stroke": {
                          "expr": "lastPointCircleMode === 'empty' ? currentValueCircleColor1 : currentValueCircleColor2 "
                        },
                        "strokeWidth": {
                          "expr": "currentValueCircleStrokeWidth"
                        },
                        "type": "point",
                        "filled": true,
                        "fill": {
                          "expr": "\n            if(lastPointCircleMode === 'empty', currentValueCircleColor2,\n              if(datum.changeSentiment === 'positive', colorDesiredChange,\n                if(datum.changeSentiment === 'negative', colorUndesiredChange, currentValueCircleColor1)\n              )\n            )\n          "
                        },
                        "size": {
                          "expr": "datum.point*currentValueCircleSize"
                        },
                        "opacity": 1
                      }
                    },
                    {
                      "description": "The current value text after the end of the line",
                      "mark": {
                        "align": "left",
                        "text": {
                          "expr": "datum.point === 1 ? datum.formattedRawValue : \"\""
                        },
                        "dx": {
                          "expr": "currentValuePadding"
                        },
                        "type": "text",
                        "color": {
                          "expr": "\n            if(lastPointCircleMode === 'empty', currentValueColor,\n              if(datum.changeSentiment === 'positive', colorDesiredChange,\n                if(datum.changeSentiment === 'negative', colorUndesiredChange, currentValueColor)\n              )\n            )\n          "
                        },
                        "fontSize": {
                          "expr": "currentValueFontSize"
                        },
                        "font": {
                          "expr": "currentValueFontFace"
                        },
                        "fontWeight": {
                          "expr": "currentValueFontWeight"
                        }
                      },
                      "encoding": {
                        "y": {
                          "field": "rawValue",
                          "type": "quantitative",
                          "axis": null
                        }
                      },
                      "name": "current-value-text"
                    },
                    {
                      "encoding": {
                        "opacity": {
                          "condition": {
                            "empty": false,
                            "value": {
                              "expr": "hoverVerticalLineOpacity"
                            },
                            "param": "hover"
                          },
                          "value": 0
                        },
                        "tooltip": [
                          {
                            "title": "Date",
                            "field": "formattedTruncDate",
                            "type": "ordinal"
                          },
                          {
                            "field": "formattedRawValue",
                            "type": "ordinal",
                            "title": "Value"
                          },
                          {
                            "field": "tooltipText",
                            "type": "nominal",
                            "title": "TooltipText"
                          },
                          {
                            "field": "tooltipMarkup",
                            "type": "nominal",
                            "title": "TooltipMarkup"
                          }
                        ]
                      },
                      "params": [
                        {
                          "name": "hover",
                          "select": {
                            "on": "mouseover",
                            "clear": "mouseout",
                            "type": "point",
                            "fields": ["truncDate"],
                            "nearest": true
                          }
                        }
                      ],
                      "name": "hover-tooltips",
                      "description": "Hover for tooltips containing a single time series data point",
                      "mark": {
                        "color": {
                          "expr": "hoverVerticalLineColor"
                        },
                        "type": "rule"
                      }
                    },
                    {
                      "description": "Hover dot on main line for a single time series data point",
                      "mark": {
                        "fill": {
                          "expr": "hoverDotColor"
                        },
                        "stroke": null,
                        "opacity": 1,
                        "type": "point",
                        "size": {
                          "expr": "hoverDotSize"
                        }
                      },
                      "encoding": {
                        "y": {
                          "type": "quantitative",
                          "axis": null,
                          "field": "rawValue"
                        },
                        "opacity": {
                          "condition": {
                            "value": 1,
                            "param": "hover",
                            "empty": false
                          },
                          "value": 0
                        }
                      },
                      "name": "hover-dot"
                    }
                  ],
                  "resolve": {
                    "axis": {
                      "y": "independent"
                    }
                  },
                  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
                  "height": "container",
                  "data": {
                    "name": "series",
                    "values": [
                      {
                        "formattedRawValue": "135.0K",
                        "formattedTruncDate": "Q2 2025",
                        "point": 1,
                        "ci0": "109561.9349",
                        "rawValue": "134990.5960",
                        "dashed": false,
                        "tooltipText": "",
                        "ci1": "175722.7311",
                        "truncDate": "2025-04-01T00:00:00Z",
                        "showIsolatedPoint": 0,
                        "tooltipMarkup": "<span data-type=\"period\">Q2 2025</span><span data-type=\"actual-label\">Actual</span><span data-type=\"actual-value\">135.0K (134,990.60)</span>",
                        "changeSentiment": "neutral",
                        "segment": "1"
                      },
                      {
                        "rawValue": "125288.8282",
                        "formattedRawValue": "125.3K",
                        "showIsolatedPoint": 0,
                        "changeSentiment": "neutral",
                        "segment": "1",
                        "ci0": "85415.8193",
                        "tooltipText": "",
                        "tooltipMarkup": "<span data-type=\"period\">Q1 2025</span><span data-type=\"actual-label\">Actual</span><span data-type=\"actual-value\">125.3K (125,288.83)</span>",
                        "point": 0,
                        "truncDate": "2025-01-01T00:00:00Z",
                        "ci1": "149951.9070",
                        "dashed": false,
                        "formattedTruncDate": "Q1 2025"
                      },
                      {
                        "showIsolatedPoint": 0,
                        "tooltipMarkup": "<span data-type=\"period\">Q4 2024</span><span data-type=\"actual-label\">Actual</span><span data-type=\"actual-value\">236.7K (236,745.24)</span>",
                        "segment": "1",
                        "truncDate": "2024-10-01T00:00:00Z",
                        "formattedTruncDate": "Q4 2024",
                        "point": 0,
                        "ci0": "168285.6908",
                        "formattedRawValue": "236.7K",
                        "dashed": false,
                        "tooltipText": "",
                        "rawValue": "236745.2438",
                        "changeSentiment": "neutral",
                        "ci1": "237625.9108"
                      },
                      {
                        "showIsolatedPoint": 0,
                        "truncDate": "2024-07-01T00:00:00Z",
                        "formattedRawValue": "145.5K",
                        "formattedTruncDate": "Q3 2024",
                        "changeSentiment": "neutral",
                        "point": 0,
                        "dashed": false,
                        "tooltipMarkup": "<span data-type=\"period\">Q3 2024</span><span data-type=\"actual-label\">Actual</span><span data-type=\"actual-value\">145.5K (145,538.98)</span>",
                        "ci1": "181915.0816",
                        "tooltipText": "",
                        "segment": "1",
                        "ci0": "120216.6475",
                        "rawValue": "145538.9762"
                      },
                      {
                        "truncDate": "2024-04-01T00:00:00Z",
                        "segment": "1",
                        "ci0": "90096.1571",
                        "formattedRawValue": "136.8K",
                        "formattedTruncDate": "Q2 2024",
                        "changeSentiment": "neutral",
                        "rawValue": "136809.1450",
                        "point": 0,
                        "showIsolatedPoint": 0,
                        "dashed": false,
                        "tooltipText": "",
                        "tooltipMarkup": "<span data-type=\"period\">Q2 2024</span><span data-type=\"actual-label\">Actual</span><span data-type=\"actual-value\">136.8K (136,809.14)</span>",
                        "ci1": "147232.4450"
                      },
                      {
                        "formattedTruncDate": "Q1 2024",
                        "segment": "1",
                        "formattedRawValue": "94.8K",
                        "showIsolatedPoint": 0,
                        "tooltipText": "",
                        "truncDate": "2024-01-01T00:00:00Z",
                        "dashed": false,
                        "changeSentiment": "neutral",
                        "ci0": "66542.0564",
                        "rawValue": "94840.2150",
                        "tooltipMarkup": "<span data-type=\"period\">Q1 2024</span><span data-type=\"actual-label\">Actual</span><span data-type=\"actual-value\">94.8K (94,840.21)</span>",
                        "ci1": "124277.9977",
                        "point": 0
                      },
                      {
                        "showIsolatedPoint": 0,
                        "formattedTruncDate": "Q4 2023",
                        "point": 0,
                        "ci0": "156012.2328",
                        "changeSentiment": "neutral",
                        "tooltipMarkup": "<span data-type=\"period\">Q4 2023</span><span data-type=\"actual-label\">Actual</span><span data-type=\"actual-value\">182.9K (182,912.25)</span>",
                        "segment": "1",
                        "ci1": "217804.5577",
                        "dashed": false,
                        "tooltipText": "",
                        "rawValue": "182912.2542",
                        "formattedRawValue": "182.9K",
                        "truncDate": "2023-10-01T00:00:00Z"
                      },
                      {
                        "formattedTruncDate": "Q3 2023",
                        "dashed": false,
                        "showIsolatedPoint": 0,
                        "tooltipMarkup": "<span data-type=\"period\">Q3 2023</span><span data-type=\"actual-label\">Actual</span><span data-type=\"actual-value\">130.4K (130,449.38)</span>",
                        "truncDate": "2023-07-01T00:00:00Z",
                        "rawValue": "130449.3752",
                        "formattedRawValue": "130.4K",
                        "point": 0,
                        "changeSentiment": "neutral",
                        "segment": "1",
                        "ci1": "155769.5390",
                        "tooltipText": "",
                        "ci0": "93831.3645"
                      }
                    ]
                  },
                  "config": {
                    "axis": {
                      "labelAngle": {
                        "expr": "axisLabelAngle"
                      },
                      "labelFont": {
                        "expr": "axisLabelFontFace"
                      },
                      "labelFontSize": {
                        "expr": "axisLabelFontSize"
                      },
                      "ticks": false,
                      "domain": false,
                      "labelPadding": {
                        "expr": "axisLabelPadding"
                      },
                      "title": null,
                      "labelColor": {
                        "expr": "axisLabelColor"
                      },
                      "labelLineHeight": {
                        "expr": "axisLabelFontSize"
                      },
                      "labelOffset": {
                        "expr": "axisLabelOffset"
                      }
                    },
                    "customFormatTypes": true
                  },
                  "encoding": {
                    "x": {
                      "scale": {
                        "type": "point",
                        "padding": {
                          "expr": "xAxisScalePadding"
                        }
                      },
                      "field": "truncDate",
                      "type": "ordinal",
                      "axis": {
                        "values": {
                          "expr": "xAxisLabelsDataValues"
                        },
                        "labelOverlap": true,
                        "offset": {
                          "expr": "xAxisOffset"
                        },
                        "gridColor": {
                          "expr": "xAxisGridColorDefault",
                          "condition": [
                            {
                              "expr": "xAxisGridColorActive",
                              "test": "activeLabelAndGridDate === datum.value"
                            }
                          ]
                        },
                        "labelFontWeight": {
                          "condition": [
                            {
                              "test": "activeLabelAndGridDate === datum.value",
                              "expr": "xAxisLabelFontWeightActive"
                            }
                          ],
                          "expr": "xAxisLabelFontWeightDefault"
                        },
                        "format": {
                          "mapName": "xAxis",
                          "custom": true
                        },
                        "gridOpacity": {
                          "expr": "datum.index === 0 ? 0 : 1"
                        },
                        "grid": true,
                        "labelAlign": {
                          "condition": [
                            {
                              "test": "datum.index === 0",
                              "value": "left"
                            },
                            {
                              "value": "right",
                              "test": "datum.index === 1"
                            }
                          ],
                          "value": "center"
                        }
                      }
                    }
                  },
                  "view": {
                    "stroke": null
                  },
                  "params": [
                    {
                      "name": "axisLabelFontFace",
                      "value": "'SF Pro Text', 'SF Pro Display', system-ui, -apple-system, blinkmacsystemfont, 'Segoe UI', roboto, ubuntu, 'Fire Sans', 'Helvetica Neue', sans-serif"
                    },
                    {
                      "value": 14,
                      "name": "axisLabelFontSize"
                    },
                    {
                      "name": "axisLabelColor",
                      "value": "#343A3F"
                    },
                    {
                      "name": "axisLabelLineHeight",
                      "value": 14
                    },
                    {
                      "value": 0,
                      "name": "axisLabelAngle"
                    },
                    {
                      "name": "axisLabelPadding",
                      "value": 0
                    },
                    {
                      "name": "axisLabelOffset",
                      "value": 0
                    },
                    {
                      "name": "currentValueCircleColor1",
                      "value": "#058AFF"
                    },
                    {
                      "name": "currentValueCircleColor2",
                      "value": "#fff"
                    },
                    {
                      "name": "currentValueCircleSize",
                      "value": 160
                    },
                    {
                      "name": "currentValueCircleStrokeWidth",
                      "value": 3
                    },
                    {
                      "name": "currentValueColor",
                      "value": "#040507"
                    },
                    {
                      "name": "currentValueFontFace",
                      "value": "'SF Pro Text', 'SF Pro Display', system-ui, -apple-system, blinkmacsystemfont, 'Segoe UI', roboto, ubuntu, 'Fire Sans', 'Helvetica Neue', sans-serif"
                    },
                    {
                      "value": 14,
                      "name": "currentValueFontSize"
                    },
                    {
                      "value": 600,
                      "name": "currentValueFontWeight"
                    },
                    {
                      "value": 10,
                      "name": "currentValuePadding"
                    },
                    {
                      "name": "hoverVerticalLineColor",
                      "value": "#040507"
                    },
                    {
                      "name": "hoverVerticalLineOpacity",
                      "value": 0.3
                    },
                    {
                      "name": "hoverDotColor",
                      "value": "#040507"
                    },
                    {
                      "name": "hoverDotSize",
                      "value": 80
                    },
                    {
                      "name": "leftYAxisOffset",
                      "value": 10
                    },
                    {
                      "name": "lineColor",
                      "value": "#058AFF"
                    },
                    {
                      "name": "lineStrokeWidth",
                      "value": 4
                    },
                    {
                      "name": "lineStrokeDash",
                      "value": [6, 3]
                    },
                    {
                      "name": "normalRangeColor",
                      "value": "#E3F2FF"
                    },
                    {
                      "name": "normalRangeOpacity",
                      "value": 1
                    },
                    {
                      "name": "normalRangeStrokeWidth",
                      "value": 0.5
                    },
                    {
                      "name": "xAxisScalePadding",
                      "value": -20
                    },
                    {
                      "name": "xAxisOffset",
                      "value": 20
                    },
                    {
                      "value": "#c9c9c9",
                      "name": "xAxisGridColorDefault"
                    },
                    {
                      "value": "#040507",
                      "name": "xAxisGridColorActive"
                    },
                    {
                      "value": "normal",
                      "name": "xAxisLabelFontWeightDefault"
                    },
                    {
                      "name": "xAxisLabelFontWeightActive",
                      "value": 600
                    },
                    {
                      "name": "colorUndesiredChange",
                      "value": "#F9437A"
                    },
                    {
                      "name": "colorDesiredChange",
                      "value": "#1C9B5C"
                    },
                    {
                      "name": "mode",
                      "value": "LastComplete"
                    },
                    {
                      "name": "xAxisLabelsDataValues",
                      "value": ["2023-07-01T00:00:00Z", "2025-04-01T00:00:00Z"]
                    },
                    {
                      "name": "yAxisLabelsDataValues",
                      "value": ["0.0000", "237625.9108", "118812.9554"]
                    },
                    {
                      "name": "lastPointCircleMode",
                      "value": "filled"
                    },
                    {
                      "name": "activeLabelAndGridDate",
                      "value": "2025-04-01T00:00:00Z"
                    }
                  ],
                  "customFormatterMaps": {
                    "xAxis": {
                      "2025-04-01T00:00:00Z": "Q2 2025",
                      "2023-07-01T00:00:00Z": "Q3 2023"
                    },
                    "yAxis": {
                      "237625.9108": "237.6K",
                      "118812.9554": "118.8K",
                      "0.0000": "0"
                    }
                  },
                  "width": "container"
                },
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
