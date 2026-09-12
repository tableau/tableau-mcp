import type { Result } from 'ts-results-es';

import type {
  ExecuteCommandError,
  WithExecutorAndAbortSignal,
} from '../externalApi/executorTypes.js';
import type { StopPerformanceRecordingResult } from '../externalApi/externalApiToolExecutor.js';

export async function stopPerformanceRecording({
  executor,
  signal,
}: WithExecutorAndAbortSignal): Promise<
  Result<StopPerformanceRecordingResult, ExecuteCommandError>
> {
  return await executor.stopPerformanceRecording(signal);
}
