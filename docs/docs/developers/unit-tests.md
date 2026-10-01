---
sidebar_position: 5
---

# Unit Tests

The Tableau MCP project uses [Vitest][vitest] for unit testing. Unit tests are located in the `src`
directory alongside their corresponding source files and are named `*.test.ts`.

## Running

Run the complete unit-test suite once with:

```bash
npx vitest run --config ./vitest.config.ts
```

Use `npm run coverage` to run the same suite with coverage reporting. The `npm test` command starts
Vitest in watch mode, so reserve it for interactive development rather than CI or one-shot checks.

## Debugging

If you are using VS Code or a fork, you can use the
[Vitest extension](https://marketplace.visualstudio.com/items?itemName=vitest.explorer) to run and
debug the unit tests.

## CI

The unit tests are run in the CI pipeline and failures will prevent PRs from merging.

[vitest]: https://vitest.dev/
