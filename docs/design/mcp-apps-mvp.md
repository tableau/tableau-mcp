# MCP Apps MVP - Tableau Visualizations

**Authors:** Jaehun Song, Tableau MCP Team  
**Status:** In Progress  
**Last Updated:** 2026-05-25  
**Epic:** [TMCP] MCP Apps extension for Chat GPT app launch

---

## 1. MVP Scope & Rationale

### What's In

- Single tool: `get-workbook` (returns embedded default view)
- React app using Tableau Embedding API v3
- JWT authentication via `_meta` field OR app-only tool (security review determines)
- Basic error handling: show error messages in iframe
- Fixed iframe dimensions (600px height)
- CSP configuration for `*.tableau.com`
- Feature flagging strategy for controlled rollout

### What's Out (Deferred to v2)

- Additional tools: `get-view`, `get-metric`, `list-metrics`
- Advanced error handling: hide iframe on errors
- Dynamic iframe resizing
- Token refresh complexity beyond basic Embedding API handling

### Why These Cuts

- **Single tool proves the stack** - get-workbook validates entire MCP Apps + Embedding API integration
- **Simple auth reduces complexity** - One tool call instead of two (if using `_meta` approach)
- **Fixed UX acceptable for v1** - Users get interactive viz, polish comes later
- **Timeline impact:** ~3-4 weeks instead of 6-8 weeks

### MVP Success

User types "show me the Sales Dashboard" in ChatGPT → sees interactive Tableau viz with working auth.

---

## 2. Success Criteria

**MVP is complete when:**

1. **Tool Registration**
   - `get-workbook` tool registers with MCP server successfully
   - Tool appears in `tools/list` with `_meta.ui.resourceUri` pointing to the React app
   - Feature flag controls tool visibility

2. **End-to-End Flow**
   - User invokes `get-workbook` in ChatGPT
   - Tool returns workbook URL + JWT (via `_meta` or app-only tool)
   - React app loads in iframe and receives tool result
   - Tableau Embedding API loads from correct server
   - Interactive viz renders with working filters/drill-down

3. **Authentication**
   - OAuth JWT extracted from `tableauAuthInfo`
   - JWT passed securely (via `_meta` or app-only tool)
   - Embedding API accepts JWT and authenticates successfully
   - `tableau:views:embed` scope required and validated

4. **Error Handling**
   - Invalid workbook ID → error message shown in iframe
   - Missing OAuth token → error message shown in iframe
   - Embedding API load failure → error message shown in iframe

5. **Security**
   - CSP configured for `*.tableau.com` (all three domains)
   - No XSS vulnerabilities via template string interpolation
   - JWT never stored in sessionStorage

6. **Testing**
   - Manual testing in ChatGPT with real Tableau workbook
   - E2E test validates tool registration and resource serving

---

## 3. Technical Implementation

### 3.1 Server-Side: Tool Registration

**Tool Definition:**

```typescript
const getWorkbookTool = new Tool({
  server,
  name: 'get-workbook',
  description: 'Get a Tableau workbook with its embedded default view',
  paramsSchema: {
    workbookId: z.string(),
  },
  app: {
    name: 'embed-tableau-viz',
    sandboxCapabilities: {
      csp: {
        connectDomains: ['https://*.tableau.com'],
        resourceDomains: ['https://*.tableau.com'],
        frameDomains: ['https://*.tableau.com'],
      },
    },
  },
  callback: async (args, extra) => {
    // 1. Fetch workbook from Tableau REST API
    const workbook = await tableauApi.getWorkbook(args.workbookId);
    
    // 2. Construct view URL
    const viewUrl = constructViewUrl(workbook);
    
    // 3. See Section 3.3 for JWT handling (Option 1 or 2)
    
    // 4. Return URL (and optionally JWT in _meta)
    return {
      content: [{ type: 'text', text: JSON.stringify({ url: viewUrl }) }],
      _meta: { embed: { token } }  // If using Option 1
    };
  },
});
```

**Key Points:**
- HTML bundle loaded once at startup from `build/web/embed-tableau-viz.html`
- CSP allows Embedding API script, API requests, nested iframes to `*.tableau.com`
- JWT handling determined by security review (see Section 3.3)

