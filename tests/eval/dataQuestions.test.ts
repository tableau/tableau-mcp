import { MCPServerStdio } from '@openai/agents';
import dotenv from 'dotenv';
import z from 'zod';

import { getDefaultEnv, resetEnv, setEnv } from '../testEnv.js';
import { getAgent, getMcpServer, getModel, log } from './base.js';
import {
  CABU_TOOLS,
  checkSourceChoice,
  ConversationTurn,
  findCalls,
  gradeAnswer,
  normalizeToolName,
  parseList,
  parseToolResult,
  runConversation,
  selectSuite,
} from './cabuHelpers.js';
import { AbCase } from './cases/dataQuestions.js';

dotenv.config({ path: 'tests/eval/.env' });

/**
 * Pass/fail evals: data questions with known answers, on the real tool set with the Tableau Agent
 * tools on.
 *
 * Turn 1 names the data source and its project (and a view, for the gold suite) by name, never by
 * LUID. Both modes must find and use the case's data source, and in Tableau Agent mode its workbook.
 *
 * - plain: the question as written. The model must not use Tableau Agent, must call
 *   query-datasource, and must get the numbers right.
 * - tableau-agent: turn 1 opts in with "Ask Tableau Agent:"; later turns are plain. The whole
 *   conversation must run through one Tableau Agent conversation (one start, a cabu-ask every turn,
 *   parentLuid threaded), never call query-datasource, and get the numbers right.
 *
 * Only `smoke` cases run by default. EVAL_DATA_CASES=all runs every case; a comma-separated list of
 * ids runs those. EVAL_DATA_MODES=plain or =tableau-agent runs one mode. EVAL_SUITE=gold runs Tableau
 * Agent's gold suite instead (see `cases/cabuGoldDreamforce.ts`).
 */

const MODES = ['plain', 'tableau-agent'] as const;
type Mode = (typeof MODES)[number];

const TURN_TIMEOUT_MS = 3 * 60 * 1000;
const JUDGE_BUDGET_MS = 60 * 1000;

const agentSystemPrompt = `
  You are an assistant that answers questions about Tableau data.
  Given the user's query, use the tools available to you to answer the question.
  Include the specific numbers from the data in your answer.`;

const startResultSchema = z.object({ conversationId: z.string(), utteranceArgs: z.string() });
const askResultSchema = z.object({ nextParentLuid: z.string() }).passthrough();

function selectCases(): Array<AbCase> {
  const suite = selectSuite();
  const selection = process.env.EVAL_DATA_CASES?.trim();
  if (!selection) {
    return suite.filter((abCase) => abCase.smoke);
  }
  if (selection === 'all') {
    return suite;
  }
  const ids = parseList(selection) ?? [];
  const unknown = ids.filter((id) => !suite.some((abCase) => abCase.id === id));
  if (unknown.length) {
    throw new Error(`Unknown EVAL_DATA_CASES ids: ${unknown.join(', ')}`);
  }
  return suite.filter((abCase) => ids.includes(abCase.id));
}

const selectedModes = (parseList(process.env.EVAL_DATA_MODES) ?? [...MODES]).filter(
  (mode): mode is Mode => MODES.includes(mode as Mode),
);
const selectedCases = selectCases();

function toolNames(turn: ConversationTurn): Array<string> {
  return turn.executions.map((execution) => normalizeToolName(execution.name));
}

/** Problems with the plain path's tool use; empty when it behaved. */
function checkPlainTools(turns: Array<ConversationTurn>): Array<string> {
  const problems: Array<string> = [];
  turns.forEach((turn, index) => {
    const cabuCalls = toolNames(turn).filter((name) => CABU_TOOLS.includes(name));
    if (cabuCalls.length) {
      problems.push(`turn ${index + 1} called Tableau Agent without opting in: ${cabuCalls}`);
    }
  });
  // A follow-up can be answered from an earlier result, so only the conversation as a whole must query.
  if (!turns.some((turn) => toolNames(turn).includes('query_datasource'))) {
    problems.push('never called query_datasource');
  }
  return problems;
}

