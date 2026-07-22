import {
  buildMcpHandshakeInput,
  parseArgs,
  requireKnowledgeSearchHit,
  requireMinimumKnowledgeResources,
  requireToolName,
} from './seaSmoke.js';

describe('SEA smoke helper', () => {
  it('builds a minimal MCP initialize and tools/list handshake', () => {
    const input = buildMcpHandshakeInput();

    expect(input).toContain('"method":"initialize"');
    expect(input).toContain('"method":"tools/list"');
    expect(input.trim().split('\n')).toHaveLength(2);
  });

  it('adds resource-count and real-search probes when requested', () => {
    const input = buildMcpHandshakeInput({
      minKnowledgeResources: 100,
      knowledgeSearchQuery: 'pie chart of countries',
    });

    expect(input).toContain('"method":"resources/list"');
    expect(input).toContain('"method":"tools/call"');
    expect(input).toContain('"name":"search-knowledge"');
    expect(input).toContain('"query":"pie chart of countries"');
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

  it('parses knowledge corpus and search smoke options', () => {
    expect(
      parseArgs([
        'node',
        'seaSmoke.ts',
        './tableau-mcp-desktop',
        '--require-tool',
        'search-knowledge',
        '--min-knowledge-resources',
        '100',
        '--search-knowledge',
        'pie chart of countries',
      ]),
    ).toEqual({
      binaryPath: './tableau-mcp-desktop',
      requiredTool: 'search-knowledge',
      minKnowledgeResources: 100,
      knowledgeSearchQuery: 'pie chart of countries',
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

  it('requires at least the requested number of knowledge resources', () => {
    const output = [
      JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        result: {
          resources: Array.from({ length: 100 }, (_, index) => ({
            uri: `expertise://tableau/${index}`,
          })),
        },
      }),
    ];

    expect(() => requireMinimumKnowledgeResources(output, 100)).not.toThrow();
    expect(() => requireMinimumKnowledgeResources(output, 101)).toThrow(
      'Expected at least 101 knowledge resources, got 100',
    );
  });

  it('requires a successful real knowledge search hit', () => {
    const output = [
      JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        result: {
          isError: false,
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                hits: [
                  {
                    uri: 'expertise://tableau/strategy/viz-design/chart-selection',
                    mustReadUri: 'expertise://tableau/strategy/viz-design/chart-selection',
                  },
                ],
              }),
            },
          ],
        },
      }),
    ];

    expect(() => requireKnowledgeSearchHit(output)).not.toThrow();
  });
});
