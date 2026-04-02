---
sidebar_position: 3
---

# Contributing

We are following the
[fork and pull model](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/getting-started/about-collaborative-development-models)
where contributors will make their own fork of this repo, implement their changes, and then submit a
pull request here.

Refer to the
[Contribution Checklist](https://github.com/tableau/tableau-mcp/blob/main/CONTRIBUTING.md#contribution-checklist)
for more details on the steps.

# Onboarding Tableau API(s) as an MCP Tool

A guide for developers who want to expose additional Tableau APIs and features through the Tableau MCP server.

## What is MCP and Why Does It Matter?

**Model Context Protocol (MCP)** is an open standard (created by Anthropic) that lets AI applications — like Claude Desktop, Cursor, VS Code Copilot, or any custom agent — call external tools in a structured way. Think of it as a USB-C port for AI: a single, standard interface that any AI client can use to talk to any compatible server.

**Tableau MCP** is a server that implements this protocol. It exposes **tools** — discrete, callable operations — that let AI agents interact with Tableau on behalf of a user. When someone asks an AI assistant *"What were our top 5 products last quarter?"*, the AI doesn't guess. It calls Tableau MCP tools to list datasources, inspect their schema, run a query, and return real data.

Any Tableau API can be part of this. By onboarding additional Tableau APIs as one or more MCP tools, you make these APIs available to every AI client in the ecosystem — without those clients needing to know anything about Tableau's APIs.

### The 30-Second Mental Model

```
User prompt → AI decides which tools to call → MCP server executes them → results go back to the AI
```

The AI reads each tool's **name**, **description**, and **parameter schema** to decide when and how to use it. The tool's implementation calls your Tableau API, formats the result, and returns it. The AI never sees raw HTTP — it just sees the tool interface.

## Before You Start: Is Your Feature Ready?

Not every API endpoint makes a good MCP tool. Ask these questions first:

| Question | Why It Matters |
|----------|---------------|
| **Does a user or agent have a reason to invoke this in a conversational flow or as part of an automation?** | Tools should solve real problems among all of our user personas (Business User, Analayst, Admin, and Data Steward). An API that only matters during system setup may not be a good fit. |
| **Is the API available on Tableau Cloud and/or Server REST API?** | The MCP server authenticates through Tableau's REST API session. Your API must be callable with a REST API session token (`X-Tableau-Auth`). |
| **Is the response bounded and predictable?** | A tool that returns 50,000 rows is difficult for an Agent to deal with. Good tools have pagination, filtering, or natural result limits. |

## How Tools Work in This Codebase

Every tool in the Tableau MCP server follows the same pattern. Understanding this pattern is the key to onboarding yours.

### Anatomy of a Tool

A tool is a TypeScript file that exports a **factory function**. The factory creates a `Tool` instance with four key parts:

```
┌──────────────────────────────────────────────────────┐
│ Tool                                                 │
│                                                      │
│  name          "list-datasources"                    │
│  description   What it does, when to use it,         │
│                parameter docs, examples              │
│  paramsSchema  Zod schema defining accepted inputs   │
│  callback      The function that runs when called    │
│                                                      │
│  ┌──────────────────────────────────────────────┐    │
│  │ callback                                     │    │
│  │   → authenticates via useRestApi()           │    │
│  │   → calls your Tableau API                   │    │
│  │   → returns Ok(result) or Err(error)         │    │
│  └──────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────┘
```

### What the AI Sees

When an MCP client connects, it receives a list of available tools. For each tool, the AI sees:

- **Name** — a kebab-case identifier like `list-datasources` or `get-view-image`
- **Description** — natural language explaining purpose, parameters, and usage examples
- **Input schema** — a JSON Schema (auto-generated from your Zod definitions) describing accepted parameters

The AI uses this information to decide *which* tool to call and *how* to call it. **Your description is the single most important factor in whether the AI uses your tool correctly.** More on this below.

### What Happens at Runtime

```
1. AI sends:  { tool: "list-datasources", args: { filter: "name:eq:Sales" } }
2. MCP server validates args against the Zod schema
3. Tool callback runs:
   a. useRestApi() creates an authenticated Tableau session
   b. Your API is called through the REST API SDK
   c. Results are post-processed (pagination, bounded context filtering)
   d. Returns Ok(data) — success — or Err(error)
4. Base class (logAndExecute) handles logging, telemetry, error formatting
5. MCP server sends the result back to the AI as structured text
```

You don't need to worry about authentication, logging, telemetry, or error formatting. The framework handles all of that. You focus on: **what API to call, with what arguments, and how to shape the result.**

## Designing Your Tool

### Naming

Tools use kebab-case names that follow the pattern `verb-noun` or `verb-noun-qualifier`:

| Pattern | Examples |
|---------|----------|
| `list-{resources}` | `list-datasources`, `list-views`, `list-workbooks` |
| `get-{resource}` | `get-workbook`, `get-view-data`, `get-view-image` |
| `get-{resource}-{detail}` | `get-datasource-metadata` |
| `query-{resource}` | `query-datasource` |
| `search-{scope}` | `search-content` |
| `generate-{output}` | `generate-pulse-insight-brief` |

Pick a name that an AI can reason about. If the name clearly conveys the operation, the AI is more likely to select it correctly.

### Tool Grouping

Tools are organized into **groups** that represent feature areas:

| Group | Feature Area |
|-------|-------------|
| `datasource` | Data Q&A — listing, inspecting, and querying published datasources |
| `workbook` | Workbook exploration |
| `view` | View data and image retrieval |
| `pulse` | Tableau Pulse metric definitions, metrics, insights |
| `content-exploration` | Cross-content search |

If your feature fits into an existing group, add your tool there. If it represents an entirely new capability, propose a new group name.

### Writing the Description

The tool description is **prompt engineering**. It is the only thing the AI reads to decide when and how to use your tool. Write it for an LLM audience, not a human API reference.

Every description should include:

1. **What the tool does** — in one or more clear sentences
2. **When to use it** — what kind of user request might trigger this tool
3. **What it returns** — so the AI knows what to expect

Descriptions may also include:
1. **Usage examples** — concrete prompt-to-parameter mappings
2. **Disambiguation** — when to use *this* tool vs. a similar one
3. **Best Practices or Limitations** - tribal knowledge about how best to use a tool

You should be very intentional about what goes into your description. You should try to strike a balance between being comprehensive and detailed, but not overly verbose such that you unnecessarily consume input tokens. 

Example structure:

```
Retrieves metadata for a specific published datasource including its fields, 
types, and descriptions. Use this tool when a user asks about the schema, 
structure, or available fields of a datasource or when data source metadata is critical to part of your overall task, e.g query a datasource.

**Example Usage:**
- "What fields are in the Sales datasource?" → 
    First call list-datasources to get the LUID, then call this tool.
- "Show me the schema of datasource abc-123" →
    datasourceId: "abc-123"

**Note:** This tool returns field metadata only. To query actual data, 
use the query-datasource tool instead.
```

### Choosing Parameters

Parameters are defined using **Zod schemas** (a TypeScript validation library). Keep these principles in mind:

- **Minimize required parameters.** The fewer things the AI needs to provide, the more reliably it can call your tool.
- **Use descriptive enum values.** If a parameter accepts specific values, list them as a Zod enum so the AI sees the options in the schema.
- **Validate early.** If a parameter has format constraints (e.g., must be a LUID), encode them in the Zod schema rather than failing at runtime.
- **Include sensible defaults.** Don't require the user to specify pagination limits, sort orders, or view modes unless they need to.

### One Tool or Many?

A common design question: should you create one tool with a `mode` parameter, or several focused tools?

**Prefer multiple focused tools** when the operations have different parameter shapes, return different data, or serve different user intents. The AI reasons better about specific tools than about a swiss-army-knife tool with a mode switch.

**Use a single tool** when the variations are minor (e.g., optional filter parameters on a list operation).

| Scenario | Recommendation |
|----------|---------------|
| List metrics vs. get metric details | Two tools |
| List with optional filter vs. list without filter | One tool with optional `filter` param |
| Get text data vs. get image | Two tools (different return types) |
| CRUD on the same resource | Separate tools per operation |

**Note** A tool can implement several APIs. Your are not bound to a 1:1 mapping of APIs-to-MCP tools. For example see the [getDatasourceMetadata](https://github.com/tableau/tableau-mcp/blob/main/src/tools/getDatasourceMetadata/getDatasourceMetadata.ts) tool, which implements the readMetadata API and the Metadata API and joins their results. 

## Implementation Walkthrough

Here is the step-by-step process for adding a tool to the codebase.

### Step 1: Register the Tool Name

Add your tool name to the `toolNames` array in `src/tools/toolName.ts` and assign it to a group in `toolGroups`.

```typescript
// In src/tools/toolName.ts

// Add to the toolNames array:
export const toolNames = [
  // ... existing tools ...
  'my-new-tool',
] as const;

// Add to an existing group or create a new one:
export const toolGroups = {
  // ... existing groups ...
  'my-feature': ['my-new-tool'],
} as const;
```

### Step 2: Add OAuth Scopes

Add scope mappings in `src/server/oauth/scopes.ts` so the auth system knows what permissions your tool requires.

```typescript
// In the toolScopeMap:
'my-new-tool': {
  mcpScopes: ['tableau:mcp:my-feature:read'],
  apiScopes: ['tableau:content:read'],
},
```

### Step 3: Create the Tool Directory

Create a new directory under `src/tools/` for your tool:

```
src/tools/myNewTool/
├── myNewTool.ts          # Tool implementation
└── myNewTool.test.ts     # Unit tests
```

### Step 4: Implement the Tool

Here is the minimal template:

```typescript
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { useRestApi } from '../../restApiInstance.js';
import { Server } from '../../server.js';
import { Tool } from '../tool.js';

const paramsSchema = {
  resourceId: z.string().describe('The LUID of the resource'),
  includeDetails: z.boolean().optional().describe('Include extended details'),
};

export const getMyNewTool = (server: Server): Tool<typeof paramsSchema> => {
  const myNewTool = new Tool({
    server,
    name: 'my-new-tool',
    description: `
Retrieves details about [your resource] using the Tableau REST API. 
Use this tool when a user asks about [specific use case].

**Parameters:**
- \`resourceId\` (required): The LUID of the resource to retrieve.
- \`includeDetails\` (optional): Whether to include extended information. Default: false.

**Example Usage:**
- "Tell me about resource X" → resourceId: "<luid>"
`,
    paramsSchema,
    annotations: {
      title: 'My New Tool',
      readOnlyHint: true,       // true if it doesn't modify data
      openWorldHint: false,
    },
    callback: async ({ resourceId, includeDetails }, extra): Promise<CallToolResult> => {
      return await myNewTool.logAndExecute({
        extra,
        args: { resourceId, includeDetails },
        callback: async () => {
          const result = await useRestApi({
            ...extra,
            jwtScopes: myNewTool.requiredApiScopes,
            callback: async (restApi) => {
              // Call your API here using restApi methods
              const data = await restApi.yourMethods.getResource({
                siteId: restApi.siteId,
                resourceId,
              });
              return data;
            },
          });
          return new Ok(result);
        },
        constrainSuccessResult: (result) => {
          if (!result) {
            return { type: 'empty', message: 'No resource found.' };
          }
          return { type: 'success', result };
        },
      });
    },
  });

  return myNewTool;
};
```

### Step 5: Add Your API to the SDK (If Needed)

If the Tableau REST API methods you need aren't already in `src/sdks/tableau/`, you'll need to add them. The SDK uses [Zodios](https://www.zodios.org/) for type-safe API definitions. Look at existing endpoint definitions in that directory for the pattern.

### Step 6: Register the Tool Factory

Import and add your factory to the `toolFactories` array in `src/tools/tools.ts`:

```typescript
import { getMyNewTool } from './myNewTool/myNewTool.js';

