import { Agent, AgentInputItem, run, StreamedRunResult, withTrace } from '@openai/agents';
import z from 'zod';

import { addUsage, checkNumbers, emptyUsage, GradeMethod, TokenUsage } from './ab/metrics.js';
import { getAgent, getCallToolResult, getModel, getToolExecutions } from './base.js';
import { GOLD_DREAMFORCE_CASES } from './cases/cabuGoldDreamforce.js';
import { AbCase, DATA_QUESTION_CASES, ExpectedAnswer } from './cases/dataQuestions.js';

/** Shared helpers for the Tableau Agent (CABU) evals. */

export const CABU_TOOLS = ['cabu_start_conversation', 'cabu_ask'];

export const TABLEAU_AGENT_PREFIX = 'Ask Tableau Agent: ';

export type ToolExecution = Awaited<ReturnType<typeof getToolExecutions>>[number];

// Tools may be recorded with or without the `tableau_` prefix (see getAgent).
export function normalizeToolName(name: string): string {
  return name.replace(/^tableau_/, '').replace(/-/g, '_');
}

export function findCalls(
  executions: Array<ToolExecution>,
  toolName: string,
): Array<ToolExecution> {
  return executions.filter((execution) => normalizeToolName(execution.name) === toolName);
}

// Returns undefined (instead of throwing) when the tool errored or returned another shape, so the
// test can fail with a message that says which step broke.
export function parseToolResult<Z extends z.ZodTypeAny>(
  execution: ToolExecution,
  schema: Z,
): z.infer<Z> | undefined {
  try {
    return getCallToolResult(execution, schema);
  } catch {
    return undefined;
  }
}

export async function runTurn(
  agent: Agent,
  input: string | Array<AgentInputItem>,
  options: { timeoutMs?: number; maxTurns?: number } = {},
): Promise<StreamedRunResult<any, any>> {
  const controller = new AbortController();
  const timer = options.timeoutMs
    ? setTimeout(() => controller.abort(), options.timeoutMs)
    : undefined;
  try {
    return await withTrace('run_cabu_eval_agent', async () => {
      // Streamed chat completions omit token usage unless asked for it.
      const withUsage = agent.clone({
        modelSettings: {
          ...agent.modelSettings,
          providerData: {
            ...agent.modelSettings.providerData,
            stream_options: { include_usage: true },
          },
        },
      });
      const result = await run(withUsage, input, {
        stream: true,
        signal: controller.signal,
        ...(options.maxTurns ? { maxTurns: options.maxTurns } : {}),
      });
      if (process.env.ENABLE_LOGGING === 'true') {
        result.toTextStream({ compatibleWithNodeStreams: true }).pipe(process.stdout);
      }
      await result.completed;
      return result;
    });
  } finally {
    clearTimeout(timer);
  }
}

// Sums usage across the model responses of one `run()`; each turn is its own run, so this is per turn.
export function getUsage(result: StreamedRunResult<any, any>): TokenUsage {
  return result.rawResponses.reduce(
    (total, response) =>
      addUsage(total, {
        requests: response.usage.requests,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        totalTokens: response.usage.totalTokens,
      }),
    emptyUsage(),
  );
}

/**
 * The prompt for one turn of a case. Turn 1 names the data source (and its project and view, when
 * the case has them) the way a user would, by name; later turns are the bare question. With
 * `optIn`, only turn 1 asks for Tableau Agent: follow-ups must stay in the conversation on their
 * own.
 */
export function buildCasePrompt(abCase: AbCase, turnIndex: number, optIn: boolean): string {
  const { question } = abCase.turns[turnIndex];
  if (turnIndex > 0) {
    return question;
  }
  const project = abCase.projectName ? ` in the "${abCase.projectName}" project` : '';
  const view = abCase.viewName ? ` and the "${abCase.viewName}" view` : '';
  const withSource = `Using the "${abCase.datasourceName}" data source${project}${view}: ${question}`;
  return optIn ? `${TABLEAU_AGENT_PREFIX}${withSource}` : withSource;
}

/**
 * Problems with which data source and workbook the model queried; empty when it found the case's.
 * Prompts name content only by name, so finding the right LUIDs is part of the task.
 */
export function checkSourceChoice(abCase: AbCase, executions: Array<ToolExecution>): Array<string> {
  const problems: Array<string> = [];
  for (const toolName of ['query_datasource', 'cabu_start_conversation']) {
    for (const call of findCalls(executions, toolName)) {
      if (call.arguments.datasourceLuid !== abCase.datasourceLuid) {
        problems.push(
          `${toolName} used data source ${String(call.arguments.datasourceLuid)}, expected ${abCase.datasourceLuid}`,
        );
      }
    }
  }
  // Only Tableau Agent uses the workbook: it loads sample values and business preferences from it.
  if (abCase.workbookLuid) {
    for (const call of findCalls(executions, 'cabu_start_conversation')) {
      if (call.arguments.workbookLuid !== abCase.workbookLuid) {
        problems.push(
          `cabu_start_conversation used workbook ${String(call.arguments.workbookLuid ?? 'none')}, expected ${abCase.workbookLuid}`,
        );
      }
    }
  }
  return problems;
}

