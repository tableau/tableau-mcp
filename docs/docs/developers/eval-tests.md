---
sidebar_position: 7
---

# Eval Tests

The Tableau MCP project uses [Vitest][vitest] for eval tests. Eval tests are located in the
`tests/eval` directory and are named `*.test.ts`.

## What is an Eval test?

Eval tests—aka Evals—are tests used to evaluate MCP tool implementations using LLM-based scoring.
The tests provide assessments for accuracy, completeness, relevance, clarity, and reasoning and help
answer questions like:

- Can the model consistently choose the correct tools to answer the user prompt?
- Can the model generate the correct tool inputs based on the user prompt?
- Does the tool implementation accurately answer the user prompt?
- Is the tone suitable for the target audience?

## Running

The eval tests can only be run:

1. Locally.
2. If you have access to a site the tests understand. Currently, that's only
   https://10ax.online.tableau.com/#/site/mcp-test/.
3. If you have an OpenAI API key or access to an OpenAI-compatible gateway.

To run them locally:

1. Ensure you do not have a `.env` file in the root of the project.
2. Create a `tests/.env` file with contents:

```
SERVER=https://10ax.online.tableau.com
SITE_NAME=mcp-test
AUTH=direct-trust
JWT_SUB_CLAIM=<your email address>
CONNECTED_APP_CLIENT_ID=<redacted>
CONNECTED_APP_SECRET_ID=<redacted>
CONNECTED_APP_SECRET_VALUE=<redacted>
```

3. Create a `tests/.env.reset` file with the same contents except all the env var values are empty.
   (Environment variables get set at the beginning of each test and cleared at the end of each
   test.)

4. Create a `tests/eval/.env` file with contents:

```
OPENAI_API_KEY=<your OpenAI API key>
```

5. Run `npm run test:eval` or select the `vitest.config.eval.ts` config in the [Vitest
   extension][vitest.explorer] and run them from your IDE.

## Environment Variables

The following environment variables are used by the Eval tests:

### `OPENAI_API_KEY`

The OpenAI API key.

<hr />

### `ENABLE_LOGGING`

When `true`, LLMs will stream their output to the console and tool call information will also be
logged.

<hr />

### `OPENAI_BASE_URL`

The base URL for the OpenAI-compatible gateway.

<hr />

### `EVAL_TEST_MODEL`

The model to use for the Eval tests. If not set, the default model is used.

## Running the Eval tests against a different site

To run the Eval tests locally against a different site, you need to:

1. Have a site that has the Superstore sample datasource and workbook (which exist with every new
   site). The tests query this datasource and workbook.
2. Create and enable a [Direct Trust Connected App][connected-app] in the site.
3. Create a Pulse Metric Definition named `Tableau MCP`. Its details don't matter.
4. Update the `environmentData` object in `tests/constants.ts` with the new site details.
5. Follow the steps in the [Running](#running) section, providing these new site details in the
   `tests/.env` file.

## Debugging

If you are using VS Code or a fork, you can use the [Vitest extension][vitest.explorer] to run and
debug the Eval tests.

[vitest.explorer]: https://marketplace.visualstudio.com/items?itemName=vitest.explorer
[vitest]: https://vitest.dev/
[connected-app]: https://help.tableau.com/current/server/en-us/connected_apps_direct.htm