export const toolFactories = [
  // ... existing factories ...
  getMyNewTool,
];
```

### Step 7: Write Tests

Create `myNewTool.test.ts` alongside your tool. The project uses **Vitest** (not Jest). Unit tests mock the REST API and verify your tool's behavior:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { Provider } from '../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getMyNewTool } from './myNewTool.js';
import { Server } from '../../server.js';

const mockUseRestApi = vi.hoisted(() => vi.fn());
vi.mock('../../restApiInstance.js', () => ({ useRestApi: mockUseRestApi }));

describe('my-new-tool', () => {
  const tool = getMyNewTool(new Server());
  const callback = Provider.from(tool.callback);

  it('returns resource data on success', async () => {
    mockUseRestApi.mockResolvedValue({ id: '123', name: 'Test' });

    const result = await callback(
      { resourceId: '123' },
      getMockRequestHandlerExtra(),
    );

    expect(result.content).toBeDefined();
  });
});
```

Run tests with:

```bash
# All unit tests
npm test

# Just your tool
npx vitest run src/tools/myNewTool/myNewTool.test.ts

# Watch mode during development
npx vitest src/tools/myNewTool/myNewTool.test.ts
```

### Step 8: Build and Verify

```bash
npm run build          # Must compile without errors
npx tsc --noEmit       # Type-check
npx eslint src/        # Lint
npm test               # All unit tests pass
```

