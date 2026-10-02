import { MCPServerStdio, run, StreamedRunResult, withTrace } from '@openai/agents';
import dotenv from 'dotenv';

import invariant from '../../src/utils/invariant.js';
import { getAgent, getDesktopMcpServer, getModel, getToolExecutions } from './base.js';

dotenv.config({ path: 'tests/eval/.env' });

/**
 * Description-quality eval for the desktop author-action tool's parameter-mode
 * `onClear` field.
 *
 * Like flows.test.ts, this asserts ONLY on tool selection and the arguments the
 * model generates — not on returned data. The agent uses the real tool schemas
 * with inert execution callbacks, so no tool call can modify an open workbook.
 * The emitted arguments are still recorded in the run history for grading.
 *
 * The `onClear` enum ('keep-current' | 'set-value') is new: before it existed,
 * one optional `clearValue` field could not distinguish "reset the parameter to
 * empty on clear" from "keep its current value on clear". These evals confirm
 * the enum plus its describe steer the model to the right token for each intent.
 * On a build without `onClear` in the schema the model cannot emit it, so both
 * assertions fail deterministically — the A/B uplift this eval is meant to show.
 *
 * Local-only: requires OPENAI_API_KEY (tests/eval/.env) and a desktop build
 * (`npm run build:desktop`). No Tableau Server/site env is needed.
 */
const agentSystemPrompt = `
  You are an assistant responsible for evaluating the results of calling various tools.
  Given the user's query, use the tools available to you to answer the question.`;

async function runAgentWithTools(
  mcpServer: MCPServerStdio,
  model: string,
  prompt: string,
): Promise<StreamedRunResult<any, any>> {
  const agent = await getAgent({
    mcpServer,
    model,
    systemPrompt: agentSystemPrompt,
    toolAllowList: ['author_action'],
    stubToolExecution: true,
  });

  return await withTrace('run_author_action_eval_agent', async () => {
    const stream = await run(agent, prompt, { stream: true });
    if (process.env.ENABLE_LOGGING === 'true') {
      stream.toTextStream({ compatibleWithNodeStreams: true }).pipe(process.stdout);
    }

    await stream.completed;
    return stream;
  });
}

describe('author-action onClear (eval)', () => {
  let mcpServer: MCPServerStdio;

  beforeEach(async () => {
    mcpServer = await getDesktopMcpServer();
  });

  afterEach(async () => {
    await mcpServer?.close();
  });

  it('keep-current: derives onClear=keep-current when the parameter must keep its value on clear', async () => {
    const prompt =
      'In the open Tableau Desktop workbook, wire a parameter action so that clicking a mark on ' +
      "the 'Sales by Product' sheet sets the parameter [Parameters].[Parameter 1] from the field " +
      '[Sales]. When the selection is cleared, the parameter must KEEP its current value — do not ' +
      'reset it to anything. Configure this parameter action now.';

    const stream = await runAgentWithTools(mcpServer, getModel(), prompt);
    const toolExecutions = await getToolExecutions(stream);

    const authorAction = toolExecutions.find(
      (toolExecution) =>
        toolExecution.name === 'author_action' && toolExecution.arguments.mode === 'parameter',
    );
    invariant(authorAction, 'author_action parameter-mode tool execution not found');

    // "keep its current value on clear" is Desktop's do-nothing radio. Before the onClear enum
    // existed the model had no argument to express this and could only omit clearValue, so this
    // assertion fails on a build without the field.
    expect(authorAction.arguments.onClear).toBe('keep-current');
  });

  it('set-value empty: derives onClear=set-value with an empty clearValue for an empty-string reset', async () => {
    const prompt =
      'In the open Tableau Desktop workbook, wire a parameter action so that clicking a mark on ' +
      "the 'Sales by Product' sheet sets the string parameter [Parameters].[Parameter 1] from the " +
      'field [Category]. When the selection is cleared, RESET the parameter to an empty string ' +
      "(''). Configure this parameter action now.";

    const stream = await runAgentWithTools(mcpServer, getModel(), prompt);
    const toolExecutions = await getToolExecutions(stream);

    const authorAction = toolExecutions.find(
      (toolExecution) =>
        toolExecution.name === 'author_action' && toolExecution.arguments.mode === 'parameter',
    );
    invariant(authorAction, 'author_action parameter-mode tool execution not found');

    // Resetting a string to empty on clear is the set-value radio with an empty clearValue — the
    // exact case one optional clearValue field could not distinguish from keep-current (both
    // arrive as ""). Only onClear='set-value' expresses it, so this fails without the enum.
    expect(authorAction.arguments.onClear).toBe('set-value');
    expect(authorAction.arguments).toHaveProperty('clearValue');
    expect(authorAction.arguments.clearValue).toBe('');
  });
});
