import { Err, Ok } from 'ts-results-es';

import { makeExecutorMock } from '../externalApi/executor.mock.js';
import type { ExecuteCommandError } from '../externalApi/executorTypes.js';
import { stopPerformanceRecording } from './stopPerformanceRecording.js';

describe('stopPerformanceRecording', () => {
  it('delegates to the executor with the exact AbortSignal and preserves completed output', async () => {
    const signal = new AbortController().signal;
    const success = new Ok({
      command_id: 'op-stop',
      status: 'completed' as const,
      submitted_at: '2026-09-03T00:00:00Z',
      parsedResult: { filePath: 'C:/Temp/PerformanceRecording.twbx' },
    });
    const stop = vi.fn().mockResolvedValue(success);
    const executor = makeExecutorMock({ stopPerformanceRecording: stop });

    const result = await stopPerformanceRecording({ executor, signal });

    expect(stop).toHaveBeenCalledExactlyOnceWith(signal);
    expect(result).toBe(success);
  });

  it('preserves a nonterminal result without a filePath', async () => {
    const pending = new Ok({
      command_id: 'op-stop',
      status: 'running' as const,
      submitted_at: '2026-09-03T00:00:00Z',
    });
    const executor = makeExecutorMock({
      stopPerformanceRecording: vi.fn().mockResolvedValue(pending),
    });

    expect(await stopPerformanceRecording({ executor, signal: new AbortController().signal })).toBe(
      pending,
    );
  });

  it('preserves executor errors', async () => {
    const error: ExecuteCommandError = {
      type: 'command-failed',
      error: {
        code: 'performance-recording-not-active',
        message: 'Performance recording is not active.',
        recoverable: false,
      },
    };
    const failure = new Err(error);
    const executor = makeExecutorMock({
      stopPerformanceRecording: vi.fn().mockResolvedValue(failure),
    });

    expect(await stopPerformanceRecording({ executor, signal: new AbortController().signal })).toBe(
      failure,
    );
  });
});
