import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import * as episodeEvents from '../../../../desktop/episode-events.js';
import type {
  ApplyWorkbookDocumentOptions,
  ExternalApiToolExecutor,
} from '../../../../desktop/externalApi/executorTypes.js';
import { captureTargetWorksheetState } from '../../../../desktop/metadata/targetWorksheetState.js';
import * as sessionResolution from '../../../../desktop/session/sessionResolution.js';
import {
  TemplateArtifactStore,
  type TemplateWorksheetArtifact,
} from '../../../../desktop/templates/templateArtifactStore.js';
import { DesktopMcpServer, getDesktopToolListEntry } from '../../../../server.desktop.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { getRunDashboardBatchTool } from './runDashboardBatch.js';

vi.mock('../../../../desktop/session/sessionResolution.js');

const BATCH = {
  dashboardName: 'Executive Overview',
  existingWorksheetNames: ['Existing'],
  title: 'Executive Overview',
  layoutType: 'columns' as const,
};

const WORKBOOK_XML = renderedWorkbook(['Existing', 'Existing A', 'Existing B']);

describe('runDashboardBatchTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('12345'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('publishes a typed flat queue contract under the per-tool byte cap', async () => {
    const tool = getRunDashboardBatchTool(new DesktopMcpServer());
    const schema = z.object(await Provider.from(tool.paramsSchema));

    expect(
      schema.safeParse({ session: '12345', artifactIds: ['a1', 'a2'], ...BATCH }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        session: '12345',
        artifactIds: ['a1', 'a2'],
        dashboardName: BATCH.dashboardName,
        layoutType: 'executive-summary',
        kpiWorksheetNames: ['New A'],
      }).success,
    ).toBe(true);
    expect(schema.safeParse({ session: '12345', ...BATCH }).success).toBe(true);
    expect(
      schema.safeParse({ session: '12345', artifactIds: Array(7).fill('a'), ...BATCH }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ session: '12345', ...BATCH, existingWorksheetNames: [] }).success,
    ).toBe(true);
    const tooLong = 'x'.repeat(256);
    expect(schema.safeParse({ ...BATCH, artifactIds: [tooLong] }).success).toBe(false);
    expect(schema.safeParse({ ...BATCH, dashboardName: tooLong }).success).toBe(false);
    expect(schema.safeParse({ ...BATCH, existingWorksheetNames: [tooLong] }).success).toBe(false);
    expect(schema.safeParse({ ...BATCH, title: tooLong }).success).toBe(false);

    const entry = await getDesktopToolListEntry(tool);
    expect(entry.inputSchema).toMatchObject({
      properties: {
        artifactIds: { type: 'array', items: { type: 'string' } },
        dashboardName: { type: 'string' },
        existingWorksheetNames: { type: 'array', items: { type: 'string' } },
        title: { type: 'string' },
        layoutType: { type: 'string' },
        gridColumns: { type: 'integer' },
        kpiWorksheetNames: { type: 'array', items: { type: 'string' } },
      },
      required: expect.arrayContaining(['dashboardName']),
    });
    expect(entry.inputSchema.required).not.toContain('existingWorksheetNames');
    expect(entry.inputSchema.properties).not.toHaveProperty('tasks');
    expect(JSON.stringify(entry).length).toBeLessThanOrEqual(1_020);
  });

  it('records bounded success telemetry without workbook identifiers', async () => {
    const emitSpy = vi.spyOn(episodeEvents, 'emitEpisodeEvent').mockResolvedValue();

    const result = await callBatch(['a1']);

    expect(result.isError).toBe(false);
    const event = emitSpy.mock.calls
      .map(([, value]) => value)
      .find((value) => value.type === 'batch_apply');
    expect(event).toMatchObject({
      type: 'batch_apply',
      session_id: '12345',
      artifact_count: 1,
      existing_worksheet_count: 1,
      duration_ms: expect.any(Number),
      outcome: 'succeeded',
    });
    expect(event).not.toHaveProperty('dashboardName');
    expect(event).not.toHaveProperty('artifactIds');
    expect(event).not.toHaveProperty('worksheetNames');
  });

  it('returns without waiting for the telemetry sink', async () => {
    const emitSpy = vi
      .spyOn(episodeEvents, 'emitEpisodeEvent')
      .mockImplementation(() => new Promise(() => undefined));

    try {
      const result = await Promise.race([
        callBatch(['a1']),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('batch waited for telemetry')), 100),
        ),
      ]);

      expect(result.isError).toBe(false);
    } finally {
      emitSpy.mockRestore();
    }
  });

  it('records duplicate and unavailable artifacts as refused', async () => {
    const emitSpy = vi.spyOn(episodeEvents, 'emitEpisodeEvent').mockResolvedValue();
    await callBatch(['a1', 'a1'], { store: artifactStore(['a1']) });
    await callBatch(['a1', 'missing'], { store: artifactStore(['a1']) });

    const outcomes = emitSpy.mock.calls
      .map(([, value]) => value)
      .filter((value) => value.type === 'batch_apply')
      .map((value) => value.outcome);
    expect(outcomes).toEqual(['refused', 'refused']);
  });

  it('records abort before dispatch and releases every reservation', async () => {
    const emitSpy = vi.spyOn(episodeEvents, 'emitEpisodeEvent').mockResolvedValue();
    const store = artifactStore(['a1', 'a2']);
    const release = vi.spyOn(store, 'release');
    const controller = new AbortController();
    controller.abort();
    const harness = statefulExecutor();

    const result = await callBatch(['a1', 'a2'], {
      store,
      signal: controller.signal,
      executor: harness.executor,
    });

    expect(bodyOf(result)).toMatchObject({ applied: false, retrySafe: true });
    expect(harness.posts).toHaveLength(0);
    expect(release).toHaveBeenCalledTimes(2);
    const event = emitSpy.mock.calls
      .map(([, value]) => value)
      .find((value) => value.type === 'batch_apply');
    expect(event).toMatchObject({ outcome: 'aborted' });
  });

  it('records ambiguous dispatch as unknown', async () => {
    const emitSpy = vi.spyOn(episodeEvents, 'emitEpisodeEvent').mockResolvedValue();
    const harness = statefulExecutor({ failAfterDispatch: true });

    const result = await callBatch(['a1'], { executor: harness.executor });

    expect(bodyOf(result)).toMatchObject({ applied: 'unknown', retrySafe: false });
    const event = emitSpy.mock.calls
      .map(([, value]) => value)
      .find((value) => value.type === 'batch_apply');
    expect(event).toMatchObject({ outcome: 'unknown' });
  });

  it('reserves every artifact before validation and releases all when a later one fails', async () => {
    const store = artifactStore(['a1', 'a2'], {
      worksheetXmls: {
        a2: '<worksheet name="New B"><table><view><filter column="[DS].[none:Category:nk]"><groupfilter function="end" count="0"/></filter></view></table></worksheet>',
      },
    });
    const reserve = vi.spyOn(store, 'reserve');
    const release = vi.spyOn(store, 'release');
    const harness = statefulExecutor();

    const result = await callBatch(['a1', 'a2'], { store, executor: harness.executor });

    expect(bodyOf(result)).toMatchObject({ applied: false, retrySafe: true });
    expect(reserve).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledTimes(2);
    expect(harness.posts).toHaveLength(0);
  });

  it('rejects duplicate ids before reserving', async () => {
    const store = artifactStore(['a1']);
    const reserve = vi.spyOn(store, 'reserve');

    const result = await callBatch(['a1', 'a1'], { store });

    expect(bodyOf(result)).toMatchObject({ applied: false, retrySafe: true });
    expect(reserve).not.toHaveBeenCalled();
  });

  it('rejects session and Desktop instance mismatches before writing', async () => {
    const sessionMismatch = await callBatch(['a1'], {
      store: artifactStore(['a1'], { sessionId: 'other-session' }),
    });
    const instanceHarness = statefulExecutor();
    const instanceMismatch = await callBatch(['a1'], {
      store: artifactStore(['a1'], { instanceId: 'other-instance' }),
      executor: instanceHarness.executor,
    });

    expect(bodyOf(sessionMismatch)).toMatchObject({ applied: false, retrySafe: true });
    expect(bodyOf(instanceMismatch)).toMatchObject({ applied: false, retrySafe: true });
    expect(instanceHarness.posts).toHaveLength(0);
  });

  it('rejects stale artifact target state before writing', async () => {
    const staleXml = WORKBOOK_XML.replace(
      '</worksheets>',
      '<worksheet name="New A"><table/></worksheet></worksheets>',
    ).replace('</windows>', '<window class="worksheet" name="New A"/></windows>');
    const harness = statefulExecutor({ initialXml: staleXml });

    const result = await callBatch(['a1'], { executor: harness.executor });

    expect(bodyOf(result)).toMatchObject({ applied: false, retrySafe: true });
    expect(harness.posts).toHaveLength(0);
  });

  it('reports a workbook change detected immediately before the batch write', async () => {
    const harness = statefulExecutor({ driftBeforeApply: true });

    const result = await callBatch(['a1'], { executor: harness.executor });

    expect(bodyOf(result)).toMatchObject({
      applied: false,
      retrySafe: true,
      steps: expect.arrayContaining([
        expect.objectContaining({
          operation: 'dashboard',
          stage: 'workbookDrift',
          error: 'The workbook changed before the authoring write.',
        }),
      ]),
    });
    expect(harness.posts).toHaveLength(0);
  });

  it('rejects missing or unrendered existing worksheets before writing', async () => {
    const missing = await callBatch([], { existingWorksheetNames: ['Missing'] });
    const unrenderedXml = WORKBOOK_XML.replace(
      '</worksheets>',
      '<worksheet name="Unrendered"><table/></worksheet></worksheets>',
    );
    const harness = statefulExecutor({ initialXml: unrenderedXml });
    const unrendered = await callBatch([], {
      existingWorksheetNames: ['Unrendered'],
      executor: harness.executor,
    });

    expect(bodyOf(missing)).toMatchObject({ applied: false, retrySafe: true });
    expect(bodyOf(unrendered)).toMatchObject({ applied: false, retrySafe: true });
    expect(harness.posts).toHaveLength(0);
  });

  it('rejects canonical worksheet collisions, dashboard collisions, and more than six sheets', async () => {
    const canonical = await callBatch(['a1'], {
      store: artifactStore(['a1'], { titles: { a1: 'Existi&#110;g' } }),
    });
    const dashboard = await callBatch(['a1'], {
      store: artifactStore(['a1'], { titles: { a1: 'Executive Overview' } }),
    });
    const tooMany = await callBatch(['a1'], {
      existingWorksheetNames: ['E1', 'E2', 'E3', 'E4', 'E5', 'E6'],
      executor: statefulExecutor({
        initialXml: renderedWorkbook(['E1', 'E2', 'E3', 'E4', 'E5', 'E6']),
      }).executor,
    });

    expect(bodyOf(canonical)).toMatchObject({ applied: false, retrySafe: true });
    expect(bodyOf(dashboard)).toMatchObject({ applied: false, retrySafe: true });
    expect(bodyOf(tooMany)).toMatchObject({ applied: false, retrySafe: true });
  });

  it('supports compose-only with existing rendered worksheets', async () => {
    const harness = statefulExecutor();

    const result = await callBatch([], {
      existingWorksheetNames: ['Existing A', 'Existing B'],
      executor: harness.executor,
    });

    expect(result.isError).toBe(false);
    expect(harness.posts).toHaveLength(1);
    expect(bodyOf(result)).toMatchObject({
      applied: true,
      steps: [
        {
          operation: 'dashboard',
          worksheets: ['Existing A', 'Existing B'],
          state: 'applied',
        },
      ],
    });
  });

  it('composes an executive summary with KPI worksheets above analytical views', async () => {
    const harness = statefulExecutor();

    const result = await callBatch([], {
      existingWorksheetNames: ['Existing A', 'Existing B'],
      layoutType: 'executive-summary',
      kpiWorksheetNames: ['Existing A'],
      executor: harness.executor,
    });

    expect(result.isError).toBe(false);
    expect(harness.posts).toHaveLength(1);
    expect(harness.posts[0]).toContain(
      'h="20000" id="11" name="Existing A" w="100000" x="0" y="8000"',
    );
    expect(harness.posts[0]).toContain(
      'h="72000" id="12" name="Existing B" w="100000" x="0" y="28000"',
    );
  });

  it('resolves KPI roles against artifact worksheet titles before the single write', async () => {
    const harness = statefulExecutor();

    const result = await callBatch(['a1', 'a2'], {
      existingWorksheetNames: [],
      layoutType: 'executive-summary',
      kpiWorksheetNames: ['New A'],
      executor: harness.executor,
    });

    expect(result.isError).toBe(false);
    expect(harness.posts).toHaveLength(1);
    expect(harness.posts[0]).toContain('h="20000" id="11" name="New A" w="100000" x="0" y="8000"');
    expect(harness.posts[0]).toContain('h="72000" id="12" name="New B" w="100000" x="0" y="28000"');
  });

  it('rejects unknown KPI names and conflicting free-form layout controls before writing', async () => {
    const missingHarness = statefulExecutor();
    const missing = await callBatch([], {
      existingWorksheetNames: ['Existing A', 'Existing B'],
      layoutType: 'executive-summary',
      kpiWorksheetNames: ['Missing KPI'],
      executor: missingHarness.executor,
    });
    const conflictHarness = statefulExecutor();
    const conflict = await callBatch([], {
      existingWorksheetNames: ['Existing A', 'Existing B'],
      layoutType: 'executive-summary',
      kpiWorksheetNames: ['Existing A'],
      gridColumns: 2,
      executor: conflictHarness.executor,
    });

    expect(bodyOf(missing)).toMatchObject({ applied: false, retrySafe: true });
    expect(bodyOf(conflict)).toMatchObject({ applied: false, retrySafe: true });
    expect(missingHarness.posts).toHaveLength(0);
    expect(conflictHarness.posts).toHaveLength(0);
  });

  it('keeps six-artifact warning and failure receipts below the SDK truncation limit', async () => {
    const ids = Array.from({ length: 6 }, (_, index) => `${index}-${'i'.repeat(250)}`);
    const titles = Object.fromEntries(ids.map((id, index) => [id, `${index}-${'t'.repeat(250)}`]));
    const warningXmls = Object.fromEntries(
      ids.map((id) => [
        id,
        `<worksheet name="${titles[id]}"><table><shelf-sort-v2 direction="ASC"/></table></worksheet>`,
      ]),
    );
    const warningHarness = statefulExecutor({
      readbackTransform: (xml) => xml.replace(/<shelf-sort-v2[^>]*\/>/g, ''),
    });
    const warningResult = await callBatch(ids, {
      store: artifactStore(ids, { titles, worksheetXmls: warningXmls }),
      existingWorksheetNames: [],
      executor: warningHarness.executor,
    });

    expect(warningResult.isError).toBe(false);
    expect(JSON.stringify(bodyOf(warningResult)).length).toBeLessThanOrEqual(8 * 1024);

    vi.useFakeTimers();
    const failedXmls = Object.fromEntries(
      ids.map((id) => [
        id,
        `<worksheet name="${titles[id]}"><table><panes><pane><mark class="Bar"/></pane></panes></table></worksheet>`,
      ]),
    );
    const failureHarness = statefulExecutor({
      readbackTransform: (xml) => xml.replace(/<mark class="Bar"/g, '<mark class="Circle"'),
    });
    const failurePromise = callBatch(ids, {
      store: artifactStore(ids, { titles, worksheetXmls: failedXmls }),
      existingWorksheetNames: [],
      executor: failureHarness.executor,
    });
    await vi.runAllTimersAsync();
    const failureResult = await failurePromise;

    expect(bodyOf(failureResult)).toMatchObject({ applied: 'unknown', retrySafe: false });
    expect(JSON.stringify(bodyOf(failureResult)).length).toBeLessThanOrEqual(8 * 1024);
  });
});

