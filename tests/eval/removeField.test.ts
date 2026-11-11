import { MCPServerStdio, run, setTracingDisabled, withTrace } from '@openai/agents';
import dotenv from 'dotenv';

import { getDesktopMcpServer, getModel, log } from './base.js';
import {
  getRemoveFieldEvalAgent,
  removeFieldCases,
  RemoveFieldScenario,
} from './removeFieldScenario.js';

dotenv.config({ path: 'tests/eval/.env' });

// W-24252809: real schemas and diagnostics, with all Desktop execution in memory.
describe('remove-field stale placement recovery (eval)', () => {
  let mcpServer: MCPServerStdio;

  beforeAll(async () => {
    // Gateway authentication is for model requests only; don't export traces to another service.
    setTracingDisabled(true);
    mcpServer = await getDesktopMcpServer();
    vi.spyOn(mcpServer, 'callTool').mockRejectedValue(
      new Error('Live Desktop execution is forbidden in this fixture eval'),
    );
  });

  afterAll(async () => {
    await mcpServer?.close();
    vi.restoreAllMocks();
    setTracingDisabled(false);
  });

  it.each(removeFieldCases)('$name', async (testCase) => {
    const scenario = new RemoveFieldScenario(testCase);
    const agent = await getRemoveFieldEvalAgent(mcpServer, getModel(), scenario);
    agent.on('agent_tool_start', (_context, _tool, { toolCall }) => {
      if (toolCall.type === 'function_call') {
        log(JSON.stringify({ case: testCase.name, callId: toolCall.callId, name: toolCall.name }));
      }
    });
    const result = await withTrace('remove_field_recovery_eval', () =>
      run(agent, scenario.prompt, { maxTurns: 8 }),
    );
    log(
      JSON.stringify(
        {
          model: getModel(),
          case: testCase.name,
          modelTurns: result.rawResponses.map((response, index) => ({
            turn: index + 1,
            calls: response.output
              .filter((item) => item.type === 'function_call')
              .map(({ callId, name, arguments: args }) => ({ callId, name, arguments: args })),
          })),
          calls: scenario.calls,
          finalOutput: result.finalOutput,
        },
        null,
        2,
      ),
    );
    expect(mcpServer.callTool).not.toHaveBeenCalled();
    expect(scenario.grade(), JSON.stringify(scenario.calls, null, 2)).toEqual([]);
  });
});
