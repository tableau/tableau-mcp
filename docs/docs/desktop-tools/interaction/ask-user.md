---
sidebar_position: 2
---

# Ask the User a Clarifying Question

{/* availability */}
<span className="toolAvailability">Available September 2026 and later.</span>
{/* /availability */}

Formats a clarifying question for the user, so the agent asks instead of guessing. Use it when a request is ambiguous. The tool returns the question to the agent right away as text, prefixed with `[BLOCKING]` or `[SOFT]`, with any choices numbered under `Options:`. It does not wait for an answer: the agent is expected to put the question to the user and act on the urgency.

The `urgency` argument controls how the agent should treat the pause:

- `blocking` (default) — the agent asks the user and stops until they answer.
- `soft` — the agent asks the user and states the default it will use if they do not reply.


## APIs called

This tool does not call the %product_name% %ecapi_name%. It formats the question in-process and returns it as a plain text result. It sends no MCP elicitation request and does not wait for the user's answer; any pause is up to the agent. Because nothing is sent to the running %product_name% instance, there is no loopback route and no per-session bearer token involved.

## Required arguments

### `question`

The question to put to the user, as a non-empty string. An empty string is rejected before the tool runs.

#### Example

```json
{ "question": "Which Sales field should I use?" }
```

## Optional arguments

### `urgency`

How the agent should treat the question. One of `blocking` or `soft`. Defaults to `blocking`. The chosen value is rendered as an uppercase prefix on the returned prompt (for example `[BLOCKING]` or `[SOFT]`).

- `blocking` — the agent stops until the user answers.
- `soft` — the agent states a default and can go on with it if the user does not answer.

#### Example

`"soft"`

<hr />

### `options`

A short list of answer choices to offer the user, as an array of strings (typically 2–5). When provided, the choices are appended to the prompt as a numbered list; when omitted, the question is returned on its own.

#### Example

```json
{ "options": ["Sales", "Profit", "Revenue"] }
```

## Example result

The tool returns the formatted prompt as text: an uppercase urgency prefix, the question, and — when `options` is supplied — a numbered list of the choices.

```json
{
  "isError": false,
  "content": [
    {
      "type": "text",
      "text": "[BLOCKING] Which field should I use?\n\nOptions:\n1. Sales\n2. Profit\n3. Revenue"
    }
  ]
}
```
