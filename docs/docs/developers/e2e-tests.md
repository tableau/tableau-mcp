---
sidebar_position: 2
---

# E2E Tests

The Tableau MCP project uses [Vitest](https://vitest.dev/) for end-to-end (E2E) testing. E2E tests
are located in the `e2e` directory and are named `*.test.ts`.

## Running

The E2E tests can only be run:

1. As part of the CI pipeline.
2. Locally if you have access to a site the tests understand. Currently, only
   https://10ax.online.tableau.com/#/site/mcp-test/.

To run them locally:

1. Create a `e2e/.env` file with contents:

```
SERVER=https://10ax.online.tableau.com
SITE_NAME=mcp-test
AUTH=direct-trust
JWT_SUB_CLAIM=<your email address>
CONNECTED_APP_CLIENT_ID=<redacted>
CONNECTED_APP_SECRET_ID=<redacted>
CONNECTED_APP_SECRET_VALUE=<redacted>
```

2. Create a `e2e/.env.reset` file with the same contents except all the env var values as empty.
   Environment variables get set at the beginning of each test and cleared at the end of each test.
3. Run `npm run test:e2e` or select the `vitest.config.e2e.ts` config in the [Vitest
   extension][vitest.explorer] and run them from your IDE.

## Running the E2E tests against a different site

To run the E2E tests locally against a different site, you need to:

1. Have a site that has the Superstore sample datasource and workbook (which exist with every new
   site). The tests query this datasource and workbook.
2. Create and enable a
   [Direct Trust Connected App](https://help.tableau.com/current/server/en-us/connected_apps_direct.htm)
   in the site.
3. Create a Pulse Metric Definition named `Tableau MCP`. Its details don't matter.
4. Update the `environmentData` object in `e2e/constants.ts` with the new site details.
5. Follow the steps in the [Running](#running) section, providing these new site details in the
   `e2e/.env` file.

## Debugging

If you are using VS Code or a fork, you can use the [Vitest extension][vitest.explorer] to run and
debug the E2E tests.

[vitest.explorer]: (https://marketplace.visualstudio.com/items?itemName=vitest.explorer)
