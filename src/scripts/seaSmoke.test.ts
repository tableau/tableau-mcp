import { EventEmitter } from 'events';
import { PassThrough, Writable } from 'stream';

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('child_process', () => ({ spawn: spawnMock }));

import { buildMcpHandshakeInput, parseArgs, requireToolName, runSeaSmoke } from './seaSmoke.js';

describe('SEA smoke helper', () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it('builds a minimal MCP initialize and tools/list handshake', () => {
    const input = buildMcpHandshakeInput();

    expect(input).toContain('"method":"initialize"');
    expect(input).toContain('"method":"tools/list"');
    expect(input).toContain('"method":"notifications/initialized"');
    expect(input.trim().split('\n')).toHaveLength(3);
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
      requiredTool: 'bind-template',
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
        result: { tools: [{ name: 'bind-template' }] },
      })}\n`,
    );
    child.emit('close', 0, null);

    await expect(smoke).resolves.toBeUndefined();
  });
});
