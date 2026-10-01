---
sidebar_position: 8
---

# Feature Flags

Control available features during development via `features.json` or a custom feature flag provider.

## Provider Selection

The feature gate system supports two providers, selected via the `FEATURE_GATE_PROVIDER` environment variable:

- **`server`** (default): File-based feature flags using `features.json` in the project root. Intended for on-premise Tableau Server deployments.
- **`custom`**: Loads a user-supplied provider module (e.g. for a cloud-based feature flag service). Configured via `FEATURE_GATE_PROVIDER_CONFIG='{"module":"./my-feature-gate.js"}'`. The module must export a default class (or named export `FeatureGateProvider`) implementing `isFeatureEnabled`.

## Configuration

### Server Provider (File-Based)

Create a `features.json` file in the project root:

```json
{
  "mcp-apps": true,
  "data-apps": false,
  "authoring-tools": true
}
```

**Location:** `features.json` in project root (no environment variable needed)

## Usage in Code

```typescript
import { getFeatureGate } from './features/init.js';

if (await getFeatureGate().isFeatureEnabled('mcp-apps')) {
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
2. Use `await getFeatureGate().isFeatureEnabled('your-feature')` in your code
3. No code changes needed to enable/disable - just update the JSON file (server provider) or the custom provider's configuration (custom provider)
