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
