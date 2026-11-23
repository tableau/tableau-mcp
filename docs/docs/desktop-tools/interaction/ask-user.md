---
sidebar_position: 2
---

# Ask the User a Clarifying Question

{/* availability */}
<span className="toolAvailability">Available September 2026 and later.</span>
{/* /availability */}

Pauses to ask the human user a clarifying question instead of guessing, and stops to wait for their answer. Use it when a request is ambiguous — the tool formats the question (optionally with a short list of choices) and returns it to the MCP client so the person can respond before the agent continues.

The `urgency` argument controls how the agent should treat the pause:

- `blocking` (default) — wait for the user's answer before doing anything else.
- `soft` — state a sensible default the agent will use if the user does not reply.


## APIs called

This tool does not call the %product_name% %ecapi_name%. It is a client-side interaction: it formats the question and hands it back to the human user through the MCP client. Because nothing is sent to the running %product_name% instance, there is no loopback route and no per-session bearer token involved — the question never leaves the MCP client. Formatting the prompt is an in-process step, not an API call.

## Required arguments

### `question`

The question to put to the user, as a non-empty string. An empty string is rejected before the tool runs.

#### Example

```json
{ "question": "Which Sales field should I use?" }
```

## Optional arguments

### `urgency`

How the agent should treat the pause while waiting for an answer. One of `blocking` or `soft`. Defaults to `blocking`. The chosen value is rendered as an uppercase prefix on the returned prompt (for example `[BLOCKING]` or `[SOFT]`).

- `blocking` — wait for the user's answer before proceeding.
- `soft` — proceed with a stated default if the user does not respond.

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
