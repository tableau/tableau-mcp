---
sidebar_position: 8
---

# Feature Flags

Control available features during development via `features.json` or a cloud-based feature flag service.

## Provider Selection

The feature gate system supports two providers, selected via the `FEATURE_GATE_PROVIDER` environment variable:

- **`server`** (default): File-based feature flags using `features.json` in the project root. Intended for on-premise Tableau Server deployments.
- **`cloud`**: Cloud-based feature flag service. Currently returns `false` for all features.

## Configuration

### Server Provider (File-Based)

Create a `features.json` file in the project root:

```json
{
  "mcpapps": true,
  "pulse": true,
  "oauth-embedded": false
}
```

**Location:** `features.json` in project root (no environment variable needed)

## Workbook permissions after publishing

Set `"publish-workbook-permissions": true` to include workbook permission rules after a successful
project publish. The flag defaults to `false`; omitted flags are also disabled. It requires the
existing `authoring-tools` flag to make `publish-workbook` available.

When disabled, publishing skips the permissions request and omits `permissions` and
`permissionsNote`. The server also omits `tableau:permissions:read` from OAuth discovery. When
enabled, the permissions read uses a separate REST session with that scope, so a permissions or
authentication failure still returns the published workbook with a `permissionsNote`. Personal Space
publishes always skip this read.

When OAuth API scope enforcement is enabled, the caller must already hold
`tableau:permissions:read`; a missing grant skips disclosure and returns `permissionsNote`.

## Usage in Code

```typescript
import { getFeatureGate } from './features/init.js';

if (getFeatureGate().isFeatureEnabled('mcpapps')) {
  // MCP Apps logic here
}
```

## Behavior

- **Lazy initialization:** Feature gate loads config on first access
- **Features not listed:** Disabled by default
- **Invalid JSON or missing file:** All features disabled, error logged
- **Partial validation:** Invalid key-value pairs are skipped with a warning, valid pairs are loaded

## Adding a New Feature Flag

1. Add the feature name and default value to `features.json` (for server provider)
2. Use `getFeatureGate().isFeatureEnabled('your-feature')` in your code
3. No code changes needed to enable/disable - just update the JSON file (server provider) or the cloud service configuration (cloud provider)
