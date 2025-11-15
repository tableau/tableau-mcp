---
sidebar_position: 7
---

# Generate Pulse Insight Brief

Generates a concise insight brief for a Pulse metric, optimized for quick consumption in emails, notifications, or mobile displays.

## What is an Insight Brief?

An **insight brief** is a condensed, text-focused summary of metric changes that provides:

- **Quick overview** - Key insights without detailed visualizations
- **Concise format** - Optimized for notifications, emails, and mobile
- **Action-oriented** - Highlights what changed and why
- **Minimal data** - Just the essentials for fast consumption

### Comparison with Other Bundle Types

| Bundle Type | Purpose | Best For |
|------------|---------|----------|
| **Brief** | Quick summary | Notifications, emails, mobile, daily digests |
| **Detail** | Comprehensive analysis | Investigation, dashboard views, deep dives |
| **Ban** | Current value snapshot | Banner displays, at-a-glance metrics |
| **Breakdown** | Dimension analysis | Understanding categorical distributions |

## APIs called

- [Generate insight brief](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_pulse.htm#PulseInsightsService_GenerateInsightBundleBreakdown)

## Required arguments

### `bundleRequest`

The request to generate a brief for. This requires the full Pulse Metric and Pulse Metric Definition information.

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
        "name": "Sales",
        "metric_id": "CF32DDCC-362B-4869-9487-37DA4D152552",
        "definition_id": "BBC908D8-29ED-48AB-A78E-ACF8A424C8C3"
      },
      "metric": {
        "definition": {
          "datasource": {
            "id": "A6FC3C9F-4F40-4906-8DB0-AC70C5FB5A11"
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
            "granularity": "GRANULARITY_BY_MONTH",
            "range": "RANGE_CURRENT_PARTIAL"
          },
          "comparison": {
            "comparison": "TIME_COMPARISON_PREVIOUS_PERIOD"
          }
        },
        "extension_options": {
          "allowed_dimensions": ["Region", "Category"],
          "allowed_granularities": ["GRANULARITY_BY_DAY", "GRANULARITY_BY_MONTH"],
          "offset_from_today": 0
        },
        "representation_options": {
          "type": "NUMBER_FORMAT_TYPE_NUMBER",
          "number_units": {
            "singular_noun": "dollar",
            "plural_noun": "dollars"
          },
          "row_level_id_field": {
            "identifier_col": "Order ID"
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
          "settings": []
        }
      }
    }
  }
}
```

## Use Cases

### Daily Digest Emails
Generate brief summaries for automated email digests:
```
"Sales was $150K (Nov 2025), up 23% vs. prior month. 
West region drove most of the growth (+45%)."
```

### Mobile Notifications
Push notifications with concise metric updates:
```
"🔔 Customer Count up 15% today - highest this quarter"
```

### Slack/Teams Bots
Quick metric updates in chat channels:
```
"/pulse-brief sales"
→ Sales: $50K (+12%) | Top: West region | Status: Above target
```

### Dashboard Tooltips
Contextual metric summaries on hover:
```
[Hover over metric card]
→ Brief: "Q4 Sales exceeded target by 8%, 
   primarily due to Technology category growth"
```

### Executive Summaries
Concise reporting for leadership:
```
Daily Brief - Nov 14, 2025:
• Revenue: $2.1M (+5%)
• New Customers: 142 (+18%)
• Support Tickets: 89 (-12%)
```

## Example Response

```json
{
  "bundle_response": {
    "result": {
      "insight_groups": [
        {
          "type": "brief",
          "insights": [
            {
              "insight_type": "popc",
              "result": {
                "markup": "Sales was $150,000 (November 2025 month to date), up 23.5% (29,000) compared to the prior period (October 2025)."
              }
            },
            {
              "insight_type": "top-drivers",
              "result": {
                "markup": "West region increased the most (+45%), contributing $13,500 of the growth."
              }
            }
          ],
          "summaries": [
            "Sales increased 23.5% vs. last month, driven primarily by West region."
          ]
        }
      ],
      "has_errors": false,
      "characterization": "CHARACTERIZATION_UNSPECIFIED"
    }
  }
}
```

## Building a "Pulse Discover" Feature

You can use insight briefs to build a custom Pulse Discover-like experience:

1. **List user subscriptions** - Get all metrics a user follows
2. **Generate briefs** - For each subscription, get the insight brief
3. **Rank by importance** - Use AI to identify which metrics need attention
4. **Create daily digest** - Summarize into a morning brief

```typescript
// Pseudocode example
const subscriptions = await listPulseMetricSubscriptions(userId);
const briefs = await Promise.all(
  subscriptions.map(sub => generatePulseInsightBrief(sub.metric))
);
const digest = await AI.summarize(briefs, {
  prioritize: "significant_changes",
  format: "daily_brief"
});
```

## Notes

- Insight briefs are **text-heavy** with minimal visualizations
- Optimized for **mobile and notification** contexts
- Focus on **what changed** and **key drivers**
- Typically **shorter** than detail bundles
- Ideal for **automated reporting** systems



