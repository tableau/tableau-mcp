import type { Result } from 'ts-results-es';

import type {
  ExecuteCommandError,
  ExecuteCommandResult,
  WithExecutorAndAbortSignal,
} from '../externalApi/executorTypes.js';

export async function startPerformanceRecording({
  executor,
  signal,
}: WithExecutorAndAbortSignal): Promise<
  Result<ExecuteCommandResult<undefined>, ExecuteCommandError>
> {
  return await executor.startPerformanceRecording(signal);
}
