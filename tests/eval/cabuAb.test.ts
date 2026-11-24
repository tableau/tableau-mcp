import { MCPServerStdio } from '@openai/agents';
import dotenv from 'dotenv';

import { getDefaultEnv, resetEnv, setEnv } from '../testEnv.js';
import { addUsage, ArmId, emptyUsage, RunRecord, TurnRecord, writeResults } from './ab/metrics.js';
import { getAgent, getMcpServer, getModel } from './base.js';
import {
  CABU_TOOLS,
  checkSourceChoice,
  getUsage,
  gradeAnswer,
  normalizeToolName,
  parseList,
  runConversation,
  selectSuite,
} from './cabuHelpers.js';
import { AbCase } from './cases/dataQuestions.js';

dotenv.config({ path: 'tests/eval/.env' });

/**
 * A/B eval: Tableau MCP data Q&A with and without the Tableau Agent (CABU) tools.
 *
 * - Arm A: today's Tableau MCP, Tableau Agent tools off (the baseline).
 * - Arm B: Tableau Agent tools on, the other query tools off. Prompts opt in to Tableau Agent on
 *   turn 1, because the tool descriptions forbid using it otherwise.
 * - Arm C: the full tool set plus Tableau Agent, with plain (no opt-in) prompts. This measures
 *   whether adding the tools changes the existing Q&A path; its CABU usage should be ~0%.
 * - Arm D: the full tool set plus Tableau Agent, with B's opt-in prompts. This measures whether a
 *   user who asks for Tableau Agent gets it when the direct query tools are also available.
 *
 * This is a measurement, not a pass/fail gate: wrong answers are recorded, not asserted. Results go
 * to `tests/eval/results/` (gitignored) as JSON plus a markdown summary. Cases come from
 * `cases/dataQuestions.ts`; `dataQuestions.test.ts` is the pass/fail eval over the same cases.
 *
 * It is slow and spends real model and Tableau Agent calls, so it only runs with RUN_CABU_AB=true:
 *
 *   RUN_CABU_AB=true AB_ARMS=A,B,C AB_REPEATS=3 npx vitest run --config ./vitest.config.eval.ts tests/eval/cabuAb.test.ts
 *
 * Optional env: EVAL_SUITE (`data` or `gold`; see `selectSuite`), AB_CASES (comma-separated case
 * ids; default all), EVAL_JUDGE_MODEL (defaults to
 * the client model), AB_TURN_TIMEOUT_MS (default 6 minutes), AB_MAX_TURNS (default 20),
 * EVAL_TEST_MODEL.
 */

const RUN = process.env.RUN_CABU_AB === 'true';

const ARM_IDS: Array<ArmId> = ['A', 'B', 'C', 'D'];
const QUERY_TOOLS = ['query_datasource', 'get_datasource_metadata'];

const ARM_ENV: Record<ArmId, Record<string, string>> = {
  A: { TABLEAU_AGENT_TOOLS_ENABLED: 'false' },
  B: {
    TABLEAU_AGENT_TOOLS_ENABLED: 'true',
    // Prompts name content, not LUIDs, so the arm needs tools to look up the data source and workbook.
    INCLUDE_TOOLS: 'search-content,list-datasources,list-workbooks,list-views,tableau-agent',
  },
  C: { TABLEAU_AGENT_TOOLS_ENABLED: 'true' },
  D: { TABLEAU_AGENT_TOOLS_ENABLED: 'true' },
};

const OPT_IN_ARMS: Array<ArmId> = ['B', 'D'];

const agentSystemPrompt = `
  You are an assistant that answers questions about Tableau data.
  Given the user's query, use the tools available to you to answer the question.
  Include the specific numbers from the data in your answer.`;

const selectedArms = (parseList(process.env.AB_ARMS) ?? ARM_IDS).filter((arm): arm is ArmId =>
  ARM_IDS.includes(arm as ArmId),
);
const selectedCaseIds = parseList(process.env.AB_CASES);
const selectedCases = selectSuite().filter(
  (c) => !selectedCaseIds || selectedCaseIds.includes(c.id),
);
const repeats = Math.max(1, Number(process.env.AB_REPEATS ?? '1') || 1);
const turnTimeoutMs = Number(process.env.AB_TURN_TIMEOUT_MS ?? '') || 6 * 60 * 1000;
const maxTurns = Number(process.env.AB_MAX_TURNS ?? '') || 20;
const JUDGE_BUDGET_MS = 2 * 60 * 1000;

