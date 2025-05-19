import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { log } from '../logging/log.js';
import { server } from '../server.js';
import { Tool } from './tool.js';

// Mock server.server.sendLoggingMessage since the transport won't be connected.
vi.spyOn(server.server, 'sendLoggingMessage').mockImplementation(vi.fn());

describe('Tool', () => {
  const mockParams = {
    name: 'list-fields',
    description: 'A test tool',
    paramsSchema: {
      param1: z.string(),
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
        name: 'test-tool',
        args: testArgs,
      },
    });
  });

  it('should return successful result when callback succeeds', async () => {
    const tool = new Tool(mockParams);
    const successResult = { data: 'success' };
    const callback = vi.fn().mockImplementation(async (_requestId: string) => successResult);

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
    expect(result.content[0].text).toBe(errorMessage);
  });
});
