import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import {
  ExecuteCommandError,
  WithExecutorAndAbortSignal,
} from '../../toolExecutor/toolExecutor.js';

export type SheetItem = { id: string; name: string };

const worksheetItemsSchema = z.object({
  worksheets: z.array(z.object({ id: z.string(), name: z.string() }).passthrough()),
});

const dashboardItemsSchema = z.object({
  dashboards: z.array(z.object({ id: z.string(), name: z.string() }).passthrough()),
});

export async function listWorksheetItems({
  executor,
  signal,
}: WithExecutorAndAbortSignal): Promise<Result<Array<SheetItem>, ExecuteCommandError>> {
  const result = await executor.executeCommand({
    namespace: 'tabui',
    command: 'list-worksheets',
    schema: worksheetItemsSchema,
    signal,
  });
  if (result.isErr()) {
    return result;
  }
  return Ok(result.value.parsedResult.worksheets.map(({ id, name }) => ({ id, name })));
}

export async function listDashboardItems({
  executor,
  signal,
}: WithExecutorAndAbortSignal): Promise<Result<Array<SheetItem>, ExecuteCommandError>> {
  const result = await executor.executeCommand({
    namespace: 'tabui',
    command: 'list-dashboards',
    schema: dashboardItemsSchema,
    signal,
  });
  if (result.isErr()) {
    return result;
  }
  return Ok(result.value.parsedResult.dashboards.map(({ id, name }) => ({ id, name })));
}

export function findByName(items: Array<SheetItem>, name: string): SheetItem | undefined {
  return items.find((item) => item.name === name);
}