### 3.2 Client-Side: React App

**App Structure:**

```typescript
function EmbedTableauVizApp() {
  const [toolResult, setToolResult] = useState<CallToolResult | null>(null);
  
  const { app, isConnected, error } = useApp({
    appInfo: { name: 'Embed Tableau Viz App', version: '1.0.0' },
    capabilities: {},
    onAppCreated: (app) => {
      app.ontoolresult = async (result) => {
        setToolResult(result);
      };
    },
  });
  
  if (error) return <div>ERROR: {error.message}</div>;
  if (!isConnected) return <div>Connecting...</div>;
  if (!toolResult) return <div>Loading viz...</div>;
  
  return <EmbedTableauViz toolResult={toolResult} />;
}
```

**Embedding API Integration:**

```typescript
function EmbedTableauViz({ toolResult }) {
  const containerRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    // Parse tool result (see Section 3.3 for token extraction)
    const { url } = JSON.parse(toolResult.content[0].text);
    const token = /* extract based on Option 1 or 2 */;
    
    if (!url || !token) {
      // Show error in UI
      return;
    }
    
    // Create iframe with Embedding API
    const eapiUrl = getEmbeddingApiUrl(url);
    const iframe = createIframeForEmbeddedContainer(
      eapiUrl,
      `<tableau-viz src="${url}" token="${token}" width="100%" height="600"></tableau-viz>`
    );
    
    containerRef.current.appendChild(iframe);
  }, [toolResult]);
  
  return <div ref={containerRef} style={{ width: '100%', height: '600px' }} />;
}
```

**Embedding API URL Derivation:**

```typescript
function getEmbeddingApiUrl(vizUrl: string): string {
  const url = new URL(vizUrl);
  return `${url.protocol}//${url.host}/javascripts/api/tableau.embedding.3.latest.js`;
}
```

**Key Points:**
- Embedding API loaded at runtime (version-specific to Tableau server)
- JWT used immediately, never stored in sessionStorage
- Fixed 600px height for MVP

### 3.3 Authentication Flow

Two approaches for passing JWT to the React app:

#### Option 1: JWT in `_meta`

**Flow:**
```
get-workbook returns { url } in content, { token } in _meta
  ↓
App extracts both from tool result
  ↓
App renders viz with token
```

**Implementation:**

```typescript
// Server
return {
  content: [{ type: 'text', text: JSON.stringify({ url }) }],
  _meta: { embed: { token: extra.tableauAuthInfo?.raw } }
};

// Client
const { url } = JSON.parse(result.content[0].text);
const token = result._meta?.embed?.token;
```

**Trade-offs:**
- ✅ Simple - single tool call, no latency
- ⚠️ JWT in result object - security depends on host not logging `_meta`

---

#### Option 2: App-Only Tool

**Flow:**
```
get-workbook returns { url } only (no JWT)
  ↓
App calls mint-embed-token({ url }) 
  ↓
Server validates URL, returns JWT directly to app
  ↓
App renders viz with token
```

**Implementation:**

```typescript
// Server: User-facing tool
return new Ok({ url });  // No JWT

// Server: App-only tool
new Tool({
  name: 'mint-embed-token',
  annotations: { _meta: { ui: { visibility: ['app'] } } },
  callback: async ({ url }, extra) => {
    validateUrl(url, extra.tableauAuthInfo);
    return new Ok({ token: extra.tableauAuthInfo?.raw });
  }
});

// Client
const { url } = JSON.parse(result.content[0].text);
const { token } = await app.callServerTool('mint-embed-token', { url });
```

**Trade-offs:**
- ✅ JWT never in LLM/host logs, host-independent security
- ❌ More complex - two tools, extra round trip

---

Both options require `tableau:views:embed` OAuth scope mapped to `get-workbook` in `toolScopeMap`.

---

## 4. Security

### 4.1 XSS Prevention

**Requirements (W-22592302):**
1. Never pass JWT in tool result content (srcdoc interpolation vulnerability)
2. Never store JWT in sessionStorage (accessible to malicious scripts)
3. Use DOM APIs, not template strings, for HTML construction

**Safe DOM Construction:**

```typescript
// ❌ UNSAFE - vulnerable to XSS
iframe.srcdoc = `<tableau-viz src="${url}" token="${token}"></tableau-viz>`;

