---
sidebar_position: 7
---

# Eval Tests

The Tableau MCP project uses [Vitest][vitest] for eval tests. Eval tests are located in the
`tests/eval` directory and are named `*.test.ts`.

## What is an Eval test?

Eval tests—aka Evals—are tests used to evaluate the MCP tool implementations using LLM-based
scoring. The tests provide assessments for accuracy, completeness, relevance, clarity, and reasoning
and help answer questions like:

- Can the model consistently choose the correct tools to answer the user prompt?
- Can the model generate the correct tool inputs based on the user prompt?
- Does the tool implementation accurately answer the user prompt?
- Is the tone suitable for the target audience?

## Running

The eval tests can only be run:

1. Locally.
2. If you have access to a site the tests understand. Currently, that's only
   https://10ax.online.tableau.com/#/site/mcp-test/.
3. If you have an OpenAI API key or OpenAI-compatible gateway.

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

4. By default, the tests use Salesforce's internal [LLM Gateway Express][llm-gateway-express], which
   is an OpenAI-compatible gateway only available internally to Salesforce employees. To use a
   different gateway, set the `OPENAI_BASE_URL` environment variable to the URL of the gateway you
   want to use. If you are a Salesforce employee and want to use the gateway, you also need to:

   - Get your API key from the gateway.

     1. Go to [LLM Gateway Express][llm-gateway-express] in your browser.
     2. Log in using SSO and click "Generate Key".
     3. This will be the value of your `OPENAI_API_KEY` environment variable.

   - Set the `NODE_EXTRA_CA_CERTS` environment variable to the path of the file containing the
     certificate chain of the gateway.

     1. Go to [LLM Gateway Express][llm-gateway-express] in your browser.
     2. Click the SSL lock icon > Connection is secure > Show certificate button > Details tab. If
        you're using a non-Chromium browser, YMMV.
     3. Click Export and choose the Base64-encoded ASCII **certificate chain** option. This is not
        necessarily the default selected option in the Save dialog. Make sure you explicitly choose
        the **chain**.
     4. Name the file something like `ingressgateway.pem`, put it somewhere "permanent" like in your
        home directory.
     5. Open the file in a text editor and verify you see all certs in the chain, not just a single
        cert. If it's just a single cert, return to step (c) and read the instructions more
        carefully.
     6. Set the `NODE_EXTRA_CA_CERTS` environment variable to the path of the file i.e.
        `NODE_EXTRA_CA_CERTS=path/to/ingressgateway.pem`. No quotes.
     7. ⚠️ Note that this cannot be done with the `.env` file. It **must** be set _before_ running
        the tests. See https://nodejs.org/docs/latest/api/cli.html#node_extra_ca_certsfile

5. Create a `tests/eval/.env` file with contents:

```
OPENAI_API_KEY=<your OpenAI API key>
EVAL_TEST_MODEL=<your OpenAI model or omitted/empty to use the default>
ENABLE_LOGGING=<true to enable LLM streaming and other tool call logging>
```

6. Run `npm run test:eval` or select the `vitest.config.eval.ts` config in the [Vitest
   extension][vitest.explorer] and run them from your IDE.

## Running the Eval tests against a different site

To run the Eval tests locally against a different site, you need to:

1. Have a site that has the Superstore sample datasource and workbook (which exist with every new
   site). The tests query this datasource and workbook.
2. Create and enable a [Direct Trust Connected App][connected-app] in the site.
3. Create a Pulse Metric Definition named `Tableau MCP`. Its details don't matter.
4. Update the `environmentData` object in `tests/constants.ts` with the new site details.
5. Follow the steps in the [Running](#running) section, providing these new site details in the
   `tests/.env` file.

## Other models

If you're using the [LLM Gateway Express][llm-gateway-express], you can get the list of supported
models by making a GET request. Use the model `id` as the value of the `EVAL_TEST_MODEL` environment

```cmd
curl -X GET "https://eng-ai-model-gateway.sfproxy.devx.aws-dev2-uswest2.aws.sfdc.cl/v1/models" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your API key>"
```

## Debugging

If you are using VS Code or a fork, you can use the [Vitest extension][vitest.explorer] to run and
debug the Eval tests, keep in mind that the `NODE_EXTRA_CA_CERTS` environment variable must be set
if you are using the [LLM Gateway Express][llm-gateway-express]. I don't think Vitest supports this
(see [Vitest issue #13](https://github.com/rluvaton/vitest-vs-code-plugin/issues/13)) so your best
bet is to set a system-level environment variable or set it in the IDE's JavaScript Debug terminal,
setting breakpoints, then running the tests using `npm run test:eval`.

[vitest.explorer]: https://marketplace.visualstudio.com/items?itemName=vitest.explorer
[vitest]: https://vitest.dev/
[connected-app]: https://help.tableau.com/current/server/en-us/connected_apps_direct.htm
[llm-gateway-express]: https://eng-ai-model-gateway.sfproxy.devx.aws-dev2-uswest2.aws.sfdc.cl
