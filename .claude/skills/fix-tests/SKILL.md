---
name: fix-tests
description: Fix failing tests systematically
---

When tests fail, follow this process:

1. **Run tests to see failures:**
   ```bash
   npm test
   ```

2. **Analyze each failure:**
   - Read the test file
   - Read the implementation file being tested
   - Understand what changed and why the test is failing

3. **For each failing test, decide:**
   - Is the implementation wrong? → Fix the code
   - Is the test wrong/outdated? → Update the test
   - Is it a type error? → Fix types first with `tsc --noEmit`

4. **Fix approach:**
   - Make ONLY the minimal change needed to fix the failure
   - Do NOT refactor or modify unrelated code
   - After each fix, run `npm test` to verify

5. **Verify:**
   - Run full test suite: `npm test -- --run`
   - Run type check: `npx tsc --noEmit`
   - Run lint: `npx eslint .`

6. **Stop conditions:**
   - If you hit 3 consecutive failures on the same test, STOP and explain what you've tried
   - Never modify more than 3 files without user confirmation

## Rules:
- Never skip tests or mark them as `.skip` without asking
- Never commit until ALL tests pass
- Show me the changes before committing
