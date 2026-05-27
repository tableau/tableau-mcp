---
sidebar_position: 8
---

# Feature Flags

Control available features during development via `features.json`.

## Configuration

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
import { getFeatureGate } from './features/featureGate.js';

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

1. Add the feature name and default value to `features.json`
2. Use `getFeatureGate().isFeatureEnabled('your-feature')` in your code
3. No code changes needed to enable/disable - just update the JSON file
