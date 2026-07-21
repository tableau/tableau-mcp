---
name: datasource-to-dashboard
description: Use when a user explores their Tableau site data or asks for help solving a problem with their data and would benefit from seeing and publishing it - points Claude at the canonical build-data-app workflow served by the Tableau MCP server
---

# Datasource to Dashboard

## Overview

This is a thin, Claude-specific pointer. It is **not** the source of truth for the workflow — that
lives on the Tableau MCP server as the `skill://tableau/build-data-app` MCP resource. Read that
resource before acting; this file only tells Claude when to reach for it and how to render the
result on this client.

## When to Use

Use when:
- The user is exploring data on their Tableau site and a picture would help them understand it.
- The user asks for help solving a problem that their site data can answer.
- You have just returned multi-row data with a measure and the user would benefit from seeing it.
- The user asks to "chart this", "visualize this", "make a dashboard", or "publish this to Tableau".

Don't use when:
- The result is a single-value lookup, an empty result set, or an error.
- The user only wants the raw rows or a text answer and has not signaled interest in a visualization.

## What to Do

1. Read the `skill://tableau/build-data-app` MCP resource from the connected Tableau MCP server. It
   defines the full workflow: intent detection, free-form querying, workspace authoring, rendering
   for review, iteration, validation, explicit consent, and receipt-based publish.
2. Follow that workflow. It applies to any MCP client, not just Claude.
3. On Claude Desktop and Claude.ai, render the resulting app using Claude's native artifact
   capability so the human can actually see it before you move on to validation or publication.

## Claude-specific guidance

- **Infer intent from ordinary language.** You do not need the user to name a tool or say "data app".
  When someone explores their site data or asks a question a picture would answer, reach for this
  workflow.
- **Render with Claude's native artifact capability when available.** On Claude Desktop and Claude.ai,
  show the app as an artifact the human can actually see. The
  `data-app://workspace/{appId}/preview` resource is a portable fallback for hosts without native
  rendering — treat it as source, not a guarantee that the page's JavaScript runs.
- **Write the same source into the workspace once.** Author with `upsert-data-app-files` a single time
  per revision. Do not restate the full HTML on later tool calls.
- **Do not restate HTML during validation or publication.** `validate-workbook-package` and
  `create-and-publish-workbook` operate on the workspace and the `validationId` receipt — pass the IDs,
  not the source, once the source is in the workspace.
- **Use `localPath` only when scaffold explicitly returns it.** It is present only on a single-user
  local stdio server with local-path exposure enabled. If `scaffold-data-app` does not return it, it
  is unavailable — rely on the tools and the preview resource instead.

## Notes

- Do not duplicate the canonical workflow steps here — if the server-side resource changes, this
  file should not need to change in lockstep, because it defers to the resource rather than
  restating it.
- The workflow it points to is static-data-only: the app renders the exact rows returned by a query;
  it does not run live queries against Tableau at view time.