// ✅ SAFE - setAttribute auto-escapes
const viz = document.createElement('tableau-viz');
viz.setAttribute('src', url);
viz.setAttribute('token', token);
container.appendChild(viz);
```

### 4.2 Content Security Policy

All three CSP fields point to `['https://*.tableau.com']`:

```typescript
sandboxCapabilities: {
  csp: {
    connectDomains: ['https://*.tableau.com'],   // fetch/XHR/WebSocket
    resourceDomains: ['https://*.tableau.com'],  // scripts, images, styles
    frameDomains: ['https://*.tableau.com'],     // nested iframes
  },
}
```

Allows:
- Loading Embedding API script from Tableau server
- API requests to Tableau server
- Embedding Tableau content in nested iframes

### 4.3 OAuth Scope

`tableau:views:embed` scope required and mapped to `get-workbook` in `toolScopeMap`.

---

## 5. MVP Stories

### In Scope

| Work Item | Subject | Notes |
|-----------|---------|-------|
| [W-22012277](https://gus.lightning.force.com/lightning/r/ADM_Work__c/a07EE00002Y2ibkYAB/view) | Spike MCP Apps functionality in Tableau MCP | Foundation work |
| [W-22571806](https://gus.lightning.force.com/lightning/r/ADM_Work__c/a07EE00002aQW8kYAG/view) | Set up MCP Apps dependencies and basic server structure | Infrastructure |
| [W-22571808](https://gus.lightning.force.com/lightning/r/ADM_Work__c/a07EE00002aQUVBYA4/view) | Create generic React container for Tableau embedding | Client-side app |
| [W-22571817](https://gus.lightning.force.com/lightning/r/ADM_Work__c/a07EE00002aQVQgYAO/view) | JWT authentication flow for Tableau embedding | Option 1 or 2 from Section 3.3 |
| [W-22571896](https://gus.lightning.force.com/lightning/r/ADM_Work__c/a07EE00002aQJBMYA4/view) | Implement GetWorkbook MCP App | Core MVP tool |
| [W-22587739](https://gus.lightning.force.com/lightning/r/ADM_Work__c/a07EE00002aVUEMYA4/view) | Create technical document and confirm scope/requirements with product | This doc |
| [W-22587803](https://gus.lightning.force.com/lightning/r/ADM_Work__c/a07EE00002aV0AOYA0/view) | Design feature flagging strategy for Tableau MCP (on-prem and cloud) | Deployment control |
| [W-22642116](https://gus.lightning.force.com/lightning/r/ADM_Work__c/a07EE00002akl4oYAA/view) | Implement error handling for MCP Apps | Basic version only - show errors in iframe |

### Out of Scope (Deferred to v2)

| Work Item | Subject | Reason |
|-----------|---------|--------|
| [W-22571894](https://gus.lightning.force.com/lightning/r/ADM_Work__c/a07EE00002aQbKvYAK/view) | Implement GetView MCP App | Additional tool - MVP uses get-workbook only |
| [W-22571899](https://gus.lightning.force.com/lightning/r/ADM_Work__c/a07EE00002aQcwuYAC/view) | Implement getMetricfromMetricID MCP App | Additional tool - deferred |
| [W-22571901](https://gus.lightning.force.com/lightning/r/ADM_Work__c/a07EE00002aQYDwYAO/view) | Implement listMetricsFromMetricDefinitionId MCP App | Additional tool - deferred |
| [W-22602384](https://gus.lightning.force.com/lightning/r/ADM_Work__c/a07EE00002acObXYAU/view) | Implement GetView MCP App | Duplicate - deferred with W-22571894 |
| [W-22642120](https://gus.lightning.force.com/lightning/r/ADM_Work__c/a07EE00002akxasYAA/view) | Make React iframe dimensions dynamic for MCP Apps | Polish feature - MVP uses fixed 600px height |

---

## 6. Future Enhancements (Post-MVP)

- Additional tools: `get-view`, `get-metric`, `list-metrics`
- Dynamic iframe resizing based on content
- Advanced error handling: hide iframe on errors
- Token refresh with proactive expiration detection
- Performance optimizations for Embedding API loading
