---
sidebar_position: 8
---

# Feature Flags

Control available features during development via `features.json` or a cloud-based feature flag service.

## Provider Selection

The feature gate system supports two providers, selected via the `FEATURE_GATE_PROVIDER` environment variable:

- **`server`** (default): File-based feature flags using `features.json` in the project root. Intended for on-premise Tableau Server deployments.
- **`custom`**: Loads a provider module configured with `FEATURE_GATE_PROVIDER_CONFIG`.
  See [provider configuration](../configuration/mcp-config/env-vars.md#feature_gate_provider).

## Configuration

### Server Provider (File-Based)

Create a `features.json` file in the project root:

```json
{
  "mcp-apps": false,
  "interactive-viz": false,
  "enforce-role-requirements": true,
  "enforce-registration-conditions": true,
  "admin-tools": false
}
```

**Location:** Edit `features.json` in the project root before building. The build copies it next
to the server bundle, where the file-based provider reads it at startup. Standalone binaries read
the embedded copy. Restart the server after changing the deployed file; it is loaded once per
provider instance.

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

## Tool availability

The checked-in configuration enables `enforce-role-requirements` and
`enforce-registration-conditions`. These hide tools when the current user cannot satisfy the
declared role or site capability. Disabling them does not override runtime admin checks or
Tableau permissions. See [Tool Access Requirements](../web-tools/overview.md) for every
tool's role and conditions.

Admin tools are enabled by `ADMIN_TOOLS_ENABLED=true` **or** `admin-tools`. Flow and Knowledge
switches use their environment variable when explicitly set; otherwise they follow the corresponding
feature flag. The datasource publishing tools also require `datasource-authoring`, and interactive
visualizations require both `mcp-apps` and `interactive-viz`.

## Adding a New Feature Flag

1. Add the feature name and default value to `features.json` (for server provider)
2. Use `await getFeatureGate().isFeatureEnabled('your-feature')` in your code
3. Change the deployed JSON file and restart (server provider), or update the custom provider's configuration.