/** Problems with the Tableau Agent path's tool use; empty when it behaved. */
function checkTableauAgentTools(turns: Array<ConversationTurn>): Array<string> {
  const problems: Array<string> = [];
  const allExecutions = turns.flatMap((turn) => turn.executions);

  const starts = findCalls(allExecutions, 'cabu_start_conversation');
  if (starts.length !== 1) {
    return [`expected 1 cabu_start_conversation, got ${starts.length}`];
  }
  if (!findCalls(turns[0].executions, 'cabu_start_conversation').length) {
    problems.push('cabu_start_conversation was not called on turn 1');
  }
  const started = parseToolResult(starts[0], startResultSchema);
  if (!started) {
    return [...problems, `cabu_start_conversation failed: ${starts[0].output}`];
  }

  if (findCalls(allExecutions, 'query_datasource').length) {
    problems.push('called query_datasource after opting in to Tableau Agent');
  }

  let lastNextParentLuid: string | undefined;
  turns.forEach((turn, index) => {
    const asks = findCalls(turn.executions, 'cabu_ask');
    if (!asks.length) {
      problems.push(`turn ${index + 1} did not call cabu_ask`);
    }
    for (const ask of asks) {
      if (ask.arguments.conversationId !== started.conversationId) {
        problems.push(`turn ${index + 1} cabu_ask used another conversation`);
      }
      // Each ask must continue from the last answered one, within and across turns.
      if (lastNextParentLuid && ask.arguments.parentLuid !== lastNextParentLuid) {
        problems.push(
          `turn ${index + 1} cabu_ask parentLuid ${ask.arguments.parentLuid} != previous nextParentLuid ${lastNextParentLuid}`,
        );
      }
      lastNextParentLuid =
        parseToolResult(ask, askResultSchema)?.nextParentLuid ?? lastNextParentLuid;
    }
  });
  return problems;
}

describe('data questions (eval)', () => {
  let mcpServer: MCPServerStdio;

  beforeAll(async () => {
    setEnv();
    mcpServer = await getMcpServer({ ...getDefaultEnv(), TABLEAU_AGENT_TOOLS_ENABLED: 'true' });
  });

  afterAll(async () => {
    await mcpServer?.close();
    resetEnv();
  });

  const matrix = selectedModes.flatMap((mode) => selectedCases.map((abCase) => ({ mode, abCase })));

  // Sequential (no .concurrent): parallel queries hit 429s on the eval site.
  it.each(matrix)(
    '$mode: $abCase.id',
    async ({ mode, abCase }) => {
      const agent = await getAgent({
        mcpServer,
        model: getModel(),
        systemPrompt: agentSystemPrompt,
      });
      const turns = await runConversation(agent, abCase, {
        optIn: mode === 'tableau-agent',
        timeoutMs: TURN_TIMEOUT_MS,
      });

      const problems: Array<string> = [];
      const failed = turns.find((turn) => turn.error);
      if (failed) {
        problems.push(`turn ${turns.indexOf(failed) + 1} failed: ${failed.error}`);
      } else {
        problems.push(
          ...(mode === 'plain' ? checkPlainTools(turns) : checkTableauAgentTools(turns)),
          ...checkSourceChoice(
            abCase,
            turns.flatMap((turn) => turn.executions),
          ),
        );
        for (const [index, turn] of turns.entries()) {
          const grade = await gradeAnswer(
            turn.prompt,
            turn.finalOutput,
            abCase.turns[index].expected,
          );
          if (!grade.correct) {
            problems.push(`turn ${index + 1} wrong (${grade.method}): ${grade.detail}`);
          }
        }
      }

      log(
        `${mode} ${abCase.id}: ${turns
          .map(
            (turn, i) =>
              `turn ${i + 1} ${(turn.latencyMs / 1000).toFixed(1)}s [${toolNames(turn)}]`,
          )
          .join('; ')}`,
        true,
      );
      expect(
        problems,
        turns.map((turn, i) => `turn ${i + 1} answer: ${turn.finalOutput}`).join('\n'),
      ).toEqual([]);
    },
    Math.max(...selectedCases.map((c) => c.turns.length), 1) * (TURN_TIMEOUT_MS + JUDGE_BUDGET_MS) +
      30 * 1000,
  );
});
