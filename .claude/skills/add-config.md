---
name: add-config
description: Add a new configuration option to tableau-mcp
---

# Add Configuration Workflow

This skill helps you add a new configuration option properly.

## Steps

1. **Define the configuration**
   - Ask for config name (e.g., `ENABLE_FEATURE_X`)
   - Ask for description and purpose
   - Determine type (string, boolean, number, etc.)
   - Decide if it should be overridable per-site

2. **Add to Config class**
   - Edit `src/config.ts`
   - Add property to `Config` class
   - Read from `process.env` in constructor
   - Parse/validate the value
   - Set default value if not provided

3. **Add to BaseConfig if shared**
   - If config applies to all variants (web/desktop/combined)
   - Edit `src/config.shared.ts`
   - Add to `BaseConfig` class

4. **Make overridable (if applicable)**
   - Edit `src/overridableConfig.ts`
   - Add to `OverridableConfig` type
   - Add to `defaultConfig` object
   - Add to `overridableConfigSchema` Zod schema
   - This allows per-site overrides via MCP site settings

5. **Document in env.example.list**
   - Add config to `env.example.list`
   - Include description and example value
   - Note if it's optional or required
   - Explain default behavior

6. **Update README if user-facing**
   - If config affects deployment/setup
   - Add to README.md configuration section

7. **Add tests**
   - Edit `src/config.test.ts`
   - Test config loads correctly
   - Test validation (invalid values)
   - Test default value
   - If overridable, add tests in `src/overridableConfig.test.ts`

8. **Use the config**
   - Access via `getConfig().yourConfigName`
   - Or via context: `context.config.yourConfigName`
   - Consider request-level overrides if applicable

9. **Run checks**
   - `npm run lint:fix`
   - `npm test -- config`
   - `npm run build`

## Example

```typescript
// In src/config.ts
export class Config extends BaseConfig {
  enableFeatureX: boolean;

  constructor() {
    super();
    
    const {
      ENABLE_FEATURE_X: enableFeatureX,
      // ... other env vars
    } = process.env;

    this.enableFeatureX = enableFeatureX === 'true';
  }
}

// In env.example.list
ENABLE_FEATURE_X=false  # Enable feature X (default: false)

// Usage in code
const config = getConfig();
if (config.enableFeatureX) {
  // Feature X logic
}
```

## Overridable Config Example

```typescript
// In src/overridableConfig.ts
export type OverridableConfig = {
  enableFeatureX?: boolean;
  // ... other configs
};

export const defaultConfig: Required<OverridableConfig> = {
  enableFeatureX: false,
  // ... other defaults
};

const overridableConfigSchema = z.object({
  enableFeatureX: z.boolean().optional(),
  // ... other schemas
});
```
