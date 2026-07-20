import { Result } from 'ts-results-es';

import { externalApiReads } from '../../externalApi/externalApiReads.js';
import {
  ExecuteCommandError,
  WithExecutorAndAbortSignal,
} from '../../toolExecutor/toolExecutor.js';

export type SheetItem = { id: string; name: string };

export async function listWorksheetItems({
  executor,
  signal,
}: WithExecutorAndAbortSignal): Promise<Result<Array<SheetItem>, ExecuteCommandError>> {
  const result = await externalApiReads(executor).listWorksheets(signal);
  return result.map((value) => value.worksheets.map(({ id, name }) => ({ id, name })));
}

export async function listDashboardItems({
  executor,
  signal,
}: WithExecutorAndAbortSignal): Promise<Result<Array<SheetItem>, ExecuteCommandError>> {
  const result = await externalApiReads(executor).listDashboards(signal);
  return result.map((value) => value.dashboards.map(({ id, name }) => ({ id, name })));
}

export function findByName(items: Array<SheetItem>, name: string): SheetItem | undefined {
  return items.find((item) => item.name === name);
}
