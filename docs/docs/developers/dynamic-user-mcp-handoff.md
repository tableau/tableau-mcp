---
sidebar_position: 99
---

# Dynamic user MCP (handoff for agents)

This note summarizes work on branch **`dynamic_user`** and how callers must send the Tableau username to the MCP server over HTTP.

## What we implemented

- **Goal:** Use **direct-trust** (Connected App JWT) to Tableau while allowing the **JWT username / `sub`** to vary **per HTTP request** (e.g. signed-in user email from a web app).
- **Mechanism:** When **MCP OAuth is disabled**, an Express middleware reads a **configurable HTTP header** and puts its value into `req.auth.extra.username`. Existing code already substitutes `{OAUTH_USERNAME}` in `JWT_SUB_CLAIM` and `JWT_ADDITIONAL_PAYLOAD` from that context when signing into Tableau.
- **Important:** **`TRANSPORT=http`**, **`DANGEROUSLY_DISABLE_OAUTH=true`**, **`DISABLE_SESSION_MANAGEMENT=true`** are required so each request can carry a different user (stateless HTTP; new `Server` per request in that mode).
- **Security tradeoff:** There is **no shared secret** on the header path. Anyone who can reach the MCP URL can send any username in that header. Mitigate with network restrictions, Railway private networking, or a reverse proxy.

### Code locations (for maintenance)

- `src/server/jwtSubClaimHeaderMiddleware.ts` — reads header, sets `auth.extra.username`
- `src/config.ts` — `JWT_SUB_CLAIM_HEADER` validation and rules
- `src/server/express.ts` — middleware order + CORS allow-list for the header name
- `src/restApiInstance.ts` — `getJwtUsername` / `getJwtAdditionalPayload` (`{OAUTH_USERNAME}` replacement)
- Docs: `docs/docs/configuration/mcp-config/authentication/direct-trust.md` (`JWT_SUB_CLAIM_HEADER` section)

## Deployed MCP base URL (Railway)

**Origin:** `https://dynamic-user.up.railway.app`

**MCP HTTP path** (same as local; server name is `tableau-mcp`):

```text
https://dynamic-user.up.railway.app/tableau-mcp
```

Use **`POST`** (and follow-up MCP streamable-HTTP messages as the client requires). The MCP Inspector / clients typically point at this full URL.

## Required server environment variables (summary)

Set in Railway (or `.env` locally) at minimum:

| Variable | Purpose |
|----------|---------|
| `TRANSPORT` | `http` |
| `DANGEROUSLY_DISABLE_OAUTH` | `true` |
| `DISABLE_SESSION_MANAGEMENT` | `true` |
| `AUTH` | `direct-trust` |
| `SERVER` | Tableau site base URL (`https://...`) |
| `SITE_NAME` | Tableau site content URL |
| `JWT_SUB_CLAIM` | `{OAUTH_USERNAME}` |
| `JWT_SUB_CLAIM_HEADER` | HTTP header **name** for the username (see below) |
| `CONNECTED_APP_CLIENT_ID` | Connected App |
| `CONNECTED_APP_SECRET_ID` | Connected App |
| `CONNECTED_APP_SECRET_VALUE` | Connected App |

Do **not** set `OAUTH_ISSUER` for this mode (that enables MCP OAuth and conflicts with the header feature).

## You already have the username — how to give it to MCP

Your app (e.g. after login) has a string like `user@company.com`. The MCP server does **not** accept the username in the JSON body for this feature. It only reads it from an **HTTP request header**.

### Step-by-step

1. **Match Railway:** In Railway env, set **`JWT_SUB_CLAIM_HEADER`** to the header name you will use (recommended: `X-Tableau-Jwt-Username`).
2. **Use the same string in code** as the header **name** when calling MCP.
3. **Set the header value** to the username string your app already has (Tableau username / email).
4. **Send that header on every MCP POST** to the MCP URL — not only on the first page load. Each `initialize`, tool call, or streamable-HTTP request that should run as that user must include the header (your MCP client library may need custom `headers` / `fetch` options).

