# Claude Code Instructions for tableau-mcp

## ⚠️ CRITICAL: NEVER AUTO-COMMIT

**Wait for explicit approval before ANY commit. No exceptions.**

After making changes:
1. Show what changed
2. **STOP and WAIT**
3. Only commit when user explicitly says "commit this" or "ready to commit"

Do NOT commit just because work is done. Do NOT commit after showing a summary. **WAIT.**

---

## Code Style & Patterns

### Import Patterns
**This codebase does NOT use barrel exports (index.ts files).** Always import directly from specific files with `.js` extensions:

```typescript
// ✅ DO THIS
import { getFeatureGate } from './features/featureGate.js';
import { WebTool } from './tools/web/tool.js';

// ❌ DON'T DO THIS
import { getFeatureGate } from './features';  // No barrel exports
import { WebTool } from './tools/web';        // No index.ts pattern
```

### Environment Variable Defaults
Prefer `||` over `??` for environment variable defaults to handle empty strings:

```typescript
// ✅ DO THIS
this.featureConfigPath = featureConfigPath || 'features.json';

// ❌ DON'T DO THIS
this.featureConfigPath = featureConfigPath ?? 'features.json';  // Won't handle empty string
```

## Git Workflow

**CRITICAL: Never auto-commit.** Always wait for explicit user approval before making ANY git commit, regardless of context:

- ✅ Plan execution (subagent-driven development)
- ✅ Ad-hoc bug fixes
- ✅ Refactoring
- ✅ Documentation updates
- ✅ ANY code changes whatsoever

**Required workflow:**
1. Make changes without committing
2. Show user what changed (files modified/created/deleted, test results)
3. Wait for explicit approval: "commit this" / "looks good, commit"
4. Only then make the commit

**The ONLY exception:** User explicitly says "go ahead and commit" or "auto-commit is fine for this" in their message.

## Testing

### No Redundant Tests
Avoid duplicating test scenarios across unit, integration, and e2e tests:

**Unit tests** - Test individual classes/functions in isolation
- Example: FeatureGate class methods, validation logic

**Integration tests** - Test integration between components (singleton patterns, class interactions)
- Only include tests that are actually testing integration
- Don't duplicate unit test scenarios (like "invalid JSON") in integration tests

**E2E tests** - Test actual files/configs in the project
- Example: Validate `features.json` format in CI
- Catch deployment issues before production

**Red flag:** If an integration test only calls one class and doesn't test interaction with other components, it probably belongs in unit tests.

### Validation Strategy
For config files:
- ✅ Strict validation at runtime (Zod schema - fail entire config if any value invalid)
- ✅ E2E test validates actual config file in CI
- ✅ Fail fast at startup, not during request handling
- ❌ Avoid partial validation (accepting some valid + some invalid values) - adds complexity

### Singleton Patterns
When implementing singletons (like FeatureGate):
- ✅ Use explicit initialization (`initializeFeatureGate(path)`) instead of lazy initialization
- **Why:** Config paths are dynamic (from env vars), lazy init makes API confusing
- **Pattern:** Initialize once at startup with config path, retrieve anywhere without path
- ✅ Fail fast - errors at initialization, not first use

## Implementation Workflow

When implementing plans using subagent-driven development, use **Commit Checkpoints** workflow:

1. Execute tasks without auto-commits
2. After each task, show user what was implemented and which files changed
3. Wait for user approval before committing
4. User decides: "commit this" / "continue without committing" / "batch with next task"
