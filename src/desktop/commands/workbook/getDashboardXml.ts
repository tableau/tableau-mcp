import { Err, Ok } from 'ts-results-es';

import { dashboardDocumentToFragment } from '../../metadata/dashboards.js';
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

/**
 * Like {@link getDashboardXml}, but always resolves to a single `<dashboard>` fragment. The
 * External Client API per-dashboard `/document` route returns a whole `<workbook>` scoped to the
 * dashboard; callers that feed the XML to apply-dashboard need the fragment. The other transports
 * already return a fragment, so this is a no-op slice for them.
 */
export async function getDashboardFragment(
  args: { dashboardName: string } & WithExecutorAndAbortSignal,
): Promise<GetDashboardXmlResult> {
  const result = await getDashboardXml(args);
  if (result.isErr()) {
    return result;
  }

  const fragment = dashboardDocumentToFragment(result.value, args.dashboardName);
  if (fragment === null) {
    return Err({
      type: 'get-dashboard-xml-error',
      error: {
        type: 'no-dashboard-found',
        message: `No dashboard found for "${args.dashboardName}".`,
      },
    });
  }

  return Ok(fragment);
}
