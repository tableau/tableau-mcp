import { Err, Ok, Result } from 'ts-results-es';

import { ExternalApiReads } from '../../externalApi/externalApiReads.js';
import { ExecuteCommandError, ToolExecutor } from '../../toolExecutor/toolExecutor.js';

type Reads = Partial<ExternalApiReads>;

// Always provides getWorkbookDocument: externalApiReads() narrows on that method's presence,
// so a stub without it would fail the narrowing rather than exercise the branch under test.
export function fakeExternalReadsExecutor(overrides: Reads = {}): ToolExecutor {
  const notStubbed =
    <T>(name: string) =>
    (): Promise<Result<T, ExecuteCommandError>> =>
      Promise.resolve(Err({ type: 'unknown', error: `${name} not stubbed` }));

  const base: Reads = {
    getWorkbookDocument: overrides.getWorkbookDocument ?? notStubbed('getWorkbookDocument'),
  };

  return { ...base, ...overrides } as unknown as ToolExecutor;
}

export function listItemsExecutor(items: {
  worksheets?: Array<{ id: string; name: string; hidden?: boolean }>;
  dashboards?: Array<{ id: string; name: string; hidden?: boolean }>;
  extra?: Reads;
}): ToolExecutor {
  return fakeExternalReadsExecutor({
    listWorksheets: () =>
      Promise.resolve(
        Ok({ worksheets: (items.worksheets ?? []).map((w) => ({ hidden: false, ...w })) }),
      ),
    listDashboards: () =>
      Promise.resolve(
        Ok({ dashboards: (items.dashboards ?? []).map((d) => ({ hidden: false, ...d })) }),
      ),
    ...items.extra,
  });
}
