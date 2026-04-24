import { ZodiosError } from '@zodios/core';
import { AxiosError } from 'axios';
import { Ok } from 'ts-results-es';
import { z, ZodError } from 'zod';

import { DatasourceNotAllowedError, ZodiosValidationError } from '../errors/mcpToolError.js';
import { notifier } from '../logging/notification.js';
import { WebMcpServer } from '../server.web.js';
import invariant from '../utils/invariant.js';
import { Tool } from './tool.js';
import { getMockRequestHandlerExtra } from './toolContext.mock.js';

// Mock for product telemetry - tracks calls to send()
const mockTelemetrySend = vi.hoisted(() => vi.fn());
vi.mock('../telemetry/productTelemetry/telemetryForwarder.js', () => ({
  getProductTelemetry: vi.fn().mockReturnValue({
    send: mockTelemetrySend,
  }),
}));

// Mock for MonCloud telemetry - tracks calls to recordMetric()
const mockRecordMetric = vi.hoisted(() => vi.fn());
vi.mock('../telemetry/init.js', () => ({
  getTelemetryProvider: vi.fn().mockReturnValue({
    initialize: vi.fn(),
    recordMetric: mockRecordMetric,
    recordHistogram: vi.fn(),
  }),
}));

describe('Tool', () => {
  const mockExtra = getMockRequestHandlerExtra();

  const mockParams = {
    server: new WebMcpServer(),
    name: 'get-datasource-metadata',
    description: 'A test tool',
    paramsSchema: {
      param1: z.string(),
    },
    annotations: {
      title: 'Get Datasource Metadata',
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
    const spy = vi.spyOn(notifier, 'debug');

    const tool = new Tool(mockParams);
    const testArgs = { param1: 'test' };

    tool.logInvocation({ requestId: '2', args: testArgs, username: 'test-user' });

    const server = expect.any(Object);
    expect(spy).toHaveBeenCalledExactlyOnceWith(server, {
      type: 'tool',
      requestId: '2',
      username: 'test-user',
      tool: {
        name: 'get-datasource-metadata',
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
      extra: mockExtra,
      args: { param1: 'test' },
      callback,
      constrainSuccessResult: (result) => {
        return {
          type: 'success',
          result,
        };
      },
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text)).toEqual(successResult);

    expect(spy).toHaveBeenCalledExactlyOnceWith({
      requestId: 2,
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
      extra: mockExtra,
      args: { param1: 'test' },
      callback,
      constrainSuccessResult: (result) => {
        return {
          type: 'success',
          result,
        };
      },
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe('requestId: 2, error: Test error');
  });

  it('should constrain the success result', async () => {
    const tool = new Tool(mockParams);
    const successResult = { data: 'success' };

    const result = await tool.logAndExecute({
      extra: mockExtra,
      args: { param1: 'test' },
      callback: () => Promise.resolve(Ok(successResult)),
      constrainSuccessResult: (result) => {
        return {
          type: 'success',
          result: {
            ...result,
            additionalField: 'extra',
          },
        };
      },
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text)).toEqual({
      ...successResult,
      additionalField: 'extra',
    });
  });

  it('should return empty result when the constrained result is empty', async () => {
    const tool = new Tool(mockParams);
    const successResult = { data: 'success' };

    const result = await tool.logAndExecute({
      extra: mockExtra,
      args: { param1: 'test' },
      callback: () => Promise.resolve(Ok(successResult)),
      constrainSuccessResult: (_result) => {
        return {
          type: 'empty',
          message: 'No data found',
        };
      },
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe('No data found');
  });

  it('should return error result when the constrained result is error', async () => {
    const tool = new Tool(mockParams);
    const successResult = { data: 'success' };

    const result = await tool.logAndExecute({
      extra: mockExtra,
      args: { param1: 'test' },
      callback: () => Promise.resolve(Ok(successResult)),
      constrainSuccessResult: (_result) => {
        return {
          type: 'error',
          message: 'An error occurred',
        };
      },
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe('An error occurred');
  });

  describe('product telemetry', () => {
    beforeEach(() => {
      mockTelemetrySend.mockClear();
    });

    it('should send telemetry with success=true and empty error_code on success', async () => {
      const tool = new Tool(mockParams);

      await tool.logAndExecute({
        extra: mockExtra,
        args: { param1: 'test-value' },
        callback: () => Promise.resolve(Ok({ data: 'success' })),
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });

      expect(mockTelemetrySend).toHaveBeenCalledWith(
        'tool_call',
        expect.objectContaining({
          tool_name: 'get-datasource-metadata',
          request_id: '2',
          session_id: '',
          site_luid: 'test-site-luid',
          user_luid: 'test-user-luid',
          podname: 'https://my-tableau-server.com',
          is_hyperforce: false,
          success: true,
          error_code: '',
        }),
      );
    });

    it('should send telemetry with success=false on callback error', async () => {
      const tool = new Tool(mockParams);

      await tool.logAndExecute({
        extra: mockExtra,
        args: { param1: 'test-value' },
        callback: () => {
          throw new Error('Callback failed');
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });

      expect(mockTelemetrySend).toHaveBeenCalledWith(
        'tool_call',
        expect.objectContaining({
          is_hyperforce: false,
          success: false,
          error_code: '500',
        }),
      );
    });

    it('should send telemetry with actual HTTP status code on API error', async () => {
      const tool = new Tool(mockParams);
      const axiosError = new AxiosError('Unauthorized');
      axiosError.response = { status: 401 } as AxiosError['response'];

      await tool.logAndExecute({
        extra: mockExtra,
        args: { param1: 'test-value' },
        callback: () => {
          throw axiosError;
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });

      expect(mockTelemetrySend).toHaveBeenCalledWith(
        'tool_call',
        expect.objectContaining({
          is_hyperforce: false,
          success: false,
          error_code: '401',
        }),
      );
    });

    it('should send telemetry with success=false and empty error_code on constrained error', async () => {
      const tool = new Tool(mockParams);

      await tool.logAndExecute({
        extra: mockExtra,
        args: { param1: 'test-value' },
        callback: () => Promise.resolve(Ok({ data: 'success' })),
        constrainSuccessResult: () => ({ type: 'error', message: 'Constrained error' }),
      });

      expect(mockTelemetrySend).toHaveBeenCalledWith(
        'tool_call',
        expect.objectContaining({
          is_hyperforce: false,
          success: false,
          error_code: '',
        }),
      );
    });

    it('should send telemetry with success=true on constrained empty result', async () => {
      const tool = new Tool(mockParams);

      await tool.logAndExecute({
        extra: mockExtra,
        args: { param1: 'test-value' },
        callback: () => Promise.resolve(Ok({ data: 'success' })),
        constrainSuccessResult: () => ({ type: 'empty', message: 'No data' }),
      });

      expect(mockTelemetrySend).toHaveBeenCalledWith(
        'tool_call',
        expect.objectContaining({
          is_hyperforce: false,
          success: true,
          error_code: '',
        }),
      );
    });
  });

  describe('recordMetric telemetry', () => {
    beforeEach(() => {
      mockRecordMetric.mockClear();
    });

    it('should record no error on success', async () => {
      const tool = new Tool(mockParams);

      await tool.logAndExecute({
        extra: mockExtra,
        args: { param1: 'test-value' },
        callback: () => Promise.resolve(Ok({ data: 'success' })),
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });

      expect(mockRecordMetric).toHaveBeenCalledWith('mcp.tool.calls', 1, {
        tool_name: 'get-datasource-metadata',
        request_id: '2',
        error_code: '',
      });
    });

    it('should record tableau_api category when callback throws AxiosError', async () => {
      const tool = new Tool(mockParams);
      const axiosError = new AxiosError('Forbidden');
      axiosError.response = { status: 403 } as AxiosError['response'];

      await tool.logAndExecute({
        extra: mockExtra,
        args: { param1: 'test-value' },
        callback: () => {
          throw axiosError;
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });

      expect(mockRecordMetric).toHaveBeenCalledWith('mcp.tool.calls', 1, {
        tool_name: 'get-datasource-metadata',
        request_id: '2',
        error_code: '403',
      });
    });

    it('should record error_code of 500 when callback throws a plain Error with no HTTP status', async () => {
      const tool = new Tool(mockParams);

      await tool.logAndExecute({
        extra: mockExtra,
        args: { param1: 'test-value' },
        callback: () => {
          throw new Error('Something unexpected happened');
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });

      expect(mockRecordMetric).toHaveBeenCalledWith('mcp.tool.calls', 1, {
        tool_name: 'get-datasource-metadata',
        request_id: '2',
        error_code: '500',
      });
    });

    it('should record business_logic category when callback returns typed Err object', async () => {
      const tool = new Tool(mockParams);

      await tool.logAndExecute({
        extra: mockExtra,
        args: { param1: 'test-value' },
        callback: () => Promise.resolve(new DatasourceNotAllowedError('Not allowed').toErr()),
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });

      expect(mockRecordMetric).toHaveBeenCalledWith('mcp.tool.calls', 1, {
        tool_name: 'get-datasource-metadata',
        request_id: '2',
        error_code: '403',
      });
    });

    it('should record no error on empty constrained result', async () => {
      const tool = new Tool(mockParams);

      await tool.logAndExecute({
        extra: mockExtra,
        args: { param1: 'test-value' },
        callback: () => Promise.resolve(Ok({ data: 'success' })),
        constrainSuccessResult: () => ({ type: 'empty', message: 'No data' }),
      });

      expect(mockRecordMetric).toHaveBeenCalledWith('mcp.tool.calls', 1, {
        tool_name: 'get-datasource-metadata',
        request_id: '2',
        error_code: '',
      });
    });
  });

  describe('ZodiosError handling', () => {
    it('should return isError: false with data and validation warning for ZodiosError with valid ZodError cause', async () => {
      const tool = new Tool(mockParams);
      const rawApiData = { fields: [], parameters: [{ unexpected: 'data' }] };
      const zodError = new ZodError([
        {
          code: 'invalid_type',
          expected: 'string',
          received: 'object',
          path: ['parameters', 0, 'members', 0],
          message: 'Expected string, received object',
        },
      ]);

      const zodiosError = new ZodiosError(
        'Zodios: Invalid Response',
        undefined,
        rawApiData,
        zodError,
      );

      const result = await tool.logAndExecute({
        extra: mockExtra,
        args: { param1: 'test' },
        callback: () => Promise.resolve(new ZodiosValidationError(zodiosError).toErr()),
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });

      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.data).toEqual(rawApiData.toString());
      expect(parsed.warning).toContain('Expected string, received object');
    });

    it('should return isError: false with validation warning for discriminatedUnion schema errors', async () => {
      const tool = new Tool(mockParams);
      const rawApiData = {
        parameters: [{ parameterType: 'LIST', members: [{ value: '5', alias: 'Top 5' }] }],
      };

      const schema = z.discriminatedUnion('parameterType', [
        z.object({ parameterType: z.literal('LIST'), members: z.array(z.string()) }).strict(),
        z.object({ parameterType: z.literal('RANGE'), min: z.number(), max: z.number() }).strict(),
      ]);

      const parseResult = schema.safeParse(rawApiData.parameters[0]);
      expect(parseResult.success).toBe(false);
      if (parseResult.success) return;

      const zodiosError = new ZodiosError(
        'Zodios: Invalid Response',
        undefined,
        rawApiData,
        parseResult.error,
      );

      const result = await tool.logAndExecute({
        extra: mockExtra,
        args: { param1: 'test' },
        callback: () => Promise.resolve(new ZodiosValidationError(zodiosError).toErr()),
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });

      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.data).toEqual(rawApiData.toString());
      expect(parsed.warning).toContain('Validation error');
    });
  });
});
