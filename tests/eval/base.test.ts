import { MCPServerStdio, RunContext, setTracingDisabled, withTrace } from '@openai/agents';

import invariant from '../../src/utils/invariant.js';
import { getAgent } from './base.js';

const inputSchema = {
  type: 'object' as const,
  properties: {
    onClear: { type: 'string', enum: ['keep-current', 'set-value'] },
    clearValue: { type: 'string' },
  },
  required: [],
  additionalProperties: true,
};

function mockMcpServer(): MCPServerStdio {
  // This server is never connected. Tool discovery and execution are both mocked.
  const server = new MCPServerStdio({ command: 'unused' });
  vi.spyOn(server, 'listTools').mockResolvedValue([
    { name: 'author-action', description: 'Author an action', inputSchema },
    { name: 'other-tool', description: 'Another tool', inputSchema },
  ]);
  vi.spyOn(server, 'callTool').mockResolvedValue([{ type: 'text', text: 'Live tool result' }]);
  return server;
}

describe('getAgent tool execution', () => {
  // Exercise the SDK's trace context without exporting traces from these offline tests.
  beforeAll(() => setTracingDisabled(true));
  afterAll(() => setTracingDisabled(false));

  beforeEach(() => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('preserves the allowed tool schema but never calls the server when execution is stubbed', async () => {
    const server = mockMcpServer();
    const options = {
      systemPrompt: 'Grade arguments only',
      model: 'test-model',
      mcpServer: server,
      toolAllowList: ['author_action'],
    };
    const liveAgent = await getAgent(options);
    const agent = await getAgent({ ...options, stubToolExecution: true });

    expect(agent.tools.map((tool) => tool.name)).toEqual(['author_action']);
    expect(agent.mcpServers).toEqual([]);
    const tool = agent.tools[0];
    const liveTool = liveAgent.tools[0];
    invariant(tool.type === 'function');
    invariant(liveTool.type === 'function');
    expect(tool.description).toBe('Author an action');
    expect(tool.parameters.properties).toEqual(inputSchema.properties);
    expect(tool.parameters).toEqual(liveTool.parameters);
    expect(tool.strict).toBe(liveTool.strict);
    await expect(
      withTrace('invoke stub', () =>
        tool.invoke(new RunContext(), JSON.stringify({ onClear: 'set-value', clearValue: '' })),
      ),
    ).resolves.toBe('Tool execution skipped for argument-only evaluation.');
    expect(server.callTool).not.toHaveBeenCalled();
  });

  it('stubs every tool without registering a live server when no allow-list is supplied', async () => {
    const server = mockMcpServer();
    const agent = await getAgent({
      systemPrompt: 'Grade arguments only',
      model: 'test-model',
      mcpServer: server,
      stubToolExecution: true,
    });

    expect(agent.tools.map((tool) => tool.name)).toEqual(['author_action', 'other_tool']);
    expect(agent.mcpServers).toEqual([]);
    for (const tool of agent.tools) {
      invariant(tool.type === 'function');
      await withTrace('invoke stub', () => tool.invoke(new RunContext(), '{}'));
    }
    expect(server.callTool).not.toHaveBeenCalled();
  });

  it.each([{ toolAllowList: undefined }, { toolAllowList: ['author_action'] }])(
    'preserves live execution by default with toolAllowList=$toolAllowList',
    async ({ toolAllowList }) => {
      const server = mockMcpServer();
      const agent = await getAgent({
        systemPrompt: 'Use tools',
        model: 'test-model',
        mcpServer: server,
        toolAllowList,
      });

      expect(agent.tools.map((tool) => tool.name)).toEqual(
        toolAllowList ? ['author_action'] : ['tableau_author_action', 'tableau_other_tool'],
      );
      expect(agent.mcpServers).toEqual(toolAllowList ? [] : [server]);
      const tool = agent.tools[0];
      invariant(tool.type === 'function');
      await withTrace('invoke live mock', () => tool.invoke(new RunContext(), '{}'));
      expect(server.callTool).toHaveBeenCalledOnce();
    },
  );
});
