---
name: run-tests
description: Run test suite with options
---

Run tests based on user request:

1. **Full suite:** `npm test -- --run`
2. **Watch mode:** `npm test`
3. **Specific file:** `npx vitest run [file-path]`
4. **With coverage:** `npm run coverage`
5. **E2E tests:** `npm run test:e2e`
6. **OAuth tests:** `npm run test:oauth:tableau`

After running, report:
- Pass/fail count
- Failed test names (if any)
- Suggest /fix-tests if failures exist