export type ConversationTurn = {
  prompt: string;
  latencyMs: number;
  /** Only this turn's tool calls; `result.history` repeats earlier turns' items first. */
  executions: Array<ToolExecution>;
  finalOutput: string;
  result?: StreamedRunResult<any, any>;
  error?: string;
  timedOut?: boolean;
};

/**
 * Runs every turn of a case in one agent conversation. Stops at the first failed turn, since a
 * failed turn leaves no history to continue from.
 */
export async function runConversation(
  agent: Agent,
  abCase: AbCase,
  options: { optIn: boolean; timeoutMs: number; maxTurns?: number },
): Promise<Array<ConversationTurn>> {
  const turns: Array<ConversationTurn> = [];
  let history: Array<AgentInputItem> = [];
  let priorExecutions = 0;

  for (let turnIndex = 0; turnIndex < abCase.turns.length; turnIndex++) {
    const prompt = buildCasePrompt(abCase, turnIndex, options.optIn);
    const input: string | Array<AgentInputItem> =
      turnIndex === 0 ? prompt : [...history, { role: 'user', content: prompt }];
    const started = Date.now();

    let result: StreamedRunResult<any, any>;
    try {
      result = await runTurn(agent, input, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      turns.push({
        prompt,
        latencyMs: Date.now() - started,
        executions: [],
        finalOutput: '',
        error: message,
        timedOut: Date.now() - started >= options.timeoutMs || /abort/i.test(message),
      });
      break;
    }

    const latencyMs = Date.now() - started;
    const executions = (await getToolExecutions(result)).slice(priorExecutions);
    priorExecutions += executions.length;
    history = result.history;

    turns.push({
      prompt,
      latencyMs,
      executions,
      finalOutput: typeof result.finalOutput === 'string' ? result.finalOutput : '',
      result,
    });
  }

  return turns;
}

const judgeSystemPrompt = `
  You grade whether an answer to a data question is correct, given a reference answer.
  The answer is correct if its key facts and figures match the reference (allowing for rounding and
  formatting such as "$739.8K" for 739,813.61). Extra detail is fine; missing or wrong figures are not.
  Reply with only a JSON object: {"correct": true or false, "reason": "one short sentence"}`;

const judgeResultSchema = z.object({ correct: z.boolean(), reason: z.string() });

async function judge(
  question: string,
  answer: string,
  reference: string,
): Promise<{ correct: boolean; reason: string }> {
  const judgeAgent = await getAgent({
    model: process.env.EVAL_JUDGE_MODEL || getModel(),
    systemPrompt: judgeSystemPrompt,
  });
  const result = await run(
    judgeAgent,
    `Question: ${question}\n\nReference answer: ${reference}\n\nAnswer to grade: ${answer}`,
  );
  const json = result.finalOutput?.match(/\{[\s\S]*\}/)?.[0];
  const parsed = json ? judgeResultSchema.safeParse(JSON.parse(json)) : undefined;
  if (!parsed?.success) {
    return { correct: false, reason: `judge output unparseable: ${result.finalOutput ?? ''}` };
  }
  return parsed.data;
}

/** Numeric check first; the LLM judge only runs when that fails and a reference exists. */
export async function gradeAnswer(
  question: string,
  answer: string,
  expected: ExpectedAnswer,
): Promise<{ correct: boolean; method: GradeMethod; detail: string }> {
  let numericDetail = '';
  if (expected.numbers?.length) {
    const { pass, missing } = checkNumbers(answer, expected);
    if (pass) {
      return { correct: true, method: 'numeric', detail: 'all expected numbers found' };
    }
    numericDetail = `missing ${missing.join(', ')}`;
    if (!expected.reference) {
      return { correct: false, method: 'numeric', detail: numericDetail };
    }
  }
  if (expected.reference) {
    const verdict = await judge(question, answer, expected.reference);
    const prefix = numericDetail ? `numeric check ${numericDetail}; judge: ` : 'judge: ';
    return { correct: verdict.correct, method: 'judge', detail: prefix + verdict.reason };
  }
  return { correct: false, method: 'none', detail: 'case has no expected answer' };
}

export function parseList(value: string | undefined): Array<string> | undefined {
  const items = value
    ?.split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return items?.length ? items : undefined;
}

const SUITES: Record<string, Array<AbCase>> = {
  data: DATA_QUESTION_CASES,
  gold: GOLD_DREAMFORCE_CASES,
};

/**
 * The case suite named by EVAL_SUITE: `data` (default; `tableauagent1`) or `gold` (Tableau Agent's
 * gold suite; `tabagent-tdp1-evals`). Each suite needs `tests/.env` pointed at its site.
 */
export function selectSuite(): Array<AbCase> {
  const name = process.env.EVAL_SUITE?.trim() || 'data';
  const cases = SUITES[name];
  if (!cases) {
    throw new Error(`Unknown EVAL_SUITE ${name}; use ${Object.keys(SUITES).join(' or ')}`);
  }
  return cases;
}
