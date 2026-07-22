import { Err, Ok } from 'ts-results-es';

import { worksheetDocumentToFragment } from '../../metadata/sheets.js';
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

/**
 * Like {@link getWorksheetXml}, but always resolves to a single `<worksheet>` fragment. The
 * External Client API per-sheet `/document` route returns a whole `<workbook>` scoped to the
 * sheet; callers that feed the XML to apply-worksheet or a readback verifier need the fragment.
 * The other transports already return a fragment, so this is a no-op slice for them.
 */
export async function getWorksheetFragment(
  args: { worksheetName: string } & WithExecutorAndAbortSignal,
): Promise<GetWorksheetXmlResult> {
  const result = await getWorksheetXml(args);
  if (result.isErr()) {
    return result;
  }

  const fragment = worksheetDocumentToFragment(result.value, args.worksheetName);
  if (fragment === null) {
    return Err({
      type: 'get-worksheet-xml-error',
      error: {
        type: 'no-worksheet-found',
        message: `No worksheet found for ${args.worksheetName}.`,
      },
    });
  }

  return Ok(fragment);
}
