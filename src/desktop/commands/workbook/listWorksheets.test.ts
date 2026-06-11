import { Err, Ok } from 'ts-results-es';

import { LocalExecutor } from '../../toolExecutor/localToolExecutor.js';
import { listWorksheets } from './listWorksheets.js';

vi.mock('../../toolExecutor/localToolExecutor.js');

describe('listWorksheets', () => {
  const mockSignal = new AbortController().signal;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should successfully return list of worksheets', async () => {
    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(
        Ok({
          command_id: 'cmd-123',
          status: 'completed',
          parsedResult: {
            worksheets: JSON.stringify({
              count: 3,
              worksheets: [{ name: 'Sheet 1' }, { name: 'Sales' }, { name: 'Analysis' }],
            }),
          },
        }),
      ),
    } as unknown as LocalExecutor;

    const result = await listWorksheets({ executor: mockExecutor, signal: mockSignal });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({
        count: 3,
        worksheets: ['Sheet 1', 'Sales', 'Analysis'],
      });
    }

    expect(mockExecutor.executeCommand).toHaveBeenCalledWith({
      namespace: 'tabui',
      command: 'list-worksheets',
      schema: expect.any(Object),
      signal: mockSignal,
    });
  });

  it('should return empty list when no worksheets exist', async () => {
    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(
        Ok({
          command_id: 'cmd-123',
          status: 'completed',
          parsedResult: {
            worksheets: JSON.stringify({
              count: 0,
              worksheets: [],
            }),
          },
        }),
      ),
    } as unknown as LocalExecutor;

    const result = await listWorksheets({ executor: mockExecutor, signal: mockSignal });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({
        count: 0,
        worksheets: [],
      });
    }
  });

  it('should return error when executeCommand fails', async () => {
    const error = { type: 'command-failed' as const, error: { code: 'ERROR', message: 'Failed' } };
    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(Err(error)),
    } as unknown as LocalExecutor;

    const result = await listWorksheets({ executor: mockExecutor, signal: mockSignal });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toEqual(error);
    }
  });

  it('should return error when JSON parsing fails', async () => {
    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(
        Ok({
          command_id: 'cmd-123',
          status: 'completed',
          parsedResult: {
            worksheets: 'invalid json {',
          },
        }),
      ),
    } as unknown as LocalExecutor;

    const result = await listWorksheets({ executor: mockExecutor, signal: mockSignal });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe('invalid-response');
    }
  });

  it('should return error when schema validation fails', async () => {
    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(
        Ok({
          command_id: 'cmd-123',
          status: 'completed',
          parsedResult: {
            worksheets: JSON.stringify({
              // Missing required fields
              invalid: 'data',
            }),
          },
        }),
      ),
    } as unknown as LocalExecutor;

    const result = await listWorksheets({ executor: mockExecutor, signal: mockSignal });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe('invalid-response');
    }
  });

  it('should handle empty worksheets string', async () => {
    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(
        Ok({
          command_id: 'cmd-123',
          status: 'completed',
          parsedResult: {
            worksheets: '',
          },
        }),
      ),
    } as unknown as LocalExecutor;

    const result = await listWorksheets({ executor: mockExecutor, signal: mockSignal });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe('invalid-response');
    }
  });
});
