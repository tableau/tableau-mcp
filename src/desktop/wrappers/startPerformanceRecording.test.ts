import { Err, Ok } from 'ts-results-es';

import { makeExecutorMock } from '../externalApi/executor.mock.js';
import type { ExecuteCommandError } from '../externalApi/executorTypes.js';
import { startPerformanceRecording } from './startPerformanceRecording.js';

describe('startPerformanceRecording', () => {
  it('delegates to the executor with the exact AbortSignal and preserves success', async () => {
    const signal = new AbortController().signal;
    const success = new Ok({
      command_id: 'op-start',
      status: 'completed' as const,
      submitted_at: '2026-09-03T00:00:00Z',
    });
    const start = vi.fn().mockResolvedValue(success);
    const executor = makeExecutorMock({ startPerformanceRecording: start });

    const result = await startPerformanceRecording({ executor, signal });

    expect(start).toHaveBeenCalledExactlyOnceWith(signal);
    expect(result).toBe(success);
  });

  it('preserves executor errors', async () => {
    const signal = new AbortController().signal;
    const error: ExecuteCommandError = {
      type: 'command-failed',
      error: {
        code: 'performance-recording-disabled',
        message: 'Performance recording is disabled.',
        recoverable: false,
      },
    };
    const failure = new Err(error);
    const executor = makeExecutorMock({
      startPerformanceRecording: vi.fn().mockResolvedValue(failure),
    });

    expect(await startPerformanceRecording({ executor, signal })).toBe(failure);
  });
});
