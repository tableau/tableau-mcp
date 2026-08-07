/**
 * Live eval for the static data-app workflow. Uses the repository's established eval harness
 * (`getMcpServer` + `grade` + `getToolExecutions`) — it is NOT part of `scripts/agent-check` and only
 * runs under `npm run test:eval` with an `OPENAI_API_KEY` and Tableau credentials present.
 *
 * The deterministic, code-testable invariants from the same Claude trace are covered offline in
 * `src/tools/web/dataApps/staticDataAppFlow.integration.test.ts`; this file grades the
 * non-deterministic agent behaviour (intent detection, querying, authoring, and workflow ordering).
 */

import { MCPServerStdio } from '@openai/agents';
import dotenv from 'dotenv';

import { getDefaultEnv, resetEnv, setEnv } from '../../testEnv.js';
import { getMcpServer, getModel, getToolExecutions } from '../base.js';
import { grade } from '../grade.js';
import { staticDataAppScenarios } from './harnessScenarios.js';

// Skip entirely unless an eval model key is configured, so the suite never hard-fails in an
// environment that has not opted into live evals.
const runLiveEval = Boolean(process.env.OPENAI_API_KEY);

describe.skipIf(!runLiveEval)('static data-app workflow (eval)', () => {
  let mcpServer: MCPServerStdio;

  beforeAll(setEnv);
  afterAll(resetEnv);

  beforeAll(async () => {
    dotenv.config({ path: 'tests/eval/.env' });
  });

  beforeEach(async () => {
    mcpServer = await getMcpServer(getDefaultEnv());
  });

  afterEach(async () => {
    await mcpServer?.close();
  });

  for (const scenario of staticDataAppScenarios) {
    it(`${scenario.id}: ${scenario.intent}`, async () => {
      const { agentResult } = await grade({
        mcpServer,
        model: getModel(),
        prompt: scenario.prompt,
      });

      const executions = await getToolExecutions(agentResult);

      const failures = scenario.invariants
        .map((check) => check(executions))
        .filter((message): message is string => Boolean(message));

      expect(failures).toEqual([]);
    });
  }
});
