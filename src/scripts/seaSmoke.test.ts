import { buildMcpHandshakeInput, parseArgs, requireToolName } from './seaSmoke.js';

describe('SEA smoke helper', () => {
  it('builds a minimal MCP initialize and tools/list handshake', () => {
    const input = buildMcpHandshakeInput();

    expect(input).toContain('"method":"initialize"');
    expect(input).toContain('"method":"tools/list"');
    expect(input.trim().split('\n')).toHaveLength(2);
  });

  it('parses a binary path and required tool name', () => {
    expect(
      parseArgs([
        'node',
        'seaSmoke.ts',
        './tableau-mcp-desktop',
        '--require-tool',
        'bind-template',
      ]),
    ).toEqual({
      binaryPath: './tableau-mcp-desktop',
      requiredTool: 'bind-template',
    });
  });

  it('requires a requested tool to be present in the tools/list response', () => {
    expect(() =>
      requireToolName(
        [
          JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            result: {
              tools: [{ name: 'bind-template' }],
            },
          }),
        ],
        'bind-template',
      ),
    ).not.toThrow();
  });

  it('fails when the requested tool is missing from the tools/list response', () => {
    expect(() =>
      requireToolName(
        [
          JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            result: {
              tools: [{ name: 'list-instances' }],
            },
          }),
        ],
        'bind-template',
      ),
    ).toThrow("Required tool 'bind-template' was not returned by tools/list");
  });
});
