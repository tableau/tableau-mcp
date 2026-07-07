# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

### Building
```bash
npm run build                  # Production build (minified, bundled)
npm run build:dev             # Development build (external packages, debug logging)
npm run build:desktop         # Desktop variant build
npm run build:combined        # Combined variant build
npm run build:docker          # Build Docker image
```

### Running the Server
```bash
npm run start:http            # Start HTTP server (default port 3927)
npm run start:http:apm        # Start with APM telemetry tracing enabled
npm run start:http:docker     # Run via Docker container
```

### Testing
```bash
npm test                      # Unit tests (src/**/*.test.ts)
npm run test:e2e              # End-to-end tests
npm run test:eval             # Evaluation tests
npm run test:oauth:embedded   # OAuth embedded tests
npm run test:oauth:tableau    # OAuth Tableau tests (Playwright)
npm run coverage              # Unit test coverage report
```

### Linting & Formatting
```bash
npm run lint                  # Run ESLint
npm run lint:fix              # Auto-fix ESLint issues
```

### MCP Inspector
```bash
npm run inspect               # Build + inspect with MCP Inspector (stdio)
npm run inspect:http          # Run HTTP server + inspector
npm run inspect:docker        # Build Docker + inspect
```

### Running Individual Tests
```bash
npx vitest run src/path/to/file.test.ts              # Run specific unit test
npx vitest run src/path/to/file.test.ts -t "pattern"  # Run tests matching pattern
npx playwright test tests/oauth/tableau-authz         # Run specific Playwright test
```

## Architecture

### Build Variants
The project supports multiple build variants via `src/scripts/build.ts`:
- **default**: Standard HTTP/stdio server
- **desktop**: Desktop-specific variant with ext-apps integration
- **combined**: Both web and desktop tools

Build variants use esbuild with conditional code via `globalIdentifiers` to customize the final bundle.

### Transport Modes
Two MCP transport modes defined in `src/transports.ts`:
- **stdio**: Standard input/output (for Claude Desktop, npx usage)
- **http**: HTTP server with Express (for multi-user deployments)

### Authentication Types
Configured via `AUTH` env var (see `src/config.ts`):
- **pat**: Personal Access Token (PAT_NAME + PAT_VALUE)
- **uat**: User Access Token with JWT
- **direct-trust**: Connected App direct trust (CONNECTED_APP_* vars)
- **oauth**: OAuth 2.0 flow (embedded or Tableau authz server)

### Core Server Architecture

#### Entry Point (`src/index.ts`)
- Loads dotenv configuration
- Initializes Tableau server info (via `getTableauServerInfo`)
- Creates either stdio or HTTP transport based on `TRANSPORT` env var
- Sets up notification level and file logging if configured

#### Web Server (`src/server.web.ts` + `src/server/express.ts`)
- `WebMcpServer` extends base `Server` class
- Registers web tools from `src/tools/web/tools.ts`
- Express server handles:
  - OAuth middleware (embedded or Tableau provider)
  - Passthrough auth middleware (`X-Tableau-Auth` header)
  - Session management (unless `DISABLE_SESSION_MANAGEMENT=true`)
  - CORS configuration
  - Latency metrics
  - MCP StreamableHTTPServerTransport

#### Desktop Server (`src/server.desktop.ts`)
- Desktop variant uses `@modelcontextprotocol/ext-apps` for discovery
- Integrates with `DesktopDiscoverer` to find local Tableau Desktop instances
- Tools are proxied to desktop via `DesktopToolExecutor`

### Tool Architecture

#### Web Tools (`src/tools/web/`)
Each tool is a subdirectory containing:
- `tool.ts`: Tool definition extending `WebTool` class
- `*.test.ts`: Unit tests
- Tool implements `paramsSchema` (Zod) and `callback` function

Key tools include:
- `queryDatasource`: Query Tableau datasources
- `contentExploration`: Search workbooks, views, datasources
- `getDatasourceMetadata`: Retrieve datasource schema/fields
- `pulse`: Pulse-related operations
- `projects`: Project management
- `adminInsights`: Admin insights queries

#### Desktop Tools (`src/tools/desktop/`)
Desktop-specific tools that interact with local Tableau Desktop instances.

#### Tool Context (`src/tools/web/toolContext.ts`)
`TableauWebRequestHandlerExtra` provides:
- Config with request overrides
- Tableau auth info (userId, siteId, scopes)
- Server reference
- User/site LUID accessors

### SDK Layer (`src/sdks/tableau/`)
Wraps Tableau REST API:
- `restApi.ts`: Main API client using Zodios
- `apis/`: REST API endpoint definitions
- `methods/`: Higher-level method wrappers
- `types/`: TypeScript types for API responses

### Configuration (`src/config.ts`)
`Config` class extends `BaseConfig` with environment variables:
- Server connection (SERVER, SITE_NAME)
- Auth credentials (PAT_*, UAT_*, CONNECTED_APP_*)
- OAuth settings (OAUTH_*)
- Feature flags (ENABLE_MCP_SITE_SETTINGS, ENABLE_PASSTHROUGH_AUTH)
- Telemetry (TELEMETRY_PROVIDER, PRODUCT_TELEMETRY_ENDPOINT)

### Feature Gates (`src/features/`)
Provider-based feature flag system (mirrors telemetry provider pattern):
- **Server provider** (default): Loads `features.json` from filesystem (on-prem)
- **Custom provider**: Loads user-specified provider from module path (for cloud/external services)

