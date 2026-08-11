import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import type {
  ApplyWorkbookDocumentOptions,
  ExternalApiToolExecutor,
} from '../../../../desktop/externalApi/executorTypes.js';
import { listWorkbookDashboards } from '../../../../desktop/metadata/dashboards.js';
import { listSheets } from '../../../../desktop/metadata/sheets.js';
import { captureTargetWorksheetState } from '../../../../desktop/metadata/targetWorksheetState.js';
import * as sessionResolution from '../../../../desktop/session/sessionResolution.js';
import {
  TemplateArtifactStore,
  type TemplateWorksheetArtifact,
} from '../../../../desktop/templates/templateArtifactStore.js';
import { withApplyLock } from '../../../../desktop/wrappers/applyMutex.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { getRunDashboardBatchTool } from './runDashboardBatch.js';

vi.mock('../../../../desktop/session/sessionResolution.js');

const BASELINE = `<?xml version="1.0"?>
<workbook>
  <worksheets>
    <worksheet name="Existing"><table/></worksheet>
  </worksheets>
  <dashboards>
    <dashboard name="Executive Overview"><zones><zone name="Existing"/></zones></dashboard>
    <dashboard name="Keep"><zones><zone name="Existing"/></zones></dashboard>
  </dashboards>
  <windows>
    <window class="worksheet" name="Existing"/>
    <window class="dashboard" name="Executive Overview"><viewpoints><viewpoint name="Existing"/></viewpoints></window>
    <window class="dashboard" name="Keep"><viewpoints><viewpoint name="Existing"/></viewpoints></window>
  </windows>
</workbook>`;