### MCP URL

```text
POST https://dynamic-user.up.railway.app/tableau-mcp
```

### Headers (minimum for this feature)

| Header | Value |
|--------|--------|
| `Content-Type` | `application/json` |
| `X-Tableau-Jwt-Username` | The username your app returned (e.g. `abierschenk@salesforce.com`) |
| `MCP-Protocol-Version` | e.g. `2025-06-18` or `2025-11-25` (whatever your client uses) |

Use your **exact** `JWT_SUB_CLAIM_HEADER` value in place of `X-Tableau-Jwt-Username` if you chose a different name.

### Example: Node / server-side `fetch`

Run this **from your backend** (or server action), not from raw browser JS, if you want to avoid exposing MCP to arbitrary clients:

```ts
const tableauUsername = 'abierschenk@salesforce.com'; // from your session / IdP

const res = await fetch('https://dynamic-user.up.railway.app/tableau-mcp', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Tableau-Jwt-Username': tableauUsername,
    'MCP-Protocol-Version': '2025-06-18',
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      /* ... client capabilities per MCP spec ... */
    },
  }),
});
```

Replace `body` with whatever JSON-RPC payload your MCP client generates for each step (`initialize`, then tools, etc.). **Keep the username header on each request.**

### If you use an MCP SDK / Inspector

Configure the **HTTP transport** with base URL `https://dynamic-user.up.railway.app/tableau-mcp` and pass **custom headers** so every request includes `X-Tableau-Jwt-Username: <username>`. If the SDK does not support extra headers, put a small **reverse proxy** in front that adds the header from your session.

## How the web app (or gateway) must send the username (summary)

1. Choose a header name once and set **`JWT_SUB_CLAIM_HEADER`** to that exact string on the server (e.g. `X-Tableau-Jwt-Username`).
2. On **every MCP HTTP request** that should run as a given Tableau user, include:

```http
X-Tableau-Jwt-Username: user@company.com
```

(Replace with your configured header name and the real Tableau username — often the same as corporate email.)

3. Send the normal MCP JSON-RPC body (e.g. `initialize`, tools) as today. **Ping** is handled before this middleware in some cases, so **ping alone is not sufficient** to validate that the username was applied; use a tool call that hits Tableau or add logging.

## Request logging (JWT sub header)

When `JWT_SUB_CLAIM_HEADER` is enabled and a client sends that header with a non-empty value, the server writes **one JSON line per request** to **stderr** (visible in Railway logs, Docker logs, or your terminal):

- `type`: `jwt-sub-header-request`
- `jwtSubClaimTemplate`: value of env `JWT_SUB_CLAIM` (e.g. `{OAUTH_USERNAME}`)
- `jwtSubClaimResolved`: username actually used for Tableau JWT sign-in (trimmed header value)
- `headerName`, `method`, `path`, `clientIp`, `xForwardedFor` (when present)

Invalid empty values after trim emit `type: jwt-sub-header-request-invalid`.

Logging is suppressed when `TABLEAU_MCP_TEST=true` (unit tests).

## Quick curl sanity check (connectivity)

```bash
curl -sS -D - -X POST 'https://dynamic-user.up.railway.app/tableau-mcp' \
  -H 'Content-Type: application/json' \
  -H 'X-Tableau-Jwt-Username: user@company.com' \
  -H 'MCP-Protocol-Version: 2025-06-18' \
  -d '{"jsonrpc":"2.0","id":1,"method":"ping"}'
```

Expect `200` and `{"jsonrpc":"2.0","id":1,"result":{}}` if the service is up. This does **not** prove Tableau saw that user; it only checks HTTP + ping.

## Branch and repo

- Feature work lives on **`dynamic_user`** (not necessarily merged to `main`).
- **`.env-oauth`** is in **`.gitignore`** — never commit env files with PATs or Connected App secrets.
