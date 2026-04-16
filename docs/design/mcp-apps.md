# MCP Apps: Interactive UI for MCP Tools

**Authors:** Tableau MCP Team  
**Status:** Draft  
**Last Updated:** 2026-04-08  
**Spec:** SEP-1865 · Protocol Version `2026-01-26`  
**SDK:** `@modelcontextprotocol/ext-apps` v1.0.1

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Goals and Non-Goals](#goals-and-non-goals)
3. [Background](#background)
4. [Architecture Overview](#architecture-overview)
5. [Component Deep Dive](#component-deep-dive)
6. [API Contracts](#api-contracts)
7. [Security Model](#security-model)
8. [Sequence Diagrams](#sequence-diagrams)
9. [Build and Deployment](#build-and-deployment)
10. [Implementing Embedding API Apps](#implementing-embedding-api-apps)
11. [Alternatives Considered](#alternatives-considered)
12. [Testing Strategy](#testing-strategy)
13. [Rollout Plan](#rollout-plan)
14. [Open Questions](#open-questions)

---

## Problem Statement

MCP tools today return structured text (JSON, Markdown) that the host LLM renders. This works for simple data but falls short for:

- **Rich visual content** — Dashboards, interactive charts, and real-time data visualizations cannot be meaningfully represented as text.
- **User interaction** — Filters, drill-downs, parameter controls, and other interactive elements require a live UI, not a static snapshot.
- **Branding and fidelity** — First-party Tableau experiences (embedded vizzes, Pulse insights) need pixel-perfect rendering using official Tableau APIs, which require a real DOM environment.

MCP Apps solve this by letting tools declare companion UIs that hosts render in sandboxed iframes alongside tool results.

---

## Goals and Non-Goals

### Goals

- Enable any Tableau MCP tool to deliver rich, interactive UI directly in the chat experience.
- Provide a reusable framework for adding new app UIs with minimal boilerplate — a developer should only need to write a React component and declare an `app` property on their tool.
- Maintain security parity with existing MCP tool invocations (OAuth scopes, CSP, iframe sandboxing).
- Work across MCP-compliant hosts (MCP Jam, ChatGPT, Claude Desktop, etc.) with no host-specific code.

### Non-Goals

- Replacing Tableau's standalone embedding solutions — MCP Apps are scoped to the chat/agent context.
- Arbitrary web app hosting — apps must be self-contained single-file HTML bundles delivered via the MCP resource protocol.
- Bidirectional real-time collaboration between multiple users in the same app instance.

---

## Background

### What is an MCP App?

An MCP App is a self-contained HTML application bundled into a single file and delivered to the host via the MCP `resources/read` protocol. The host renders it in a sandboxed iframe and bridges communication between the app and the MCP server using JSON-RPC over `postMessage`.

### Key Primitives


| Concept                    | Description                                                                             |
| -------------------------- | --------------------------------------------------------------------------------------- |
| **App Tool**               | An MCP tool that declares a `_meta.ui.resourceUri` pointing to a companion UI resource. |
| **App Resource**           | An MCP resource with MIME type `text/html;profile=mcp-app` containing the bundled HTML. |
| **App** (client class)     | The in-browser SDK class that connects to the host via `PostMessageTransport`.          |
| **AppBridge** (host class) | The host-side counterpart that manages the iframe lifecycle and proxies events.         |


### Candidate Apps


| App                      | Use Case                                                       |
| ------------------------ | -------------------------------------------------------------- |
| Embedded Viz             | Render a live Tableau dashboard using the Embedding API v3     |
| Pulse Renderer           | Render Pulse metric insights with interactive charts and cards |
| Data Explorer *(future)* | Interactive drill-down into query results                      |


---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│  MCP Host (MCP Jam, ChatGPT, Claude Desktop, etc.)           │
│                                                              │
│  ┌────────────┐    JSON-RPC/SSE     ┌─────────────────────┐  │
│  │ MCP Client │◄──────────────────►│  Tableau MCP Server  │  │
│  └─────┬──────┘                     │                     │  │
│        │                            │  ┌───────────────┐  │  │
│        │ resources/read             │  │  Any Tool with │  │  │
│        │ (ui://tableau-mcp/...)     │  │  app: { ... }  │  │  │
│        ▼                            │  └───────────────┘  │  │
│  ┌─────────────┐                    │                     │  │
│  │  AppBridge  │  postMessage       └─────────────────────┘  │
│  │  (host-side)│◄──────────────┐                             │
│  └─────┬───────┘               │                             │
│        │                       │                             │
│        ▼                       │                             │
│  ┌─────────────────────────┐   │                             │
│  │  Sandboxed iframe       │   │                             │
│  │  ┌───────────────────┐  │   │                             │
│  │  │  App (SDK)        │──┘                                 │
│  │  │  ┌─────────────┐  │                                    │
│  │  │  │ React UI    │  │                                    │
│  │  │  └─────────────┘  │                                    │
│  │  └───────────────────┘  │                                 │
│  └─────────────────────────┘                                 │
└──────────────────────────────────────────────────────────────┘
```

### Data Flow (Generalized)

1. User asks the LLM to perform a task that requires a rich UI.
2. LLM invokes an app-enabled tool with the appropriate parameters.
3. The MCP server executes the tool callback, which returns structured data (e.g., URLs, tokens, content payloads) as the tool result.
4. The host sees `_meta.ui.resourceUri` on the tool definition, fetches the HTML resource via `resources/read`.
5. The host creates a sandboxed iframe, loads the HTML, and initializes an `AppBridge`.
6. The in-app `App` SDK connects via `PostMessageTransport` and completes the initialization handshake.
7. The host forwards the `CallToolResult` to the app via the `tool-result` notification.
8. The app parses the tool result and renders its interactive UI.

---

## Component Deep Dive

### 5.1 Server-Side: Tool + Resource Registration

Any tool can opt into being an app tool by declaring an `app` property:

```typescript
new Tool({
  server,
  name: 'my-tool',
  app: {
    name: 'my-app',
    sandboxCapabilities: {
      csp: {
        connectDomains: ['https://api.example.com'],
        resourceDomains: ['https://cdn.example.com'],
        frameDomains: ['https://*.example.com'],
      },
    },
  },
  description: 'A tool with a companion UI.',
  paramsSchema,
  callback: async (args, extra) => { /* ... */ },
});
```

At construction, `Tool` eagerly reads the bundled HTML from `build/web/{name}.html` and assigns a resource URI:

```
ui://tableau-mcp/{name}.html
```

During `Server.registerTools()`, app tools trigger a two-part registration:

1. **Tool registration** — Standard MCP tool, but with `_meta.ui.resourceUri` in the tool definition so hosts know a companion UI exists.
2. **Resource registration** — An MCP resource at the URI above, returning the HTML blob with MIME type `text/html;profile=mcp-app` and sandbox capabilities in `_meta.ui`.

### 5.2 Client-Side: The App SDK

Apps use the `@modelcontextprotocol/ext-apps/react` hook:

```typescript
const { app, isConnected, error } = useApp({
  appInfo: { name: 'My App', version: '1.0.0' },
  capabilities: {},
  onAppCreated: (app) => {
    app.ontoolresult = async (result) => { /* handle tool result */ };
    app.onhostcontextchanged = (params) => { /* theme, locale, etc. */ };
    app.onteardown = async () => { /* cleanup */ return {}; };
  },
});
```

`useApp` internally:

1. Creates an `App` instance.
2. Calls `onAppCreated` for handler registration (before connection).
3. Creates a `PostMessageTransport(window.parent, window.parent)`.
4. Calls `app.connect()` which executes the `ui/initialize` handshake.

The SDK abstracts all `postMessage` and JSON-RPC mechanics — app developers only interact with typed callbacks and methods on the `App` object.

### 5.3 Host-Side: The AppBridge

The host creates an `AppBridge` per iframe. The bridge:

- Manages the `PostMessageTransport` to the iframe's `contentWindow`.
- Handles the `ui/initialize` handshake, returning host capabilities and context.
- Forwards tool lifecycle events: `sendToolInput()`, `sendToolInputPartial()`, `sendToolResult()`, `sendToolCancelled()`.
- Proxies app requests: `tools/call` (tool invocations from the app), `ui/open-link`, `ui/message`.
- Enforces CSP and sandbox permissions based on `_meta.ui` from the resource.

Note: The `AppBridge` is implemented by the host (MCP Jam, ChatGPT, etc.), not by us. Our server only needs to provide the tool metadata and resource content.

### 5.4 Communication: PostMessage JSON-RPC

All host-app communication is JSON-RPC 2.0 over `window.postMessage`. The `PostMessageTransport` validates `event.source` matches the expected peer. This is entirely handled by the SDK — our app code never calls `postMessage` directly.

---

## API Contracts

### 6.1 Tool Definition (Server -> Host)

When a host calls `tools/list`, app tools include UI metadata:

```json
{
  "name": "my-tool",
  "description": "A tool with a companion UI.",
  "inputSchema": { "type": "object", "properties": { ... } },
  "_meta": {
    "ui": {
      "resourceUri": "ui://tableau-mcp/my-app.html"
    }
  }
}
```

### 6.2 Resource Response (Server -> Host)

When a host calls `resources/read` with the app's resource URI:

```json
{
  "contents": [{
    "uri": "ui://tableau-mcp/my-app.html",
    "mimeType": "text/html;profile=mcp-app",
    "text": "<!DOCTYPE html><html>... (single-file bundle) ...</html>",
    "_meta": {
      "ui": {
        "csp": {
          "connectDomains": ["https://api.example.com"],
          "resourceDomains": ["https://cdn.example.com"],
          "frameDomains": ["https://*.example.com"]
        }
      }
    }
  }]
}
```

### 6.3 Initialization Handshake (App <-> Host)

```
App -> Host:  ui/initialize
              { protocolVersion: "2026-01-26",
                appInfo: { name, version },
                appCapabilities: {} }

Host -> App:  (response)
              { protocolVersion: "2026-01-26",
                hostInfo: { name, version },
                hostCapabilities: { openLinks, serverTools, logging, sandbox, ... },
                hostContext: { theme, locale, displayMode, styles, ... } }

App -> Host:  ui/notifications/initialized
```

### 6.4 Tool Lifecycle Notifications (Host -> App)


| Notification                          | Payload                         | When                        |
| ------------------------------------- | ------------------------------- | --------------------------- |
| `ui/notifications/tool-input`         | Complete tool arguments         | Tool is invoked             |
| `ui/notifications/tool-input-partial` | Streaming partial JSON (healed) | During streaming invocation |
| `ui/notifications/tool-result`        | `CallToolResult`                | Tool execution completes    |
| `ui/notifications/tool-cancelled`     | `{ reason }`                    | User or host cancels        |


### 6.5 App -> Host Requests


| Request                   | Payload               | Response         | Purpose                                          |
| ------------------------- | --------------------- | ---------------- | ------------------------------------------------ |
| `tools/call`              | `{ name, arguments }` | `CallToolResult` | Proxy a tool call to the MCP server              |
| `ui/open-link`            | `{ url }`             | `{ isError? }`   | Open an external URL in user's browser           |
| `ui/message`              | `{ content[] }`       | `{ isError? }`   | Send a message into the chat                     |
| `ui/update-model-context` | `{ content[] }`       | `{}`             | Update model context without triggering response |
| `ui/request-display-mode` | `{ mode }`            | `{ mode }`       | Request inline / fullscreen / picture-in-picture |


### 6.6 App -> Host Notifications


| Notification                    | Payload             | Purpose           |
| ------------------------------- | ------------------- | ----------------- |
| `ui/notifications/size-changed` | `{ width, height }` | Responsive layout |
| `notifications/message`         | `{ level, data }`   | Debug logging     |


---

## Security Model

### 7.1 Layered Defense

```
┌──────────────────────────────────────────┐
│  Layer 1: OAuth Scope Gating             │  Client must hold required scopes
│  (MCP server enforces before execution)  │  to invoke the tool at all.
├──────────────────────────────────────────┤
│  Layer 2: Iframe Origin Isolation        │  App runs in a sandboxed iframe;
│  (Browser enforces)                      │  no DOM access to the host.
├──────────────────────────────────────────┤
│  Layer 3: CSP Policy                     │  App can only fetch/frame domains
│  (Host enforces via _meta.ui)            │  declared in sandboxCapabilities.
├──────────────────────────────────────────┤
│  Layer 4: PostMessage Validation         │  Transport validates event.source
│  (SDK enforces)                          │  matches expected peer.
├──────────────────────────────────────────┤
│  Layer 5: Token Scoping                  │  Tokens passed to apps have only
│  (MCP server + Tableau SSO enforce)      │  the scopes needed for rendering.
└──────────────────────────────────────────┘
```

### 7.2 OAuth Scope Flow

Each app tool declares its required scopes in the `toolScopeMap` (`src/server/oauth/scopes.ts`). These scopes are:

1. **Advertised** in `/.well-known/oauth-protected-resource` via `getSupportedScopes()`.
2. **Challenged** in the `WWW-Authenticate` header on 401 responses via `getRequiredScopesForTool()`.
3. **Requested** by the MCP client from Tableau's OAuth provider during the authorization flow.
4. **Issued** in the JWT's `scope` claim by Tableau SSO.
5. **Enforced** by the auth middleware before the tool callback executes.

Tools that pass tokens to their companion apps (e.g., for Tableau Embedding API authentication) include them as structured data in the `CallToolResult`. The app parses the token from the result — tokens never flow through ambient context, cookies, or query parameters.

### 7.3 Token Handling by Auth Mode


| Auth Mode      | How Tokens Reach Apps                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Direct Trust   | Server generates a scoped JWT via Connected App credentials and includes it in the tool result.                                             |
| OAuth (Bearer) | The raw Bearer JWT from Tableau SSO is passed through in the tool result. The JWT already contains the required scopes from the OAuth flow. |


Not all apps need tokens — only those that interact with authenticated Tableau APIs (e.g., the Embedding API). Apps that only render data returned by the tool callback (e.g., Pulse insights) can receive their data directly in the tool result without tokens.

### 7.4 CSP Enforcement

Sandbox capabilities are declared per-tool and transmitted to the host in the resource's `_meta.ui`. The host is responsible for enforcing these as CSP directives or iframe `sandbox` attributes. The SDK provides `buildAllowAttribute()` to convert permissions to iframe `allow` strings.

Available CSP directives:


| Directive         | Controls                            |
| ----------------- | ----------------------------------- |
| `connectDomains`  | `fetch`, XHR, WebSocket origins     |
| `resourceDomains` | Scripts, images, styles, fonts      |
| `frameDomains`    | Nested iframe origins (`frame-src`) |
| `baseUriDomains`  | `base-uri` directive                |


Available permission grants:


| Permission       | Use Case           |
| ---------------- | ------------------ |
| `camera`         | Video input        |
| `microphone`     | Audio input        |
| `geolocation`    | Location services  |
| `clipboardWrite` | Write to clipboard |


---

## Sequence Diagrams

### 8.1 Generic App Tool Flow

```
User          LLM/Host        MCP Client       MCP Server
 │              │                │                  │
 │  User prompt │                │                  │
 │─────────────►│                │                  │
 │              │  tools/call    │                  │
 │              │───────────────►│  POST /mcp       │
 │              │                │─────────────────►│
 │              │                │                  │ ──► authenticate
 │              │                │                  │ ──► check scopes
 │              │                │                  │ ──► execute callback
 │              │                │  CallToolResult  │
 │              │                │◄─────────────────│
 │              │                │                  │
 │              │  resources/read│                  │
 │              │  (ui://...)    │─────────────────►│
 │              │                │  HTML + _meta.ui │
 │              │                │◄─────────────────│
 │              │                │                  │
 │              │  Create iframe │                  │
 │              │  Load HTML     │                  │
 │              │  ┌─────────┐   │                  │
 │              │  │ App SDK │   │                  │
 │              │  │ connect │   │                  │
 │              │  └────┬────┘   │                  │
 │              │◄──────┘        │                  │
 │              │  ui/initialize │                  │
 │              │  handshake     │                  │
 │              │                │                  │
 │              │  tool-result   │                  │
 │              │──► App iframe  │                  │
 │              │  ┌─────────┐   │                  │
 │              │  │ Parse   │   │                  │
 │              │  │ result  │   │                  │
 │              │  │ Render  │   │                  │
 │  ┌───────┐  │  │ UI      │   │                  │
 │  │  UI!  │◄─┤  └─────────┘   │                  │
 │  └───────┘  │                │                  │
```

### 8.2 App Initialization Handshake

```
App (iframe)                    AppBridge (host)
    │                                │
    │  postMessage: ui/initialize    │
    │  { appInfo, capabilities,      │
    │    protocolVersion }           │
    │───────────────────────────────►│
    │                                │  validate protocol version
    │  postMessage: (response)       │  resolve capabilities
    │  { hostInfo, hostCapabilities, │
    │    hostContext }               │
    │◄───────────────────────────────│
    │                                │
    │  postMessage:                  │
    │  ui/notifications/initialized  │
    │───────────────────────────────►│
    │                                │  ──► ready to send events
    │                                │
    │  ui/notifications/tool-result  │
    │◄───────────────────────────────│
    │                                │
```

### 8.3 App-Initiated Tool Call (Advanced)

Apps can call other MCP tools through the host, enabling richer interactions (e.g., fetching additional data, refreshing tokens):

```
App (iframe)         AppBridge (host)       MCP Client       MCP Server
    │                      │                    │                │
    │  tools/call          │                    │                │
    │  { name, arguments } │                    │                │
    │─────────────────────►│                    │                │
    │                      │  tools/call        │                │
    │                      │───────────────────►│  POST /mcp     │
    │                      │                    │───────────────►│
    │                      │                    │ CallToolResult  │
    │                      │                    │◄───────────────│
    │                      │  CallToolResult    │                │
    │                      │◄───────────────────│                │
    │  CallToolResult      │                    │                │
    │◄─────────────────────│                    │                │
    │                      │                    │                │
```

---

## Build and Deployment

### 9.1 Build Pipeline

```
src/web/src/apps/{name}/{name}.tsx
         │
         ▼  (Vite + vite-plugin-singlefile + @vitejs/plugin-react)
         │
         ▼  Auto-discovers all .tsx files under src/web/src/apps/
         │  Creates temp HTML entry from component-template.html
         │  Inlines ALL JS + CSS into a single HTML file
         │
build/web/{name}.html  (self-contained, no external dependencies)
         │
         ▼  (Tool constructor reads at startup via readFileSync)
         │
In-memory HTML blob
         │
         ▼  (Served via MCP resources/read protocol)
         │
Host iframe
```

### 9.2 Why Single-File?

MCP resources are delivered over the MCP protocol (JSON-RPC), not HTTP. There is no static file server for assets. The entire app — HTML, CSS, JS, and inlined dependencies — must be a single `text` payload in the resource response. `vite-plugin-singlefile` achieves this by inlining all chunks and stylesheets at build time.

### 9.3 Adding a New App

1. Create `src/web/src/apps/{name}/{name}.tsx` with a React component using `useApp`.
2. Create a tool in `src/tools/{name}/` with `app: { name: '{name}', sandboxCapabilities: { ... } }`.
3. Add the name to the `AppName` union type in `src/apps/appName.ts`.
4. Map the tool to required scopes in `src/server/oauth/scopes.ts`.
5. Run `npm run build` — Vite auto-discovers the new `.tsx` and produces `build/web/{name}.html`.

### 9.4 App Skeleton

Minimal boilerplate for a new app:

```typescript
// src/web/src/apps/{name}/{name}.tsx
import { useApp } from '@modelcontextprotocol/ext-apps/react';
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

function MyApp() {
  const [toolResult, setToolResult] = useState<CallToolResult | null>(null);

  const { app, isConnected, error } = useApp({
    appInfo: { name: 'My App', version: '1.0.0' },
    capabilities: {},
    onAppCreated: (app) => {
      app.ontoolresult = async (result) => setToolResult(result);
      app.onteardown = async () => ({});
    },
  });

  if (error) return <div>Error: {error.message}</div>;
  if (!app || !isConnected) return <div>Connecting...</div>;
  if (!toolResult) return <div>Waiting for data...</div>;

  // Parse toolResult.content and render your UI
  return <div>{/* Your interactive UI here */}</div>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><MyApp /></StrictMode>
);
```

---

## Implementing Embedding API Apps

This section is an implementation guide for building MCP Apps that render live Tableau content using the Tableau Embedding API v3. It covers the requirements that are specific to embedding — token handling, CSP, and the nested iframe architecture — on top of the general MCP Apps framework described above.

### 10.1 Why Embedding API Apps Are Different

Most MCP Apps (e.g., Pulse Renderer) receive data from the tool callback and render it entirely with local React components. Embedding API apps are different because:

- **Authentication happens client-side** — The `<tableau-viz>` web component authenticates directly with Tableau's servers using a JWT `token` attribute. The token must flow from the server through the tool result to the app.
- **External runtime dependencies** — The Embedding API JS (`tableau.embedding.3.latest.js`) is loaded at runtime from the Tableau server, not bundled into the app.
- **Nested iframes** — The Embedding API creates its own iframes internally for viz rendering. The host's CSP must allow this.

### 10.2 Server-Side Requirements

#### CSP Sandbox Capabilities

Any tool that renders embedded Tableau content must declare CSP for three domains:

```typescript
sandboxCapabilities: {
  csp: {
    connectDomains: ['https://*.tableau.com'],   // Embedding API XHR/fetch/WebSocket
    resourceDomains: ['https://*.tableau.com'],  // Embedding API JS, images, fonts
    frameDomains: ['https://*.tableau.com'],      // Viz iframes created by the API
  },
}
```

Without all three, the Embedding API will fail at different stages — script loading, data fetching, or viz rendering.

#### Token Resolution

The tool callback must resolve an auth token and include it in the tool result. Two auth modes must be handled:

```
┌─────────────────────┐
│    Tool Callback     │
│                      │
│  ┌────────────────┐  │
│  │ Auth mode?     │  │
│  └───┬────────┬───┘  │
│      │        │      │
│  Direct    OAuth     │
│  Trust   (Bearer)    │
│      │        │      │
│  Generate  Extract   │
│  new JWT   raw JWT   │
│  with      from      │
│  embed     tableau   │
│  scope     AuthInfo  │
│      │        │      │
│  ┌───┴────────┴───┐  │
│  │ { url, token } │  │
│  └────────────────┘  │
└─────────────────────┘
```

**Direct Trust:** The server generates a scoped JWT using Connected App credentials. The `scopes` parameter must include `tableau:views:embed`:

```typescript
token = await getJwt({
  username: tableauAuthInfo?.username ?? config.jwtUsername,
  config: {
    type: 'connected-app',
    clientId: config.connectedAppClientId,
    secretId: config.connectedAppSecretId,
    secretValue: config.connectedAppSecretValue,
  },
  scopes: new Set(['tableau:views:embed']),
});
```

**OAuth (Bearer):** The raw JWT from Tableau SSO is available in `tableauAuthInfo.raw`. It already contains `tableau:views:embed` because the OAuth flow requested it (see scope requirements below):

```typescript
token = tableauAuthInfo.raw;
```

A shared utility (`getEmbedToken(extra)`) should be extracted so future embedding tools don't duplicate this logic.

#### OAuth Scope Registration

The tool must be mapped to the `tableau:views:embed` scope in `toolScopeMap` (`src/server/oauth/scopes.ts`). This drives the entire OAuth scope negotiation chain:

1. `getSupportedScopes()` includes the scope in `/.well-known/oauth-protected-resource`.
2. `getRequiredScopesForTool(toolName)` returns it for `WWW-Authenticate` headers on 401 responses.
3. The MCP client requests it from Tableau SSO during the OAuth authorization flow.
4. Tableau SSO issues a JWT with `tableau:views:embed` in the `scope` claim.
5. The auth middleware validates the scope is present before executing the callback.

Environment prerequisites:

- `ADVERTISE_API_SCOPES=true` in `.env`
- `OAUTH_DISABLE_SCOPES` must NOT be `true`

### 10.3 Client-Side Requirements

#### Iframe Architecture

Embedding API apps use a two-level iframe architecture:

```
┌─ Host ──────────────────────────────────────────┐
│                                                  │
│  ┌─ Outer Iframe (MCP App sandbox) ───────────┐  │
│  │  React app + App SDK                       │  │
│  │  Receives { url, token } via ontoolresult  │  │
│  │                                            │  │
│  │  ┌─ Nested Iframe (srcdoc) ─────────────┐  │  │
│  │  │  <script> imports Embedding API JS   │  │  │
│  │  │  <tableau-viz src=url token=jwt />   │  │  │
│  │  │                                      │  │  │
│  │  │  ┌─ Tableau Internal Iframes ─────┐  │  │  │
│  │  │  │  (viz rendering, data loading) │  │  │  │
│  │  │  └────────────────────────────────┘  │  │  │
│  │  └──────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

The nested iframe is necessary because:

- The Embedding API registers custom elements (`<tableau-viz>`) and needs its own document context.
- It isolates the Embedding API's DOM mutations from the MCP App's React tree.
- The `srcdoc` approach avoids a network round-trip — the content is inline HTML.

#### Loading the Embedding API

The Embedding API JS URL is derived from the viz URL's host:

```
https://{tableau-host}/javascripts/api/tableau.embedding.3.latest.js
```

This is loaded via `<script type="module">` inside the nested iframe's `srcdoc`. It is NOT bundled into the single-file HTML — it must be fetched at runtime because:

- It's large and version-specific to the Tableau server.
- It must match the server version to avoid compatibility issues.
- The CSP `resourceDomains` declaration authorizes this fetch.

#### Rendering the Web Component

The nested iframe's `srcdoc` contains the Tableau web component with the token:

```html
<script type="module">
  import 'https://{host}/javascripts/api/tableau.embedding.3.latest.js';
</script>
<tableau-viz src="{workbookUrl}" token="{token}" width="100%" height="600">
</tableau-viz>
```

The `token` attribute is what makes this work — the Embedding API uses it to authenticate with Tableau's servers. Without a valid JWT containing `tableau:views:embed`, the viz will fail to load.

### 10.4 Supported Tableau Web Components

The Embedding API v3 provides several web components that could be used in MCP Apps:


| Component                 | Purpose                            | Required Scope                                  |
| ------------------------- | ---------------------------------- | ----------------------------------------------- |
| `<tableau-viz>`           | Read-only dashboard/view           | `tableau:views:embed`                           |
| `<tableau-authoring-viz>` | Editable dashboard (web authoring) | `tableau:views:embed` (+ authoring permissions) |
| `<tableau-pulse>`         | Pulse metric card                  | `tableau:views:embed`                           |


Each would follow the same pattern: server resolves token, app loads Embedding API, renders the component in a nested iframe.

### 10.5 Reusable Components (Recommended Extractions)

To avoid duplicating logic across multiple embedding tools, the following should be extracted into shared modules:


| Module                             | Location                                   | Purpose                                                                                                         |
| ---------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `getEmbedToken(extra)`             | `src/utils/getEmbedToken.ts`               | Resolves auth token for embedding (direct-trust or OAuth passthrough). Single place to handle both auth modes.  |
| `getEmbeddingApiUrl(vizUrl)`       | `src/web/src/shared/getEmbeddingApiUrl.ts` | Derives the Embedding API JS URL from a viz URL. Currently lives under `embed-tableau-viz/`.                    |
| `createEmbedIframe(eapiUrl, html)` | `src/web/src/shared/createEmbedIframe.ts`  | Creates the nested iframe with `srcdoc`, styles, and script import. Currently lives under `embed-tableau-viz/`. |


This allows a new embedding tool to be implemented with minimal code:

**Server side:**

```typescript
callback: async ({ workbookUrl }, extra) => {
  const token = await getEmbedToken(extra);
  return new Ok({ url: workbookUrl, token });
}
```

**Client side:**

```typescript
const { url, token } = parseToolResult(toolResult);
const iframe = createEmbedIframe(
  getEmbeddingApiUrl(url),
  `<tableau-viz src="${url}" token="${token}" width="100%" height="600" />`
);
container.appendChild(iframe);
```

---

## Alternatives Considered

### 11.1 Server-Side Rendered HTML in Tool Results

**Approach:** Return raw HTML as the tool result text, let the host render it directly.

**Why rejected:**

- No standard for hosts to render arbitrary HTML from tool results (security risk).
- No lifecycle management, theming, or bidirectional communication.
- No sandboxing guarantees — each host would implement its own (or none).

### 11.2 Custom HTTP Endpoints for App Assets

**Approach:** Serve app assets via HTTP routes on the MCP server, return a URL in the tool result.

**Why rejected:**

- Requires the MCP server to be HTTP-reachable from the user's browser (breaks with Streamable HTTP transport behind proxies).
- Adds CORS complexity.
- Diverges from the MCP resource model — resources already have a delivery mechanism.
- The `text/html;profile=mcp-app` MIME type convention makes it explicit and standardized.

### 11.3 Web Components Instead of Iframes

**Approach:** Deliver a web component (custom element) that the host inserts into its own DOM.

**Why rejected:**

- No origin isolation — the component has full access to the host's DOM, cookies, and storage.
- CSS leakage in both directions.
- Dependency version conflicts (e.g., multiple React versions).
- Iframe sandboxing is a well-understood, browser-enforced security boundary.

### 11.4 Separate Companion App (Out-of-Band UI)

**Approach:** Open a separate browser tab/window for the visualization.

**Why rejected:**

- Breaks the conversational UX — the UI should appear inline in the chat.
- Requires the user to context-switch.
- No way for the LLM to reference what the user sees.

---

## Testing Strategy

### 12.1 Unit Tests


| Component                             | Strategy                                                                                                                                                  |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App tool callbacks                    | Mock `extra.config` and `extra.tableauAuthInfo`. Assert the callback returns the expected structured result for all auth modes.                           |
| Scope resolution (`scopes.ts`)        | Assert `getRequiredScopesForTool(toolName)` returns the correct scopes for each app tool. Assert `getSupportedScopes()` includes all app-required scopes. |
| Auth middleware (`authMiddleware.ts`) | Mock request bodies with app tool calls. Assert 401 responses include the correct scopes in `WWW-Authenticate`.                                           |
| Tool result parsing (client-side)     | Test with valid JSON, nested ChatGPT wrapper, malformed input, missing fields.                                                                            |


### 12.2 Integration Tests


| Scenario                                      | Method                                                                                                                     |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Tool registration produces correct `_meta.ui` | Start server, call `tools/list`, verify `resourceUri` and `_meta.ui` on all app tools.                                     |
| Resource returns valid HTML                   | Call `resources/read` with each app's `ui://` URI, verify MIME type `text/html;profile=mcp-app` and non-empty `text`.      |
| OAuth scope negotiation                       | Simulate unauthenticated request for an app tool, verify 401 includes correct scopes, then authenticate with scoped token. |


### 12.3 Test Mode

Setting `TABLEAU_MCP_TEST=true` replaces app HTML with stubs:

```html
<html><body><p>{app-name}</p></body></html>
```

This avoids loading real Vite-built bundles in CI while still exercising the full registration and resource-serving path.

### 12.4 E2E / Manual Testing


| Scenario                  | Steps                                                                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Happy path (OAuth)        | Connect via MCP Jam with OAuth. Invoke an app tool. Verify iframe loads, UI renders, token has required scopes.                    |
| Happy path (Direct Trust) | Connect with direct-trust config. Invoke an app tool. Verify JWT is generated with correct scopes and UI renders.                  |
| Missing scope             | Remove a required scope from `toolScopeMap`. Verify 401 challenge no longer includes it and the tool invocation is blocked.        |
| CSP enforcement           | Remove a required domain from `sandboxCapabilities.csp`. Verify the app's network requests to that domain are blocked by the host. |


---

## Rollout Plan

### Phase 1: Framework Foundation (Current)

- `Tool` class supports `app` property with eager HTML loading
- Two-part registration: tool with `_meta.ui.resourceUri` + resource with `text/html;profile=mcp-app`
- Vite build pipeline with `vite-plugin-singlefile` for self-contained HTML bundles
- Auto-discovery of `.tsx` apps under `src/web/src/apps/`
- OAuth scope plumbing: `toolScopeMap`, protected resource metadata, `WWW-Authenticate` headers
- Test mode (`TABLEAU_MCP_TEST`) with stub HTML
- CSP and sandbox capability declaration via `HostSandboxCapabilities`

### Phase 2: First App UIs

- Embedded Viz app — live Tableau dashboards via Embedding API v3
- Pulse Renderer app — interactive Pulse metric insights and charts
- Unit + integration test coverage for app tool registration and scope enforcement

### Phase 3: Framework Hardening

- `app.callServerTool()` patterns for apps that need to fetch additional data
- `requestDisplayMode` support for fullscreen viewing
- `onhostcontextchanged` theming (light/dark mode propagation)
- Document the "Adding a New App" developer workflow
- E2E validation across multiple hosts (MCP Jam, ChatGPT)

---

## Open Questions

1. **Token refresh for long-lived sessions** — Bearer JWTs expire. Should apps request fresh tokens via `callServerTool`, or should the host handle re-authentication transparently?
2. **Streaming tool input** — Should apps render loading skeletons during `ontoolinputpartial`, or wait for the complete `ontoolresult`? What's the recommended UX pattern?
3. **CSP enforcement verification** — The spec says the host enforces CSP from `_meta.ui`. How do we verify that hosts actually do this? Should the server set additional CSP headers as defense-in-depth?
4. **App size budget** — Single-file bundles grow with dependencies. What's the practical size limit for the `resources/read` JSON-RPC response? Should we consider lazy-loading or code-splitting patterns?
5. **Cross-app state** — If multiple app tools are invoked in the same conversation, should apps be able to share state or context? The current model treats each app instance as isolated.