describe('run-dashboard-batch transactional apply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('12345'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('builds two worksheets and replaces one dashboard with one guarded POST and one shared readback', async () => {
    const store = artifactStore(['a1', 'a2']);
    const consume = vi.spyOn(store, 'consume');
    const release = vi.spyOn(store, 'release');
    const harness = statefulExecutor();

    const result = await callBatch(store, harness.executor, ['a1', 'a2']);

    expect(result.isError).toBe(false);
    expect(harness.posts).toHaveLength(1);
    expect(harness.getCalls()).toBe(4); // baseline, guard, shared readback, validated focus read
    expect(listSheets(harness.posts[0]!)).toEqual(
      expect.arrayContaining(['Existing', 'New A', 'New B']),
    );
    expect(listWorkbookDashboards(harness.posts[0]!)).toEqual(['Keep', 'Executive Overview']);
    expect(harness.executor.executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'goto-sheet', args: { Sheet: 'Executive Overview' } }),
    );
    expect(consume).toHaveBeenCalledTimes(2);
    expect(release).not.toHaveBeenCalled();
    expect(bodyOf(result)).toMatchObject({
      applied: true,
      retrySafe: false,
      steps: [
        { operation: 'worksheet', artifactId: 'a1', state: 'applied' },
        { operation: 'worksheet', artifactId: 'a2', state: 'applied' },
        { operation: 'dashboard', state: 'applied', replaced: true },
      ],
    });
  });

  it('waits past a stale same-name dashboard before accepting a compose-only replacement', async () => {
    vi.useFakeTimers();
    const store = artifactStore([]);
    const harness = statefulExecutor({ staleReadbackCount: 1 });

    const resultPromise = callBatch(store, harness.executor, []);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.isError).toBe(false);
    expect(harness.posts).toHaveLength(1);
    expect(harness.getCalls()).toBe(5); // baseline, guard, stale readback, settled readback, focus
    expect(bodyOf(result)).toMatchObject({
      applied: true,
      steps: [{ operation: 'dashboard', state: 'applied', replaced: true }],
    });
  });

  it('waits for a concurrent apply before activating the dashboard', async () => {
    let releaseConcurrentApply!: () => void;
    const concurrentApplyReleased = new Promise<void>((resolve) => {
      releaseConcurrentApply = resolve;
    });
    let markConcurrentApplyStarted!: () => void;
    const concurrentApplyStarted = new Promise<void>((resolve) => {
      markConcurrentApplyStarted = resolve;
    });
    let concurrentApply: Promise<void> | undefined;
    const store = artifactStore(['a1']);
    const harness = statefulExecutor({
      afterApplyDispatch: () => {
        concurrentApply = withApplyLock(async () => {
          markConcurrentApplyStarted();
          await concurrentApplyReleased;
        });
      },
    });

    const resultPromise = callBatch(store, harness.executor, ['a1']);
    await concurrentApplyStarted;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const activatedWhileApplyWasInFlight = vi.mocked(harness.executor.executeCommand).mock.calls
      .length;

    releaseConcurrentApply();
    await concurrentApply;
    const result = await resultPromise;

    expect(activatedWhileApplyWasInFlight).toBe(0);
    expect(result.isError).toBe(false);
    expect(harness.executor.executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'goto-sheet', args: { Sheet: 'Executive Overview' } }),
    );
  });

  it('releases every lease and writes nothing when a later artifact fails preflight', async () => {
    const store = artifactStore(['a1', 'a2'], {
      worksheetXmls: {
        a2: '<worksheet name="New B"><table><view><filter column="[DS].[none:Category:nk]"><groupfilter function="end" count="0"/></filter></view></table></worksheet>',
      },
    });
    const release = vi.spyOn(store, 'release');
    const consume = vi.spyOn(store, 'consume');
    const harness = statefulExecutor();

    const result = await callBatch(store, harness.executor, ['a1', 'a2']);

    expect(bodyOf(result)).toMatchObject({ applied: false, retrySafe: true });
    expect(harness.posts).toHaveLength(0);
    expect(release).toHaveBeenCalledTimes(2);
    expect(consume).not.toHaveBeenCalled();
    expect(store.reserve('a1', '12345').ok).toBe(true);
    expect(store.reserve('a2', '12345').ok).toBe(true);
  });

  it('releases every lease and writes nothing when candidate construction fails', async () => {
    const store = artifactStore(['a1', 'a2'], {
      windowXmls: { a2: '<window class="dashboard" name="New B"/>' },
    });
    const release = vi.spyOn(store, 'release');
    const harness = statefulExecutor();

    const result = await callBatch(store, harness.executor, ['a1', 'a2']);

    expect(bodyOf(result)).toMatchObject({ applied: false, retrySafe: true });
    expect(harness.posts).toHaveLength(0);
    expect(harness.current()).toBe(BASELINE);
    expect(release).toHaveBeenCalledTimes(2);
  });

  it('refuses a workbook that changes inside the apply lock before dispatch', async () => {
    const store = artifactStore(['a1']);
    const changed = BASELINE.replace('<worksheet name="Existing">', '<worksheet name="Changed">');
    const harness = statefulExecutor({ guardedReadXml: changed });

    const result = await callBatch(store, harness.executor, ['a1']);

    expect(bodyOf(result)).toMatchObject({ applied: false, retrySafe: true });
    expect(harness.posts).toHaveLength(0);
    expect(store.reserve('a1', '12345').ok).toBe(true);
  });

  it('consumes every artifact and returns unknown when dispatch becomes ambiguous', async () => {
    const store = artifactStore(['a1', 'a2']);
    const consume = vi.spyOn(store, 'consume');
    const release = vi.spyOn(store, 'release');
    const harness = statefulExecutor({ failAfterDispatch: true });

    const result = await callBatch(store, harness.executor, ['a1', 'a2']);

    expect(bodyOf(result)).toMatchObject({ applied: 'unknown', retrySafe: false });
    expect(harness.posts).toHaveLength(1);
    expect(consume).toHaveBeenCalledTimes(2);
    expect(release).not.toHaveBeenCalled();
    expect(store.reserve('a1', '12345')).toMatchObject({ ok: false, reason: 'consumed' });
    expect(store.reserve('a2', '12345')).toMatchObject({ ok: false, reason: 'consumed' });
  });

  it('uses one shared polling stream and returns unknown when worksheet readback differs', async () => {
    vi.useFakeTimers();
    const intended =
      '<worksheet name="New A"><table><panes><pane><mark class="Bar"/></pane></panes></table></worksheet>';
    const store = artifactStore(['a1'], { worksheetXmls: { a1: intended } });
    const harness = statefulExecutor({
      readbackTransform: (xml) => xml.replace('<mark class="Bar"', '<mark class="Circle"'),
    });

    const promise = callBatch(store, harness.executor, ['a1']);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(bodyOf(result)).toMatchObject({ applied: 'unknown', retrySafe: false });
    expect(harness.posts).toHaveLength(1);
    expect(harness.getCalls()).toBe(10); // baseline + guard + 8 shared poll attempts
    expect(store.reserve('a1', '12345')).toMatchObject({ ok: false, reason: 'consumed' });
  });
});

