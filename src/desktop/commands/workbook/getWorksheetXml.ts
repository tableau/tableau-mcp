import { WithExecutorAndAbortSignal } from '../../toolExecutor/toolExecutor.js';
import {
  type GetWorksheetXmlError,
  GetWorksheetXmlResult,
  WorkbookReadGateway,
} from './workbookReadGateway.js';

export { isRouteMissing } from '../../externalApi/toolUtils.js';
export type { GetWorksheetXmlError };

export async function getWorksheetXml(
  args: { worksheetName: string } & WithExecutorAndAbortSignal,
): Promise<GetWorksheetXmlResult> {
  return await new WorkbookReadGateway(args).getWorksheetXml(args.worksheetName);
}
