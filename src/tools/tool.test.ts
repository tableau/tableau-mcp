import { Ok } from 'ts-results-es';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { log } from '../logging/log.js';
import { Server } from '../server.js';
import { Tool } from './tool.js';

describe('Tool', () => {
  const mockParams = {
    server: new Server(),
    name: 'list-fields',
    description: 'A test tool',
    paramsSchema: {
      param1: z.string(),
    },
    argsValidator: vi.fn(),
    annotations: {
      title: 'List Fields',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: vi.fn(),
  } as const;

  it('should create a tool instance with correct properties', () => {
    const tool = new Tool(mockParams);

    expect(tool.name).toBe(mockParams.name);
    expect(tool.description).toBe(mockParams.description);
    expect(tool.paramsSchema).toBe(mockParams.paramsSchema);
    expect(tool.callback).toBe(mockParams.callback);
  });

  it('should log invocation with provided args', () => {
    const spy = vi.spyOn(log, 'debug');

    const tool = new Tool(mockParams);
    const testArgs = { param1: 'test' };

    tool.logInvocation({ requestId: '2', args: testArgs });

    const server = expect.any(Object);
    expect(spy).toHaveBeenCalledExactlyOnceWith(server, {
      type: 'tool',
      requestId: '2',
      tool: {
        name: 'list-fields',
        args: testArgs,
      },
    });
  });

  it('should return successful result when callback succeeds', async () => {
    const tool = new Tool(mockParams);
    const successResult = { data: 'success' };
    const callback = vi
      .fn()
      .mockImplementation(async (_requestId: string) => new Ok(successResult));

    const spy = vi.spyOn(tool, 'logInvocation');
    const result = await tool.logAndExecute({
      requestId: '2',
      args: { param1: 'test' },
      callback,
    });

    expect(result.isError).toBe(false);
    expect(result.content[0].type).toBe('text');
    expect(JSON.parse(result.content[0].text as string)).toEqual(successResult);

    expect(spy).toHaveBeenCalledExactlyOnceWith({
      requestId: '2',
      args: {
        param1: 'test',
      },
    });
  });

  it('should return error result when callback throws', async () => {
    const tool = new Tool(mockParams);
    const errorMessage = 'Test error';
    const callback = vi.fn().mockImplementation(async (_requestId: string) => {
      throw new Error(errorMessage);
    });

    const result = await tool.logAndExecute({
      requestId: '2',
      args: { param1: 'test' },
      callback,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toBe('requestId: 2, error: Test error');
  });

  it('should call argsValidator with provided args', async () => {
    const tool = new Tool(mockParams);
    const args = { param1: 'test' };

    await tool.logAndExecute({
      requestId: '2',
      args,
      callback: vi.fn(),
    });

    expect(mockParams.argsValidator).toHaveBeenCalledWith(args);
  });

  it('should return error result when argsValidator throws', async () => {
    const tool = new Tool({
      server: new Server(),
      name: 'list-fields',
      description: 'test',
      paramsSchema: z.object({ param1: z.string() }).shape,
      annotations: { title: 'test', readOnlyHint: true, openWorldHint: false },
      argsValidator: (_) => {
        throw new Error('Test error');
      },
      callback: ({ param1 }) => {
        return {
          isError: false,
          content: [{ type: 'text', text: param1 }],
        };
      },
    });

    const result = await tool.logAndExecute({
      requestId: '2',
      args: { param1: 'test' },
      callback: () => Promise.resolve(Ok('test')),
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toBe('requestId: 2, error: Test error');
  });
});
