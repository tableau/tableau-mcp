import { EventEmitter } from 'events';
import { PassThrough, Writable } from 'stream';

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('child_process', () => ({ spawn: spawnMock }));

import {
  buildMcpHandshakeInput,
  parseArgs,
  requireKnowledgeSearchHit,
  requireMinimumKnowledgeResources,
  requireToolName,
  runSeaSmoke,
} from './seaSmoke.js';

describe('SEA smoke helper', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('builds a minimal MCP initialize and tools/list handshake', () => {
    const input = buildMcpHandshakeInput();

    expect(input).toContain('"method":"initialize"');
    expect(input).toContain('"method":"tools/list"');
    expect(input).toContain('"method":"notifications/initialized"');
    expect(input.trim().split('\n')).toHaveLength(3);
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

  it('sends each request only after the previous response arrives', async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: Writable;
      stdout: PassThrough;
      stderr: PassThrough;
      kill: ReturnType<typeof vi.fn>;
    };
    const writes: string[] = [];
    child.stdin = new Writable({
      write(chunk, _encoding, callback) {
        writes.push(String(chunk));
        callback();
      },
    });
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn();
    spawnMock.mockReturnValue(child);

    const writtenMethods = (): string[] =>
      writes
        .join('')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .map((message) => message.method);
    const flush = async (): Promise<void> => {
      await new Promise((resolve) => setImmediate(resolve));
    };

    const smoke = runSeaSmoke({
      binaryPath: './tableau-mcp-desktop',
      requiredTool: 'search-knowledge',
      minKnowledgeResources: 1,
      knowledgeSearchQuery: 'pie chart of countries',
      timeoutMs: 1_000,
    });
    await flush();

    expect(writtenMethods()).toEqual(['initialize']);

    child.stdout.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18' } })}\n`,
    );
    await flush();
    expect(writtenMethods()).toEqual(['initialize', 'notifications/initialized', 'tools/list']);

    child.stdout.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        result: { tools: [{ name: 'search-knowledge' }] },
      })}\n`,
    );
    await flush();
    expect(writtenMethods()).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/list',
      'resources/list',
    ]);

    child.stdout.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        result: { resources: [{ uri: 'expertise://tableau/strategy/viz-design/chart-selection' }] },
      })}\n`,
    );
    await flush();
    expect(writtenMethods()).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/list',
      'resources/list',
      'tools/call',
    ]);

    child.stdout.write(
      `${JSON.stringify({
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
      })}\n`,
    );
    child.emit('close', 0, null);

    await expect(smoke).resolves.toBeUndefined();
  });

  it('rejects the pending exchange immediately on timeout without waiting for close', async () => {
    vi.useFakeTimers();
    const child = new EventEmitter() as EventEmitter & {
      stdin: Writable;
      stdout: PassThrough;
      stderr: PassThrough;
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdin = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn();
    spawnMock.mockReturnValue(child);

    const smoke = runSeaSmoke({
      binaryPath: './tableau-mcp-desktop',
      timeoutMs: 5,
    });
    const rejection = vi.fn();
    smoke.catch(rejection);

    try {
      await vi.advanceTimersByTimeAsync(5);
      await Promise.resolve();

      expect(rejection).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'SEA smoke timed out after 5ms. stderr: ',
        }),
      );
      expect(child.kill).toHaveBeenCalledTimes(1);
    } finally {
      child.emit('close', null, 'SIGTERM');
      await smoke.catch(() => undefined);
    }
  });

  it('rejects the pending exchange on spawn error without orphaning closePromise', async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: Writable;
      stdout: PassThrough;
      stderr: PassThrough;
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdin = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn();
    spawnMock.mockReturnValue(child);

    const smoke = runSeaSmoke({
      binaryPath: './tableau-mcp-desktop',
      timeoutMs: 1_000,
    });
    const spawnError = new Error('spawn failed');

    child.emit('error', spawnError);

    await expect(smoke).rejects.toBe(spawnError);
    expect(child.kill).toHaveBeenCalledTimes(1);
  });
});
