import { WithExecutorAndAbortSignal } from '../../toolExecutor/toolExecutor.js';
import { ListDashboardsResult, WorkbookReadGateway } from './workbookReadGateway.js';

export async function listDashboards(
  args: WithExecutorAndAbortSignal,
): Promise<ListDashboardsResult> {
  return await new WorkbookReadGateway(args).listDashboards();
}
