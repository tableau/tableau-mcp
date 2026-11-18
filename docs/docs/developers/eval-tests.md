---
sidebar_position: 7
---

# Eval Tests

The Tableau MCP project uses [Vitest][vitest] for eval tests. Eval tests are located in the
`tests/eval` directory and are named `*.test.ts`.

## What is an Eval test?

Eval tests (aka evals) are tests used to evaluate MCP tool implementations using LLM-based scoring.
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

## Desktop remove-field recovery evals

`tests/eval/removeField.test.ts` covers W-24252809 with eight model-driven cases: stale Rows and
Columns assumptions, recovery after a wrong-shelf error, an already-removed field, missing Size and
Angle encodings, preservation of pending edits, and Detail/lod removal. The model receives the built
Desktop tool schemas and the current implementation's error diagnostics and success response. Tool
execution uses in-memory worksheet fixtures; no Tableau session, site, or workbook changes are
needed.

Successful removals report the removed reference and resulting draft placements. The fixture uses
the same result formatter as production and matches the SDK's single-content tool output; offline
checks cover that parity and reject invalid combinations of read selectors.

The deterministic grader checks inspection before removal, correct final placements, preservation of
unrelated fields, and absence of redundant retries or live refreshes of pending drafts. It grades
tool behavior rather than the wording of the final answer. These are focused recovery evals, not
end-to-end Desktop or full-tool-catalog discovery tests.

Build Desktop and run only this model suite with `OPENAI_API_KEY`, `OPENAI_BASE_URL` (for a
gateway), and optionally `EVAL_TEST_MODEL` configured in your environment or `tests/eval/.env`:

```sh
npm run build:desktop
npm run test:eval -- run tests/eval/removeField.test.ts
```

Use a Desktop bundle built from the same checkout as the tests: schemas come from the bundle, while
removal diagnostics and the shared success formatter come from the source. Comparing revisions
requires both to match.

Set `ENABLE_LOGGING=true` to log each scenario's tool sequence, model-turn boundaries, call IDs, and
final response. Call IDs are also logged as tools start, so a timeout retains partial execution
evidence. A failed grade includes the tool sequence in its assertion output. Every case is bounded
to eight agent turns. Identical call IDs across repeated runs can indicate gateway response caching;
do not count cached repeats as independent model samples. This suite disables SDK trace export;
model requests use the configured gateway.

The fixture, grading, and tool-isolation checks run without a model credential, Desktop build, or
network access:

```sh
npm run test:eval -- run tests/eval/removeFieldScenario.test.ts tests/eval/base.test.ts
```

## Desktop dashboard apply evals

`tests/eval/dashboardApply.test.ts` covers W-24366364 with ten model-driven cases: adding an already
registered worksheet to an empty dashboard, replacing membership while retaining view settings,
removing the final worksheet, ordinary layout edits, recovery from unsupported worksheet zone types
in desktop and Phone layouts, rejection of a genuinely blank worksheet, and safe refusal of missing
registrations in both empty and populated dashboards, preserving concurrent Desktop edits, and
repairing unsafe zone types already present in the live dashboard. Known crash hazards cannot be
grandfathered from the live baseline. Existing-dashboard edits use the surgical dashboard endpoint.
Desktop builds advertising External Client API 0.2.22 or later create missing worksheet views during
surgical dashboard apply. The MCP planner permits automatic completion on those builds, after every
worksheet has been populated, and apply verifies the registrations in live readback. Older or
unknown API versions still require manual registration in Desktop. A whole-workbook replacement is
never a fallback for missing registrations.

The model uses the built Desktop tool schemas. Cache files and the External API are in-memory
fixtures, while applies run the production `loadDashboardXml` implementation, validation, and
response formatters. The fake API preserves the distinction between dashboard layout updates and
workbook view registrations, and models additive workbook actions. The independent grader checks the
final layouts, required registrations (allowing retained unused viewpoints), retained view settings,
unrelated worksheets/data sources/actions, apply route, readback, and redundant retries. It grades
tool behavior, not final-answer wording.

No Tableau session or workbook is accessed. These focused evals do not replace live rendering or
native zone-removal validation. Build the Desktop bundle from the same checkout as the tests and
configure model credentials as described above, then run:

```sh
npm run build:desktop
npm run test:eval -- run tests/eval/dashboardApply.test.ts
```

Each case allows ten agent turns and two minutes. `ENABLE_LOGGING=true` records tool calls, call
IDs, model turns, and final responses; SDK trace export is disabled. The fixture and grader checks
run offline, including negative controls for the original missing-registration bug, duplicate
actions, incomplete Phone repairs, discarded draft changes, and omitted readback:

```sh
npm run test:eval -- run tests/eval/dashboardApplyScenario.test.ts tests/eval/base.test.ts
```

## Tableau Agent evals

These evals cover the `tableau-agent-start-conversation` and `tableau-agent-ask` tools. They run
against the `tableauagent1` site on test-dataplane1, which has Tableau Agent enabled, not the
default 10ax site.

