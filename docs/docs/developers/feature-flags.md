---
sidebar_position: 8
---

# Feature Flags

Control available features during development via `features.json` or a cloud-based feature flag
service.

## Provider Selection

The feature gate system supports two providers, selected via the `FEATURE_GATE_PROVIDER` environment
variable:

- **`server`** (default): File-based feature flags using `features.json` in the project root.
  Intended for on-premise Tableau Server deployments.
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
3. No code changes needed to enable/disable - just update the JSON file (server provider) or the
   cloud service configuration (cloud provider)

## Retired Registration Flags

`enforce-role-requirements` and `enforce-registration-conditions` have been removed. Web tool
registration always checks minimum site roles above Viewer and declared capability requirements,
including Knowledge, Pulse, and Tableau+ for premium Pulse insights. Tools are omitted when their
required role or capability cannot be confirmed.

Deployments that previously disabled either check through a feature provider now run those checks.
API scope discovery always includes the scopes needed for enabled tools' capability checks.
Connected Apps must grant those scopes, including `tableau:entitlements:read` for premium Pulse
tools, or the corresponding tools may be omitted.