async function runCase(
  mcpServer: MCPServerStdio,
  arm: ArmId,
  abCase: AbCase,
  repeat: number,
): Promise<RunRecord> {
  const model = getModel();
  const agent = await getAgent({ mcpServer, model, systemPrompt: agentSystemPrompt });
  // Parallel metadata calls trip VDS rate limits on shared eval sites.
  agent.modelSettings = { ...agent.modelSettings, parallelToolCalls: false };
  const conversation = await runConversation(agent, abCase, {
    optIn: OPT_IN_ARMS.includes(arm),
    timeoutMs: turnTimeoutMs,
    maxTurns,
  });

  const turns: Array<TurnRecord> = [];
  for (const [index, turn] of conversation.entries()) {
    const toolCalls = turn.executions.map((execution) => normalizeToolName(execution.name));
    const grade = turn.error
      ? { correct: false, method: 'none' as const, detail: 'turn failed' }
      : await gradeAnswer(turn.prompt, turn.finalOutput, abCase.turns[index].expected);
    turns.push({
      turn: index + 1,
      prompt: turn.prompt,
      latencyMs: turn.latencyMs,
      usage: turn.result ? getUsage(turn.result) : emptyUsage(),
      toolCalls,
      usedCabu: toolCalls.some((name) => CABU_TOOLS.includes(name)),
      finalOutput: turn.finalOutput,
      correct: grade.correct,
      gradeMethod: grade.method,
      gradeDetail: grade.detail,
      ...(turn.error !== undefined ? { error: turn.error, timedOut: turn.timedOut } : {}),
    });
  }

  return {
    arm,
    caseId: abCase.id,
    repeat,
    model,
    latencyMs: turns.reduce((sum, turn) => sum + turn.latencyMs, 0),
    usage: turns.reduce((sum, turn) => addUsage(sum, turn.usage), emptyUsage()),
    usedCabu: turns.some((turn) => turn.usedCabu),
    correct: turns.length === abCase.turns.length && turns.every((turn) => turn.correct),
    errored: turns.some((turn) => turn.error !== undefined),
    timedOut: turns.some((turn) => turn.timedOut === true),
    sourceProblems: checkSourceChoice(
      abCase,
      conversation.flatMap((turn) => turn.executions),
    ),
    turns,
  };
}

describe.skipIf(!RUN)('Tableau Agent (CABU) A/B eval', () => {
  const runs: Array<RunRecord> = [];

  beforeAll(setEnv);
  afterAll(() => {
    resetEnv();
    if (runs.length > 0) {
      const { json, markdown } = writeResults(runs, getModel());
      console.log(`CABU A/B results written to ${json} and ${markdown}`);
    }
  });

  describe.each(selectedArms)('arm %s', (arm) => {
    let mcpServer: MCPServerStdio;

    beforeAll(async () => {
      mcpServer = await getMcpServer({ ...getDefaultEnv(), ...ARM_ENV[arm] });

      // Fail fast if the arm's server config didn't produce the intended tool set.
      const toolNames = (await mcpServer.listTools()).map((tool) => normalizeToolName(tool.name));
      const hasCabu = CABU_TOOLS.every((name) => toolNames.includes(name));
      const hasQuery = QUERY_TOOLS.some((name) => toolNames.includes(name));
      if (arm === 'A' && hasCabu) {
        throw new Error('Arm A exposes the Tableau Agent tools; expected them off.');
      }
      if (arm !== 'A' && !hasCabu) {
        throw new Error(
          `Arm ${arm} is missing the Tableau Agent tools. Tools: ${toolNames.join(', ')}`,
        );
      }
      if (arm === 'B' && hasQuery) {
        throw new Error(`Arm B still exposes query tools. Tools: ${toolNames.join(', ')}`);
      }
      if (arm !== 'B' && !hasQuery) {
        throw new Error(`Arm ${arm} is missing the query tools. Tools: ${toolNames.join(', ')}`);
      }
    }, 60 * 1000);

    afterAll(async () => {
      await mcpServer?.close();
    });

    const matrix = selectedCases.flatMap((abCase) =>
      Array.from({ length: repeats }, (_, i) => ({ abCase, repeat: i + 1 })),
    );

    it.each(matrix)(
      '$abCase.id (repeat $repeat)',
      async ({ abCase, repeat }) => {
        runs.push(await runCase(mcpServer, arm, abCase, repeat));
      },
      // Each turn can take turnTimeoutMs plus a judge call; leave a minute of slack.
      Math.max(...selectedCases.map((c) => c.turns.length), 1) * (turnTimeoutMs + JUDGE_BUDGET_MS) +
        60 * 1000,
    );
  });
});
