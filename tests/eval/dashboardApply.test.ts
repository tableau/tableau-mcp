import { MCPServerStdio, run, setTracingDisabled, withTrace } from '@openai/agents';
import dotenv from 'dotenv';

import { getDesktopMcpServer, getModel, log } from './base.js';
import {
  dashboardApplyCases,
  DashboardApplyScenario,
  getDashboardApplyEvalAgent,
} from './dashboardApplyScenario.js';

dotenv.config({ path: 'tests/eval/.env' });

describe('dashboard apply and recovery W-24366364 (eval)', () => {
  let mcpServer: MCPServerStdio;

  beforeAll(async () => {
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

  it.each(dashboardApplyCases)(
    '$name',
    async (testCase) => {
      const scenario = new DashboardApplyScenario(testCase);
      const prompt = await scenario.getPrompt();
      const agent = await getDashboardApplyEvalAgent(mcpServer, getModel(), scenario);
      agent.on('agent_tool_start', (_context, _tool, { toolCall }) => {
        if (toolCall.type === 'function_call') {
          log(
            JSON.stringify({ case: testCase.name, callId: toolCall.callId, name: toolCall.name }),
          );
        }
      });
      const result = await withTrace('dashboard_apply_eval', () =>
        run(agent, prompt, { maxTurns: 10, signal: AbortSignal.timeout(110_000) }),
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
            writes: scenario.writes.map(({ route }) => route),
            finalOutput: result.finalOutput,
          },
          null,
          2,
        ),
      );
      expect(mcpServer.callTool).not.toHaveBeenCalled();
      expect(scenario.grade(), JSON.stringify(scenario.calls, null, 2)).toEqual([]);
    },
    120_000,
  );
});
