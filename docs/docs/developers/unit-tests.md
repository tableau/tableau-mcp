---
sidebar_position: 5
---

# Unit Tests

The Tableau MCP project uses [Vitest][vitest] for unit testing. Unit tests are located in the `src`
directory alongside their corresponding source files and are named `*.test.ts`.

## Running

To run the unit tests, use the `npm run test` or `npm run coverage` commands.

## Debugging

If you are using VS Code or a fork, you can use the
[Vitest extension](https://marketplace.visualstudio.com/items?itemName=vitest.explorer) to run and
debug the unit tests.

## CI

The unit tests are run in the CI pipeline and failures will prevent PRs from merging.

[vitest]: https://vitest.dev/