async function callBatch(
  artifactIds: string[],
  options: {
    store?: TemplateArtifactStore;
    signal?: AbortSignal;
    executor?: ExternalApiToolExecutor;
    existingWorksheetNames?: string[];
    kpiWorksheetNames?: string[];
    layoutType?: 'auto-grid' | 'rows' | 'columns' | 'executive-summary';
    gridColumns?: number;
  } = {},
): Promise<CallToolResult> {
  const tool = getRunDashboardBatchTool(new DesktopMcpServer(), {
    store: options.store ?? artifactStore(artifactIds),
  });
  const callback = await Provider.from(tool.callback);
  return await callback(
    {
      session: '12345',
      artifactIds,
      ...BATCH,
      gridColumns: options.gridColumns,
      layoutType: options.layoutType ?? BATCH.layoutType,
      kpiWorksheetNames: options.kpiWorksheetNames,
      ...(options.existingWorksheetNames !== undefined
        ? { existingWorksheetNames: options.existingWorksheetNames }
        : {}),
    },
    {
      ...getMockRequestHandlerExtra(),
      signal: options.signal ?? new AbortController().signal,
      getExecutor: vi.fn().mockResolvedValue(options.executor ?? statefulExecutor().executor),
    },
  );
}

function statefulExecutor({
  initialXml = WORKBOOK_XML,
  failAfterDispatch = false,
  driftBeforeApply = false,
  readbackTransform,
}: {
  initialXml?: string;
  failAfterDispatch?: boolean;
  driftBeforeApply?: boolean;
  readbackTransform?: (xml: string) => string;
} = {}): { executor: ExternalApiToolExecutor; posts: string[] } {
  let current = initialXml;
  let readCount = 0;
  const posts: string[] = [];
  const executor = {
    getWorkbookDocument: vi.fn(async () => {
      const xml =
        driftBeforeApply && readCount++ > 0
          ? current.replace('<workbook>', '<workbook changed="true">')
          : posts.length > 0 && readbackTransform
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
  return { executor, posts };
}

function artifactStore(
  artifactIds: string[],
  options: {
    sessionId?: string;
    instanceId?: string;
    titles?: Record<string, string>;
    worksheetXmls?: Record<string, string>;
  } = {},
): TemplateArtifactStore {
  const store = new TemplateArtifactStore();
  for (const artifactId of artifactIds) {
    const title = options.titles?.[artifactId] ?? artifactTitle(artifactId);
    const worksheetXml =
      options.worksheetXmls?.[artifactId] ?? `<worksheet name="${title}"><table/></worksheet>`;
    store.put({
      id: artifactId,
      sessionId: options.sessionId ?? '12345',
      instanceId: options.instanceId ?? 'inst-live',
      templateName: 'test-template',
      templateSourceHash: 'source-hash',
      title,
      datasource: 'target.ds',
      fieldMapping: {},
      worksheetXml,
      windowXml: `<window class="worksheet" name="${title}"/>`,
      targetState: captureTargetWorksheetState(WORKBOOK_XML, title, worksheetXml),
    } satisfies TemplateWorksheetArtifact);
  }
  return store;
}

function artifactTitle(artifactId: string): string {
  if (artifactId === 'a1') return 'New A';
  if (artifactId === 'a2') return 'New B';
  return `New ${artifactId}`;
}

function renderedWorkbook(names: string[]): string {
  return `<?xml version="1.0"?><workbook><worksheets>${names
    .map((name) => `<worksheet name="${name}"><table/></worksheet>`)
    .join('')}</worksheets><windows>${names
    .map((name) => `<window class="worksheet" name="${name}"/>`)
    .join('')}</windows></workbook>`;
}

function bodyOf(result: CallToolResult): Record<string, any> {
  invariant(result.content[0]?.type === 'text');
  return JSON.parse(result.content[0].text) as Record<string, any>;
}