Files:
- `types.ts`: `FeatureGateProvider` interface, config schemas, type guard
- `serverFeatureGate.ts`: File-based provider (loads `features.json`)
- `init.ts`: Provider factory + custom loader + singleton + public API (`initializeFeatureGate()`, `getFeatureGate()`, `resetFeatureGate()`, re-exports `FeatureGateProvider` type)
- `init.test.ts`: All feature gate tests (includes provider tests + type guard tests)

Usage (import from `init.ts`):
```typescript
import { getFeatureGate } from './features/init.js';
getFeatureGate().isFeatureEnabled('mcp-apps')
```

Configuration (same pattern as TELEMETRY_PROVIDER):
```bash
# Default: server provider
FEATURE_GATE_PROVIDER=server

# Custom provider (e.g., for cloud service)
FEATURE_GATE_PROVIDER=custom
FEATURE_GATE_PROVIDER_CONFIG='{"module":"./my-feature-gate.js"}'
```

### Overridable Config (`src/overridableConfig.ts`)
MCP site settings allow per-site configuration stored in Tableau.
Request-level overrides via `X-Tableau-MCP-Config` header.

### Sessions (`src/sessions.ts`)
HTTP mode supports session management:
- Session ID in `mcp-session-id` header
- Stores MCP server instance per session
- Can be disabled with `DISABLE_SESSION_MANAGEMENT=true`

### Logging (`src/logging/`)
- `logger.ts`: Core logging with masking (PATs, tokens)
- `fileLogger.ts`: Optional file-based logging
- `notification.ts`: MCP notification system (debug/info/warning/error)
- Log masking can be disabled with `DISABLE_LOG_MASKING=true`

### Telemetry (`src/telemetry/`)
- APM/tracing via `tracing.ts` (loaded with `-r` flag)
- Product telemetry via `productTelemetry/`
- Supports DataDog, Grafana, OpenTelemetry
- Configured via `TELEMETRY_PROVIDER` env var

### OAuth (`src/server/oauth/`)
Two OAuth modes:
1. **Embedded**: MCP server is its own authz server
2. **Tableau**: Delegates to Tableau's OAuth provider

Flow:
- `/authorize` → Authorization request
- `/token` → Token exchange
- `/revoke` → Token revocation
- Middleware validates access tokens and populates `authInfo`

## Environment Variables

Key variables (see `env.example.list` and `.env`):
- `SERVER`: Tableau server URL
- `SITE_NAME`: Tableau site name
- `AUTH`: Authentication type (pat/uat/direct-trust/oauth)
- `TRANSPORT`: Transport mode (stdio/http)
- `PAT_NAME` / `PAT_VALUE`: PAT credentials
- `HTTP_PORT_ENV_VAR_NAME`: Port env var name (default: PORT)
- `DANGEROUSLY_DISABLE_OAUTH`: Disable OAuth for HTTP (testing only)
- `DISABLE_SESSION_MANAGEMENT`: Stateless HTTP mode
- `ENABLE_PASSTHROUGH_AUTH`: Allow X-Tableau-Auth header
- `ENABLE_MCP_SITE_SETTINGS`: Enable per-site configuration
- `BREAK_GLASS_DISABLE_GLOBALLY`: Emergency kill switch
- `CSP_ALLOWED_DOMAINS`: Comma-separated list of domains for Content-Security-Policy (default: `https://*.online.tableau.com,https://*.tableau.com`)

## Testing Strategy

### Unit Tests (`vitest.config.ts`)
- Located in `src/` alongside source files
- Coverage excludes: scripts, SDKs, server
- Run with `npm test`

### E2E Tests (`vitest.config.e2e.ts`)
- Located in `tests/e2e/`
- Test full MCP flows

### OAuth Tests
- Embedded: `vitest.config.oauth.embedded.ts`
- Tableau: Playwright tests in `tests/oauth/tableau-authz/`

### Test Setup (`src/testSetup.ts`)
Global test configuration and mocks.

## Common Development Patterns

### Adding a New Web Tool
1. Create directory: `src/tools/web/myTool/`
2. Create `tool.ts` extending `WebTool`:
   ```typescript
   export class MyTool extends WebTool<typeof paramsSchema> {
     name = 'my_tool' as const;
     description = 'Tool description';
     paramsSchema = z.object({ ... });
     callback = async (args, context) => { ... };
   }
   ```
3. Add to `src/tools/web/tools.ts` factories
4. Add tool name to `src/tools/web/toolName.ts`
5. Write tests in `tool.test.ts`

### Adding Configuration
1. Add to `Config` class in `src/config.ts`
2. Add to `BaseConfig` in `src/config.shared.ts` if shared across variants
3. Document in `env.example.list`
4. Add to `src/overridableConfig.ts` if should be overridable per-site

### Feature Flags
Edit `features.json` at project root:
```json
{
  "my-feature": true
}
```
Check in code:
```typescript
if (getFeatureGate().isFeatureEnabled('my-feature')) { ... }
```

## NPM Package

Published as `@tableau/mcp-server` with:
- Binary: `tableau-mcp-server` → `build/index.js`
- Exports: main entry + `./tracing` for APM
- Requires Node.js >= 22.7.5

## Documentation

Docusaurus site in `docs/` subdirectory:
```bash
npm run docs:start   # Start dev server
```

Official docs: https://tableau.github.io/tableau-mcp/