## Common Patterns You'll Encounter

### Pagination

Most list APIs return paginated results. Use the built-in `paginate()` utility from `src/utils/paginate.ts` for standard REST API pagination, or `pulsePaginate()` for token-based Pulse API pagination. These handle page iteration, result accumulation, and limit enforcement automatically.

### Bounded Context Filtering

After fetching results, tools apply **bounded context** filtering via `constrainSuccessResult`. This lets server administrators restrict which content is visible through MCP (e.g., only datasources in certain projects or with certain tags). If your tool returns content that should be scopeable by project, tag, or LUID, implement a constrain function.

### Error Handling

You generally don't need to write error handling code. The `logAndExecute` method on the base `Tool` class catches exceptions, extracts HTTP status codes, logs failures, records telemetry, and returns structured error messages to the AI.

When your tool needs to return a domain-specific error (e.g., a resource isn't allowed by bounded context, or a feature is disabled), return an `McpToolError` subclass from `src/errors/mcpToolError.ts`. Each subclass carries its own status code and user-facing message via `getErrorText()`:

```typescript
import { FeatureDisabledError, DatasourceNotAllowedError } from '../../errors/mcpToolError.js';

// Inside your callback:
if (!isFeatureEnabled) {
  return new FeatureDisabledError('My feature requires Tableau Cloud 2025.3+.').toErr();
}

if (!isAllowed) {
  return new DatasourceNotAllowedError('This datasource is outside the allowed scope.').toErr();
}
```

Existing error subclasses include `ArgsValidationError`, `DatasourceNotAllowedError`, `FeatureDisabledError`, `PulseDisabledError`, `ViewNotAllowedError`, `WorkbookNotAllowedError`, and `QueryValidationError`. If none of these fit your case, extend `McpToolError` with a new subclass in the same file.

### Result Formatting

Return data as clean, structured objects. The framework serializes them to JSON text for the AI. Avoid returning raw API responses with extraneous metadata — strip it down to what's useful. The AI's context window is finite, so every token counts.

## Checklist Before Submitting Your PR

- [ ] Tool name added to `toolNames` in `src/tools/toolName.ts`
- [ ] Tool assigned to a group in `toolGroups`
- [ ] OAuth scope mapping added in `src/server/oauth/scopes.ts`
- [ ] Tool factory registered in `src/tools/tools.ts`
- [ ] Tool description includes: purpose, when to use, parameters, examples, disambiguation
- [ ] Parameters use Zod schemas with `.describe()` for each field
- [ ] Callback uses `logAndExecute` and `useRestApi` patterns
- [ ] `constrainSuccessResult` handles empty results gracefully
- [ ] Unit tests cover success, empty-result, and error paths
- [ ] `npm run build` succeeds
- [ ] `npx tsc --noEmit` has no type errors
- [ ] `npx eslint src/` passes
- [ ] `npm test` passes
- [ ] Tool documentation page added in `docs/docs/tools/`

## Getting Help

- **Slack:** `#tab-dev-mcp-project` (internal Tableau employees only) or `#tableau-ai-solutions` (public channel for the community)
- **Codebase reference:** Look at `src/tools/listDatasources/` for a straightforward read-only tool, or `src/tools/pulse/` for a group of related tools