import { Ok } from 'ts-results-es';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { log } from '../logging/log.js';
import { server } from '../server.js';
import { Tool } from './tool.js';

// Mock server.server.sendLoggingMessage since the transport won't be connected.
vi.spyOn(server.server, 'sendLoggingMessage').mockImplementation(vi.fn());

vi.mock('node:crypto', () => {
  return { randomUUID: vi.fn(() => '123e4567-e89b-12d3-a456-426614174000') };
});

describe('Tool', () => {
  const mockParams = {
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

    tool.logInvocation(testArgs);

    expect(spy).toHaveBeenCalledExactlyOnceWith({
      type: 'tool',
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
      args: { param1: 'test' },
      callback,
    });

    expect(result.isError).toBe(false);
    expect(result.content[0].type).toBe('text');
    expect(JSON.parse(result.content[0].text as string)).toEqual(successResult);

    expect(spy).toHaveBeenCalledExactlyOnceWith({ param1: 'test' });
  });

  it('should return error result when callback throws', async () => {
    const tool = new Tool(mockParams);
    const errorMessage = 'Test error';
    const callback = vi.fn().mockImplementation(async (_requestId: string) => {
      throw new Error(errorMessage);
    });

    const result = await tool.logAndExecute({
      args: { param1: 'test' },
      callback,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toBe(
      'requestId: 123e4567-e89b-12d3-a456-426614174000, error: Test error',
    );
  });

  it('should call argsValidator with provided args', () => {
    const tool = new Tool(mockParams);
    const args = { param1: 'test' };

    tool.logAndExecute({ args, callback: vi.fn() });

    expect(mockParams.argsValidator).toHaveBeenCalledWith(args);
  });
});
