---
sidebar_position: 7
---

# Generate Pulse Insight Brief

{/* availability */}
<span className="toolAvailability">Available June 2026 and later.</span>
{/* /availability */}

Generates AI-powered conversational insights for Pulse metrics based on natural language questions.
This tool enables interactive, multi-turn conversations about your metrics data.

An **insight brief** is an AI-generated response to questions about Pulse metrics. It provides natural
language answers to specific questions, contextual summaries based on metric data, action-oriented
advice and recommendations, and a conversational format optimized for chat interfaces — with
multi-turn support that maintains context across questions.

Typical use cases include conversational analytics (natural language Q&A about metrics), executive
briefings ("What should I know about my metrics today?"), context-aware intelligent alerts, and
multi-metric analysis across several metrics at once.

Compared with the other Pulse insight bundle types:

| Bundle type   | Purpose                            | Best for                                       |
| ------------- | ---------------------------------- | ---------------------------------------------- |
| **Brief**     | AI-powered conversational insights | Chat interfaces, Q&A, multi-turn conversations |
| **Detail**    | Comprehensive analysis             | Investigation, dashboard views, deep dives     |
| **Ban**       | Current value snapshot             | Banner displays, at-a-glance metrics           |
| **Breakdown** | Dimension analysis                 | Understanding categorical distributions        |

## APIs called

This tool talks to the Tableau REST API (Tableau Cloud or Server), specifically the Pulse Insights
service. It is gated at the MCP layer by the `tableau:mcp:insight:create` scope. When per-site MCP
configuration is enabled, resolving the caller's bounded context additionally reads MCP site settings
(the `tableau:mcp_site_settings:read` scope), so the union of scopes across this tool is
`tableau:insight_brief:create` and `tableau:mcp_site_settings:read`.

