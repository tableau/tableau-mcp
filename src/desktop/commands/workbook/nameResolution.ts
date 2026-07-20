import { z } from 'zod';

import { WithExecutorAndAbortSignal } from '../../toolExecutor/toolExecutor.js';
import { normalizeXmlName } from '../../xmlElement.js';

const worksheetNamesSchema = z.object({
  worksheets: z.array(z.object({ name: z.string() })),
});

const dashboardNamesSchema = z.object({
  dashboards: z.array(z.object({ name: z.string() })),
});

export function nameMayNeedRawCommandResolution(name: string): boolean {
  return /[&<>"']/.test(name);
}

export async function resolveWorksheetCommandName(
  worksheetName: string,
  { executor, signal }: WithExecutorAndAbortSignal,
): Promise<string | null> {
  try {
    const result = await executor.executeCommand({
      namespace: 'tabui',
      command: 'list-worksheets',
      schema: z.object({ worksheets: z.string() }),
      signal,
    });
    if (result.isErr()) return null;

    const parsed = worksheetNamesSchema.safeParse(
      JSON.parse(result.value.parsedResult.worksheets || '[]'),
    );
    if (!parsed.success) return null;

    const needle = normalizeXmlName(worksheetName);
    return (
      parsed.data.worksheets.find((worksheet) => normalizeXmlName(worksheet.name) === needle)
        ?.name ?? null
    );
  } catch {
    return null;
  }
}

export async function resolveDashboardCommandName(
  dashboardName: string,
  { executor, signal }: WithExecutorAndAbortSignal,
): Promise<string | null> {
  try {
    const result = await executor.executeCommand({
      namespace: 'tabui',
      command: 'list-dashboards',
      schema: z.object({ dashboards: z.string() }),
      signal,
    });
    if (result.isErr()) return null;

    const parsed = dashboardNamesSchema.safeParse(
      JSON.parse(result.value.parsedResult.dashboards || '[]'),
    );
    if (!parsed.success) return null;

    const needle = normalizeXmlName(dashboardName);
    return (
      parsed.data.dashboards.find((dashboard) => normalizeXmlName(dashboard.name) === needle)
        ?.name ?? null
    );
  } catch {
    return null;
  }
}