| File                          | What it checks                                                                                                                                                                                                                                         | Model needed |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| `cases/cabuGoldDreamforce.ts` | Not a test. Tableau Agent's gold suite: 59 sales-pipeline questions with reference answers, on the `tabagent-tdp1-evals` site. Select it with `EVAL_SUITE=gold`.                                                                                       | —            |
| `cases/dataQuestions.ts`      | Not a test. About 40 data questions on "Sample - Superstore" and "Medicare-Claims" with known answers, each with the VizQL query that produced them.                                                                                                   | —            |
| `dataQuestionsOracle.test.ts` | Runs each case's query through `query-datasource` and checks the expected numbers still hold.                                                                                                                                                          | No           |
| `dataQuestions.test.ts`       | Pass/fail. **plain**: the question as written must use `query-datasource`, not Tableau Agent. **tableau-agent**: only turn 1 says "Ask Tableau Agent:"; every turn must stay in one Tableau Agent conversation. Both modes must get the numbers right. | Yes          |
| `cabuSelection.test.ts`       | Tool choice only: ordinary prompts and near-miss wording ("use CABU", "ask an agent") avoid Tableau Agent, asking for it by name ("Ask Tableau Agent", "use Tableau's agent") uses it, and a follow-up threads through the same conversation.          | Yes          |
| `cabuAb.test.ts`              | A measurement, not a gate: answer accuracy, latency, and client token use with Tableau Agent off, on and opted in, and on with plain prompts. Writes a report to `tests/eval/results/`.                                                                | Yes          |

Prompts name content the way a user would: the data source and its project by name, never by LUID.
Finding the right data source (and, for Tableau Agent, the workbook) is part of the task, and the
evals check that the model used the case's LUIDs.

Answers are graded numerically first. When that fails, an LLM judge compares the answer to the
case's reference answer.

To run them:

1. Create `tests/.env` for the site with a PAT:

   ```
   SERVER=https://test-dataplane1.tableau.sfdc-ckzqgc.svc.sfdcfc.net
   SITE_NAME=tableauagent1
   AUTH=pat
   PAT_NAME=<your PAT name>
   PAT_VALUE=<your PAT value>
   ```

2. Create `tests/.env.reset` with the same keys and empty values.
3. Set `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and optionally `EVAL_TEST_MODEL` in `tests/eval/.env`.
4. Build and run:

   ```sh
   npm run build
   npx vitest run --config ./vitest.config.eval.ts tests/eval/dataQuestionsOracle.test.ts
   npx vitest run --config ./vitest.config.eval.ts tests/eval/dataQuestions.test.ts
   ```

Run the oracle test first when adding cases or when answers fail on numbers. It separates data drift
and case typos from model mistakes.

`dataQuestions.test.ts` runs only the smoke cases by default, in both modes: 8 tests, roughly 10
minutes. Tableau Agent turns take about 30–90 seconds each. Tests run one at a time because the site
rate-limits parallel queries.

### The gold suite

`EVAL_SUITE=gold` runs `dataQuestions.test.ts` or `cabuAb.test.ts` on Tableau Agent's gold suite
instead. It lives on a different site, so point `tests/.env` at `SITE_NAME=tabagent-tdp1-evals` with
a PAT for that site. The oracle test doesn't apply: the gold cases have reference answers, not
queries.

Each gold prompt names the suite's view, "Sales by Account - Dreamforce", as well as the data
source. The model must find the view's workbook and pass it to Tableau Agent. With the workbook,
Tableau Agent samples field values and applies the workbook's business preferences, such as a fiscal
year that starts in February. The plain path doesn't get those preferences, so expect it to miss
fiscal and vocabulary questions.

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

<hr />

### `ALLOW_MUTATING_FLOW_EVALS`

When `true`, enables evals that can invoke the content-mutating Tableau Prep flow tools. These evals
are skipped by default because the eval harness executes real MCP tool calls against the configured
Tableau site. Only enable them on a disposable site.

This is a test-safety gate, separate from the product feature gates. Mutating flow evals also
require `FLOW_WRITE_TOOLS_ENABLED=true`.

<hr />

### `FLOW_WRITE_TOOLS_ENABLED`

Required, together with `ALLOW_MUTATING_FLOW_EVALS=true`, to expose the mutating flow tools during
the mutating flow evals. Leave unset for the default eval run.

<hr />

### `EVAL_DATA_CASES`

Which cases `dataQuestions.test.ts` runs: unset for the smoke cases, `all` for every case, or a
comma-separated list of case ids from `tests/eval/cases/dataQuestions.ts`.

<hr />

### `EVAL_SUITE`

The case suite for `dataQuestions.test.ts` and `cabuAb.test.ts`: `data` (default, `tableauagent1`)
or `gold` (`tabagent-tdp1-evals`).

<hr />

### `EVAL_DATA_MODES`

Limits `dataQuestions.test.ts` to one mode: `plain` or `tableau-agent`. Runs both when unset.

<hr />

### `EVAL_JUDGE_MODEL`

The model that grades answers when the numeric check fails. Defaults to `EVAL_TEST_MODEL`.

<hr />

### `EVAL_WRITE_EXPECTED`

When `true`, `dataQuestionsOracle.test.ts` prints each query's rows instead of checking them. Use it
to fill in the expected numbers for new cases.

<hr />

### `RUN_CABU_AB`

When `true`, runs the `cabuAb.test.ts` A/B measurement. `AB_ARMS`, `AB_CASES`, `AB_REPEATS`,
`AB_TURN_TIMEOUT_MS`, and `AB_MAX_TURNS` tune it; see the file header.

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