- Generate an AI-powered insight brief from the supplied conversation history and metric context.
  - `POST /api/-/pulse/insights/brief` — generate the insight brief. Issued against the Pulse Insights service of the Tableau REST API; requires the `tableau:insight_brief:create` OAuth scope. [Generate insight brief](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_pulse.htm#EmbeddingsService_GenerateInsightBrief)

## Required arguments

### `briefRequest`

The request to generate an insight brief. This includes the conversation history, language/locale
settings, and metric context. Key fields:

- `language`: language for the response (e.g. `LANGUAGE_EN_US`)
- `locale`: locale for formatting (e.g. `LOCALE_EN_US`)
- `messages`: array of conversation messages (see below)
- `now`: optional current time in `YYYY-MM-DD HH:MM:SS` or `YYYY-MM-DD` format (defaults to midnight if the time is omitted)
- `time_zone`: optional timezone for date/time calculations

#### Message structure

Each message in the `messages` array contains:

- `action_type`: type of action
  - `ACTION_TYPE_ANSWER` — answer a specific question
  - `ACTION_TYPE_SUMMARIZE` — provide a summary
  - `ACTION_TYPE_ADVISE` — give recommendations
- `content`: the question or response text (string)
- `role`: who sent the message
  - `ROLE_USER` — user's question
  - `ROLE_ASSISTANT` — AI's response
- `metric_group_context`: array of metrics being analyzed
- `metric_group_context_resolved`: whether the metric context is resolved (boolean)

#### Multi-turn conversations

To enable follow-up questions and richer insights, include the full conversation history in the
`messages` array:

1. Add the initial user question with `role: 'ROLE_USER'`
2. Add the assistant's response with `role: 'ROLE_ASSISTANT'` and `content` containing the previous
   response text
3. Add the follow-up question with `role: 'ROLE_USER'`

Without conversation history, follow-up questions may lack context and provide less detailed answers.

:::note[Data requirements]
The API works best when all metrics in `metric_group_context` come from the same data source, so the
backend can apply consistent filters across them; group metrics by data source and make a separate
call per data source for optimal results. The `metric_group_context` must also include complete metric
data from the metric definition — populated `extension_options` (`allowed_dimensions` and
`allowed_granularities`), correct `representation_options` (`sentiment_type`, `currency_code`, and
format settings), and `insights_options.settings` with all insight types and their enabled/disabled
state. Incomplete data can cause API errors even when it passes schema validation. When the server is
configured with an allowed set of data sources, metrics derived from data sources outside that set are
filtered out, and a message left with no permitted metrics is rejected.
:::

#### Measurement period

Each metric's `metric_specification.measurement_period` is checked before the request reaches Pulse.
Pulse ignores some period combinations rather than rejecting them, which would return an insight for
a different period than the one asked for, so the tool refuses the call instead and generates
nothing:

- `measurement_period.specific_period is only honored when measurement_period.range is 'RANGE_BY_CONFIG'` — the refusal names the range it received. For a today-relative window drop `specific_period`; to analyze the explicit period or span, set `range` to `'RANGE_BY_CONFIG'`.
- `measurement_period.last_x_period is only honored when measurement_period.range is 'RANGE_BY_CONFIG'` — the refusal names the range it received.
- `measurement_period.last_x_period and measurement_period.specific_period cannot both be set — use last_x_period for a supported rolling window or specific_period for a fixed span.`
- `a day-based measurement_period.last_x_period requires measurement_period.granularity = 'GRANULARITY_BY_DAY'.`
- `the trailing-year measurement_period.last_x_period requires measurement_period.granularity = 'GRANULARITY_BY_MONTH'.`

Each refusal names the field at fault and the value it received, so the request can be corrected
without guessing.

#### Example: initial question

```json
{
  "language": "LANGUAGE_EN_US",
  "locale": "LOCALE_EN_US",
  "messages": [
    {
      "action_type": "ACTION_TYPE_SUMMARIZE",
      "content": "What are the key insights for Sales?",
      "role": "ROLE_USER",
      "metric_group_context": [
        {
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
              "sentiment_type": "SENTIMENT_TYPE_NONE",
              "row_level_id_field": {
                "identifier_col": "Order ID"
              },
              "row_level_entity_names": {
                "entity_name_singular": "Order",
                "entity_name_plural": "Orders"
              },
              "row_level_name_field": {
                "name_col": "Order Name"
              },
              "currency_code": "CURRENCY_CODE_USD"
            },
            "insights_options": {
              "settings": [
                { "type": "INSIGHT_TYPE_TOP_DRIVERS", "disabled": false },
                { "type": "INSIGHT_TYPE_METRIC_FORECAST", "disabled": false }
              ]
            }
          }
        }
      ],
      "metric_group_context_resolved": true
    }
  ]
}
```

#### Example: follow-up question with conversation history

```json
{
  "language": "LANGUAGE_EN_US",
  "locale": "LOCALE_EN_US",
  "messages": [
    {
      "action_type": "ACTION_TYPE_SUMMARIZE",
      "content": "What are the key insights for Sales?",
      "role": "ROLE_USER",
      "metric_group_context": [
        {}
      ],
      "metric_group_context_resolved": true
    },
    {
      "action_type": "ACTION_TYPE_SUMMARIZE",
      "content": "Sales increased 5% with growth in Region A and B...",
      "role": "ROLE_ASSISTANT",
      "metric_group_context": [
        {}
      ],
      "metric_group_context_resolved": true
    },
    {
      "action_type": "ACTION_TYPE_ANSWER",
      "content": "What factors contributed to the increase?",
      "role": "ROLE_USER",
      "metric_group_context": [
        {}
      ],
      "metric_group_context_resolved": true
    }
  ]
}
```

:::note[Refusals]
The tool refuses the request before calling Pulse when any of the following is true. With more than one message, that message's errors are prefixed with `messages[<n>]: `. Each metric's errors are prefixed with `metric_group_context[<n>]: `. `measure.field` and `measure.aggregation` are checked when the metric has a basic specification.

- `messages array is empty. At least one message is required.`
- `content is empty. Provide a question or prompt.`
- `metric_group_context is empty. At least one metric is required.`
- `definition.datasource.id is empty.`
- `measure.field is empty.`
- `measure.aggregation must be set (not UNSPECIFIED).`
- `measurement_period.granularity must be set.`
- `measurement_period.range must be set.`
- `comparison.comparison must be set.`
:::

## Notes and caveats

- This tool is read-only: it generates insights and does not modify any Tableau content.
- AI-powered Pulse insights must be enabled for your Tableau site. If Pulse or its AI insights are
  turned off for the site, the tool reports that the capability is unavailable rather than returning a
  brief.

## Example result

```json
{
  "data": {
    "markup": "- **Forecast for November 22, 2025**: The forecasted value for Sales is $150K, with a confidence range of $145K to $155K.\n\n- **Month-to-Date Comparison**: Sales for November 2025 month-to-date is $150K, which is a 5.0% increase compared to October 2025 month-to-date ($142.9K).\n\nOverall, the metric shows a positive trend with a slight increase month-to-date and a stable forecast.",
    "generation_id": "abc123...",
    "source_insights": [
      {
        "type": "forecast",
        "markup": "The forecast for Sales for November 22, 2025 is $150K with a confidence range of $145K to $155K.",
        "viz": {},
        "facts": {}
      },
      {
        "type": "popc",
        "markup": "Sales was $150K (November 2025 month to date), up 5.0% ($7.1K) compared to the prior period.",
        "viz": {},
        "facts": {}
      }
    ],
    "follow_up_questions": [
      { "content": "What factors contributed to the increase in Sales?" },
      { "content": "How does the forecast compare to historical trends?" }
    ],
    "group_context": [],
    "not_enough_information": false
  }
}
```

Response fields:

- `markup`: AI-generated markdown text with the answer
- `generation_id`: unique ID for this generation
- `source_insights`: array of underlying insights used to generate the response — each insight includes `type`, `markup`, `viz` (a Vega-Lite spec), and `facts`
- `follow_up_questions`: suggested next questions to continue the conversation
- `group_context`: the full metric context used
- `not_enough_information`: boolean indicating whether the AI had insufficient data

## Related

- [`generate-pulse-metric-value-insight-bundle`](generate-pulse-metric-value-insight-bundle.md) — generate a value insight bundle (ban, detail, breakdown, and more) for a Pulse metric
- [`list-all-pulse-metric-definitions`](list-all-pulse-metric-definitions.md) — list published Pulse metric definitions to build the metric context
- [`list-pulse-metrics-from-metric-ids`](list-pulse-metrics-from-metric-ids.md) — fetch Pulse metrics by ID for the metric context

{/* tool-details */}
## What is an Insight Brief?

An **insight brief** is an AI-generated response to questions about Pulse metrics that provides:

- **Natural language answers** - Conversational responses to specific questions
- **Contextual summaries** - AI-powered analysis based on metric data
- **Action-oriented advice** - Recommendations and next steps
- **Conversational format** - Optimized for chat interfaces and follow-up questions
- **Multi-turn support** - Maintains conversation context across multiple questions

### Comparison with Other Bundle Types

## Multi-Turn Conversations

**Important:** To enable follow-up questions and richer insights, you must include the full

## Use Cases

### Conversational Analytics

Interactive Q&A about metrics:

```
User: "What are the key insights for Sales?"
AI: "Sales is up 5% with growth in West region..."

User: "What factors contributed to the increase?"
AI: "The increase was driven by Technology category growth..."
```

### Executive Briefings

Natural language metric summaries:

## Response Fields

- Each insight includes `type`, `markup`, `viz` (Vega-Lite spec), and `facts`
- `not_enough_information`: Boolean indicating if the AI had insufficient data

## Notes

- **Conversational**: Designed for multi-turn Q&A about metrics
- **Context-aware**: Maintains conversation history for richer responses
- **AI-powered**: Uses natural language understanding to answer questions
- **Visualization-rich**: Includes Vega-Lite specs for charts
- **Follow-up suggestions**: Provides relevant next questions
- **Ideal for chat interfaces**: Slack, Teams, ChatGPT, Claude, etc.
{/* /tool-details */}
