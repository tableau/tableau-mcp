import { Err, Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { getDesktopConfig } from '../../../config.desktop.js';
import { listSheets } from '../../metadata/sheets.js';
import {
  ExecuteCommandError,
  WithExecutorAndAbortSignal,
} from '../../toolExecutor/toolExecutor.js';
import { decodeXmlEntities } from '../../xmlElement.js';
import { getWorkbookXml } from './getWorkbookXml.js';

const worksheetNamesSchema = z.object({
  count: z.number(),
  worksheets: z.array(z.object({ name: z.string() })),
});

type ListWorksheetsResult = Result<
  {
    count: number;
    worksheets: Array<string>;
  },
  ExecuteCommandError
>;

export async function listWorksheets(
  args: WithExecutorAndAbortSignal,
): Promise<ListWorksheetsResult> {
  // External Client API ("Athena V0") exposes no per-sheet route — tabui:list-worksheets is not
  // in its command registry. Fetch the whole-workbook document and slice client-side instead.
  return getDesktopConfig().externalApiEnabled
    ? listWorksheetsViaExternalApi(args)
    : listWorksheetsViaAgentApi(args);
}

async function listWorksheetsViaAgentApi({
  executor,
  signal,
}: WithExecutorAndAbortSignal): Promise<ListWorksheetsResult> {
  const result = await executor.executeCommand({
    namespace: 'tabui',
    command: 'list-worksheets',
    schema: z.object({
      worksheets: z.string(),
    }),
    signal,
  });

  if (result.isErr()) {
    return result;
  }

  let worksheets: unknown;
  try {
    worksheets = JSON.parse(result.value.parsedResult.worksheets || '[]');
  } catch (e) {
    return Err({ type: 'invalid-response', error: e });
  }

  const worksheetsResult = worksheetNamesSchema.safeParse(worksheets);
  if (!worksheetsResult.success) {
    return Err({ type: 'invalid-response', error: worksheetsResult.error });
  }

  return Ok({
    count: worksheetsResult.data.worksheets.length,
    worksheets: worksheetsResult.data.worksheets.map((worksheet) =>
      decodeXmlEntities(worksheet.name),
    ),
  });
}

async function listWorksheetsViaExternalApi({
  executor,
  signal,
}: WithExecutorAndAbortSignal): Promise<ListWorksheetsResult> {
  const workbookResult = await getWorkbookXml({ executor, signal });
  if (workbookResult.isErr()) {
    return workbookResult;
  }

  let worksheets: Array<string>;
  try {
    worksheets = listSheets(workbookResult.value);
  } catch (error) {
    return Err({ type: 'invalid-response', error });
  }

  return Ok({
    count: worksheets.length,
    worksheets,
  });
}
