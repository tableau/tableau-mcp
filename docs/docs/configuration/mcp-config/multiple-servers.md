---
sidebar_position: 8
---

# Running Multiple Servers & Diagnosing Auth Errors

You can configure more than one Tableau MCP server in the same client (for example a
production site, a stage site, and a local build). When you do, two things become important:
keeping them **distinctly named** so both you and the AI can tell them apart, and knowing how to
**read an authentication error** so it is not mistaken for a missing feature.

## Name each server distinctly

The AI client chooses which configured server to send a tool call to. If several servers are
configured with similar names — or several expose the same tool — a request can land on the
**wrong** server, or on one that is **not authenticated**. When that happens the failure often
reads like "the feature isn't set up," when the real cause is *which server answered*.

Give each server a name that encodes site + purpose, e.g.:

```json
{
  "mcpServers": {
    "tableau-prod-acme":  { "command": "npx", "args": ["-y", "@tableau/mcp-server@latest"], "env": { "SERVER": "https://prod.online.tableau.com", "SITE_NAME": "acme", "PAT_NAME": "...", "PAT_VALUE": "..." } },
    "tableau-stage-acme": { "command": "npx", "args": ["-y", "@tableau/mcp-server@latest"], "env": { "SERVER": "https://stage.online.tableau.com", "SITE_NAME": "acme-stage", "PAT_NAME": "...", "PAT_VALUE": "..." } }
  }
}
```

Avoid running two servers that expose the **same admin tools against different sites** unless you
truly need both — it is the most common source of "why did it query the wrong site?".

## Confirm which server answered

Before trusting an admin/insights result when multiple servers are configured, confirm the
target. Ask the client to run a cheap, unambiguous call first (for example
[`list-projects`](../../tools/projects/list-projects.md)) and check it returns *your* site's
content. In Claude Code, `/mcp` shows which servers are connected vs failed.

You can also add a line to your client's memory (e.g. `CLAUDE.md`) so the AI self-discloses the
target and never hides an auth failure:

> When multiple Tableau MCP servers are configured, state which server a tool call targeted.
> Surface authentication/connection errors verbatim. Treat a 401 as "wrong or unauthenticated
> server," **not** as "the feature is missing."

## Decode the error

The server returns **distinct, self-explanatory** errors for the four cases below. Each names the
cause and — where the server knows them — the targeted **site** and **pod**, so a `401` is never
mistaken for a missing feature. If the AI still summarizes an error into a single vague phrase
(e.g. "no admin insights configured"), ask the client for the **raw** error text and match it here:

| You see (raw text) | Real cause | What to do |
|---|---|---|
| `Authentication failed (401): the credentials for this Tableau MCP server (site "...", pod "...") are missing, invalid, or expired. ...` | **Not authenticated** — the PAT/OAuth session for the targeted server is missing, invalid, or expired. | Re-authenticate that server (new PAT, or re-run the OAuth flow). Confirm you targeted the intended server. |
| The server logs a warning at startup (`Authentication failed (401): ...`) and continues with default settings; the same `401` message is then returned at tool call. | **Not authenticated at startup** — the credentials failed while the server was fetching site settings during launch. The server no longer crashes: it connects, registers the base tools, and surfaces the auth error at the first tool call (matching OAuth). | Fix the credentials for that server, then retry. |
| `Permission denied (403): you are authenticated to this Tableau MCP server (site "...") but this request was refused. Your account may lack the required site role or permission, or the capability may not be enabled for this site. ...` | **Authenticated, but the request was refused** — missing role/permission, or a capability not enabled for the site. For admin tools you may instead see `This tool requires site administrator permissions. Your site role is: <role>`. | Use an account with the required site role or permissions, or confirm the capability is enabled for the site. |
| `Admin Insights dataset "<name>" not found in the "Admin Insights" project on this site. This means Admin Insights is not provisioned on the targeted Tableau Cloud site ...` | **Authenticated + admin, but Admin Insights is genuinely not provisioned** on the targeted site. | Enable Admin Insights on that Tableau Cloud site, or target the site where it is provisioned. |

A `401` is an **authentication** problem, never evidence that Admin Insights is missing. Only the
last row means the feature itself is absent.

Over OAuth, a missing or expired token is rejected by the transport before any tool runs: the
`401` response keeps its `WWW-Authenticate` challenge (so the re-authentication flow still works)
and its `error_description` carries the same guidance — verify you targeted the intended server and
re-authenticate.

## Related

- [Authentication](authentication/README.md)
- [OAuth](authentication/oauth.md) — see **Known Issues** for multi-site connection pitfalls
- [Query Admin Insights](../../tools/admin-insights/query-admin-insights.md)
