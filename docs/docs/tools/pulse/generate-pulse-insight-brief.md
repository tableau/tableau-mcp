---
sidebar_position: 7
---

# Generate Pulse Insight Brief

Generates AI-powered conversational insights for Pulse metrics based on natural language questions.
This tool enables interactive, multi-turn conversations about your metrics data.

## What is an Insight Brief?

An **insight brief** is an AI-generated response to questions about Pulse metrics that provides:

- **Natural language answers** - Conversational responses to specific questions
- **Contextual summaries** - AI-powered analysis based on metric data
- **Action-oriented advice** - Recommendations and next steps
- **Conversational format** - Optimized for chat interfaces and follow-up questions
- **Multi-turn support** - Maintains conversation context across multiple questions

### Comparison with Other Bundle Types

| Bundle Type   | Purpose                            | Best For                                       |
| ------------- | ---------------------------------- | ---------------------------------------------- |
| **Brief**     | AI-powered conversational insights | Chat interfaces, Q&A, multi-turn conversations |
| **Detail**    | Comprehensive analysis             | Investigation, dashboard views, deep dives     |
| **Ban**       | Current value snapshot             | Banner displays, at-a-glance metrics           |
| **Breakdown** | Dimension analysis                 | Understanding categorical distributions        |

## APIs called

- [Generate insight brief](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_pulse.htm#PulseInsightsService_GenerateInsightBrief)

## Required arguments

### `briefRequest`

The request to generate an insight brief. This includes the conversation history, language/locale
settings, and metric context.

**Key fields:**

- `language`: Language for the response (e.g., 'LANGUAGE_EN_US')
- `locale`: Locale for formatting (e.g., 'LOCALE_EN_US')
- `messages`: Array of conversation messages (see below)
- `now`: Optional current time in 'YYYY-MM-DD HH:MM:SS' or 'YYYY-MM-DD' format
- `time_zone`: Optional timezone for date/time calculations

### Message Structure

Each message in the `messages` array contains:

- `action_type`: Type of action
  - `ACTION_TYPE_ANSWER` - Answer a specific question
  - `ACTION_TYPE_SUMMARIZE` - Provide a summary
  - `ACTION_TYPE_ADVISE` - Give recommendations
- `content`: The question or response text (string)
- `role`: Who sent the message
  - `ROLE_USER` - User's question
  - `ROLE_ASSISTANT` - AI's response
- `metric_group_context`: Array of metrics being analyzed
- `metric_group_context_resolved`: Whether metric context is resolved (boolean)

## Multi-Turn Conversations

**Important:** To enable follow-up questions and richer insights, you must include the full
conversation history in the `messages` array:

1. Add the initial user question with `role: 'ROLE_USER'`
2. Add the assistant's response with `role: 'ROLE_ASSISTANT'` and `content` containing the previous
   response text
3. Add the follow-up question with `role: 'ROLE_USER'`

Without conversation history, follow-up questions may lack context and provide less detailed
answers.

### Example: Initial Question

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

### Example: Follow-up Question with Conversation History

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
        /* ... */
      ],
      "metric_group_context_resolved": true
    },
    {
      "action_type": "ACTION_TYPE_SUMMARIZE",
      "content": "Sales increased 5% with growth in Region A and B...",
      "role": "ROLE_ASSISTANT",
      "metric_group_context": [
        /* ... */
      ],
      "metric_group_context_resolved": true
    },
    {
      "action_type": "ACTION_TYPE_ANSWER",
      "content": "What factors contributed to the increase?",
      "role": "ROLE_USER",
      "metric_group_context": [
        /* ... */
      ],
      "metric_group_context_resolved": true
    }
  ]
}
```

## Use Cases

### Conversational Analytics

Interactive Q&A about metrics:

```
User: "What are the key insights for Sales?"
AI: "Sales is up 5% with growth in West region..."

User: "What factors contributed to the increase?"
AI: "The increase was driven by Technology category growth..."
```

### ChatGPT/Claude Integration

Build AI-powered metric exploration:

```typescript
// Example integration
const response = await generatePulseInsightBrief({
  language: 'LANGUAGE_EN_US',
  locale: 'LOCALE_EN_US',
  messages: conversationHistory,
});
```

### Slack/Teams Bots

Interactive metric exploration in chat:

```
/pulse ask "Why did revenue drop this week?"
→ "Revenue decreased 8% due to lower activity in the Enterprise segment..."

/pulse followup "How does this compare to last year?"
→ "This is actually 12% higher than the same week last year..."
```

### Executive Briefings

Natural language metric summaries:

```
"What should I know about my metrics today?"
→ AI-generated summary of key changes, trends, and recommendations
```

## Example Response

```json
{
  "data": {
    "markup": "- **Forecast for November 22, 2025**: The forecasted value for Sales is $150K, with a confidence range of $145K to $155K.\n\n- **Month-to-Date Comparison**: Sales for November 2025 month-to-date is $150K, which is a 5.0% increase compared to October 2025 month-to-date ($142.9K).\n\nOverall, the metric shows a positive trend with a slight increase month-to-date and a stable forecast.",
    "generation_id": "abc123...",
    "source_insights": [
      {
        "type": "forecast",
        "markup": "The forecast for Sales for November 22, 2025 is $150K with a confidence range of $145K to $155K.",
        "viz": {
          /* Vega-Lite visualization spec */
        },
        "facts": {
          /* Insight facts and data */
        }
      },
      {
        "type": "popc",
        "markup": "Sales was $150K (November 2025 month to date), up 5.0% ($7.1K) compared to the prior period.",
        "viz": {
          /* Vega-Lite visualization spec */
        },
        "facts": {
          /* Insight facts and data */
        }
      }
    ],
    "follow_up_questions": [
      { "content": "What factors contributed to the increase in Sales?" },
      { "content": "How does the forecast compare to historical trends?" }
    ],
    "group_context": [
      /* Full metric context */
    ],
    "not_enough_information": false
  }
}
```

## Response Fields

- `markup`: AI-generated markdown text with the answer
- `generation_id`: Unique ID for this generation
- `source_insights`: Array of underlying insights used to generate the response
  - Each insight includes `type`, `markup`, `viz` (Vega-Lite spec), and `facts`
- `follow_up_questions`: Suggested next questions to continue the conversation
- `group_context`: The full metric context used
- `not_enough_information`: Boolean indicating if the AI had insufficient data

## Notes

- **Conversational**: Designed for multi-turn Q&A about metrics
- **Context-aware**: Maintains conversation history for richer responses
- **AI-powered**: Uses natural language understanding to answer questions
- **Visualization-rich**: Includes Vega-Lite specs for charts
- **Follow-up suggestions**: Provides relevant next questions
- **Ideal for chat interfaces**: Slack, Teams, ChatGPT, Claude, etc.
