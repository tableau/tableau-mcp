import { WithExecutorAndAbortSignal } from '../../toolExecutor/toolExecutor.js';
import { ListWorksheetsResult, WorkbookReadGateway } from './workbookReadGateway.js';

export async function listWorksheets(
  args: WithExecutorAndAbortSignal,
): Promise<ListWorksheetsResult> {
  return await new WorkbookReadGateway(args).listWorksheets();
}
