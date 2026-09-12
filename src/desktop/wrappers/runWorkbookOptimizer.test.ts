import { Err, Ok } from 'ts-results-es';

import { makeExecutorMock } from '../externalApi/executor.mock.js';
import { ExecuteCommandError } from '../externalApi/executorTypes.js';
import { runWorkbookOptimizer } from './runWorkbookOptimizer.js';

describe('runWorkbookOptimizer', () => {
  it('delegates the same signal to the first-class executor method without using a hidden command', async () => {
    const signal = new AbortController().signal;
    const result = Ok({
      suggestions: [
        {
          ruleId: 1,
          title: 'Rule',
          description: 'Description',
          status: 'PASS' as const,
          affected: { count: 0, items: [] },
        },
      ],
    });
    const executor = makeExecutorMock({
      runWorkbookOptimizer: vi.fn().mockResolvedValue(result),
      executeCommand: vi.fn(),
    });

    const actual = await runWorkbookOptimizer({ executor, signal });

    expect(actual).toBe(result);
    expect(executor.runWorkbookOptimizer).toHaveBeenCalledWith(signal);
    expect(executor.executeCommand).not.toHaveBeenCalled();
  });

  it('passes executor errors through unchanged', async () => {
    const signal = new AbortController().signal;
    const error: ExecuteCommandError = {
      type: 'command-failed',
      error: {
        code: 'not-found',
        message: 'No route matches the request path.',
        recoverable: false,
      },
    };
    const result = Err(error);
    const executor = makeExecutorMock({ runWorkbookOptimizer: vi.fn().mockResolvedValue(result) });

    const actual = await runWorkbookOptimizer({ executor, signal });

    expect(actual).toBe(result);
  });
});
