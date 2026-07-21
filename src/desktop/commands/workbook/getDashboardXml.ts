import { WithExecutorAndAbortSignal } from '../../toolExecutor/toolExecutor.js';
import {
  type GetDashboardXmlError,
  GetDashboardXmlResult,
  WorkbookReadGateway,
} from './workbookReadGateway.js';

export { isRouteMissing } from '../../externalApi/toolUtils.js';
export type { GetDashboardXmlError };

export async function getDashboardXml(
  args: { dashboardName: string } & WithExecutorAndAbortSignal,
): Promise<GetDashboardXmlResult> {
  return await new WorkbookReadGateway(args).getDashboardXml(args.dashboardName);
}
