import { Result } from 'ts-results-es';

import { ExecuteCommandError, WithExecutorAndAbortSignal } from '../externalApi/executorTypes.js';
import { WorkbookOptimizerResult } from '../externalApi/types.js';

/** Evaluates the open workbook with Desktop's Workbook Optimizer endpoint. */
export async function runWorkbookOptimizer({
  executor,
  signal,
}: WithExecutorAndAbortSignal): Promise<Result<WorkbookOptimizerResult, ExecuteCommandError>> {
  return await executor.runWorkbookOptimizer(signal);
}