async function callBatch(
  store: TemplateArtifactStore,
  executor: ExternalApiToolExecutor,
  artifactIds: string[],
): Promise<CallToolResult> {
  const tool = getRunDashboardBatchTool(new DesktopMcpServer(), { store });
  const callback = await Provider.from(tool.callback);
  return await callback(
    {
      session: '12345',
      artifactIds,
      dashboardName: 'Executive Overview',
      existingWorksheetNames: ['Existing'],
      title: 'Executive Overview',
      layoutType: 'columns',
      gridColumns: undefined,
    },
    {
      ...getMockRequestHandlerExtra(),
      signal: new AbortController().signal,
      getExecutor: vi.fn().mockResolvedValue(executor),
    },
  );
}

function statefulExecutor({
  guardedReadXml,
  failAfterDispatch = false,
  readbackTransform,
  staleReadbackCount = 0,
  afterApplyDispatch,
}: {
  guardedReadXml?: string;
  failAfterDispatch?: boolean;
  readbackTransform?: (xml: string) => string;
  staleReadbackCount?: number;
  afterApplyDispatch?: () => void;
} = {}): {
  executor: ExternalApiToolExecutor;
  posts: string[];
  current: () => string;
  getCalls: () => number;
} {
  let current = BASELINE;
  let getCalls = 0;
  const posts: string[] = [];
  const executor = {
    getWorkbookDocument: vi.fn(async () => {
      getCalls += 1;
      const xml =
        getCalls === 2 && guardedReadXml
          ? guardedReadXml
          : getCalls >= 3 && getCalls < 3 + staleReadbackCount
            ? BASELINE
            : getCalls >= 3 && readbackTransform
              ? readbackTransform(current)
              : current;
      return Ok({
        xml,
        applicationVersion: undefined,
        xsdPayloadVersion: undefined,
        instanceId: 'inst-live',
      });
    }),
    applyWorkbookDocument: vi.fn(
      async (xml: string, _signal: AbortSignal, options?: ApplyWorkbookDocumentOptions) => {
        options?.onDispatch?.();
        posts.push(xml);
        afterApplyDispatch?.();
        if (failAfterDispatch) {
          return Err({ type: 'command-timed-out' as const, error: 'timed out' });
        }
        current = xml;
        return Ok({ command_id: 'apply-1', status: 'completed' as const, submitted_at: 'now' });
      },
    ),
    executeCommand: vi.fn(async () =>
      Ok({ command_id: 'goto-1', status: 'completed' as const, submitted_at: 'now' }),
    ),
  } as unknown as ExternalApiToolExecutor;
  return { executor, posts, current: () => current, getCalls: () => getCalls };
}

function artifactStore(
  artifactIds: string[],
  options: {
    worksheetXmls?: Record<string, string>;
    windowXmls?: Record<string, string>;
  } = {},
): TemplateArtifactStore {
  const store = new TemplateArtifactStore();
  for (const artifactId of artifactIds) {
    const title = artifactId === 'a1' ? 'New A' : 'New B';
    const worksheetXml =
      options.worksheetXmls?.[artifactId] ?? `<worksheet name="${title}"><table/></worksheet>`;
    store.put({
      id: artifactId,
      sessionId: '12345',
      instanceId: 'inst-live',
      templateName: 'test-template',
      templateSourceHash: 'source-hash',
      title,
      datasource: 'target.ds',
      fieldMapping: {},
      worksheetXml,
      windowXml: options.windowXmls?.[artifactId] ?? `<window class="worksheet" name="${title}"/>`,
      targetState: captureTargetWorksheetState(BASELINE, title, worksheetXml),
    } satisfies TemplateWorksheetArtifact);
  }
  return store;
}

function bodyOf(result: CallToolResult): Record<string, any> {
  invariant(result.content[0]?.type === 'text');
  return JSON.parse(result.content[0].text) as Record<string, any>;
}
