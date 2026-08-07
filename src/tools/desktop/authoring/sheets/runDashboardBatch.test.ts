import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import type { ExternalApiToolExecutor } from '../../../../desktop/externalApi/executorTypes.js';
import { captureTargetWorksheetState } from '../../../../desktop/metadata/targetWorksheetState.js';
import * as sessionResolution from '../../../../desktop/session/sessionResolution.js';
import {
  TemplateArtifactStore,
  type TemplateWorksheetArtifact,
} from '../../../../desktop/templates/templateArtifactStore.js';
import { McpToolError } from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer, getDesktopToolListEntry } from '../../../../server.desktop.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import * as applyArtifactModule from '../../api/applyWorksheetArtifact.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import * as composeModule from './composeDashboardCore.js';
import { getRunDashboardBatchTool } from './runDashboardBatch.js';

vi.mock('../../../../desktop/session/sessionResolution.js');
vi.mock('../../api/applyWorksheetArtifact.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/applyWorksheetArtifact.js')>()),
  applyWorksheetArtifact: vi.fn(),
}));
vi.mock('./composeDashboardCore.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./composeDashboardCore.js')>()),
  composeDashboardCore: vi.fn(),
}));

const BATCH = {
  dashboardName: 'Executive Overview',
  existingWorksheetNames: ['Existing'],
  title: 'Executive Overview',
  layoutType: 'columns' as const,
};

const WORKBOOK_XML = `<workbook>
  <worksheets>
    <worksheet name="Existing"><table /></worksheet>
    <worksheet name="Existing A"><table /></worksheet>
    <worksheet name="Existing B"><table /></worksheet>
  </worksheets>
  <windows>
    <window class="worksheet" name="Existing" />
    <window class="worksheet" name="Existing A" />
    <window class="worksheet" name="Existing B" />
  </windows>
</workbook>`;

describe('runDashboardBatchTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('12345'));
  });

  it('publishes a typed flat queue contract under the per-tool byte cap', async () => {
    const tool = getRunDashboardBatchTool(new DesktopMcpServer());
    const schema = z.object(await Provider.from(tool.paramsSchema));

    expect(
      schema.safeParse({ session: '12345', artifactIds: ['a1', 'a2'], ...BATCH }).success,
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
      },
      required: expect.arrayContaining(['dashboardName']),
    });
    expect(entry.inputSchema.required).not.toContain('existingWorksheetNames');
    expect(entry.inputSchema.properties).not.toHaveProperty('tasks');
    expect(JSON.stringify(entry).length).toBeLessThanOrEqual(1_020);
  });

  it('runs a1, a2, then compose in order with one executor resolution', async () => {
    const order: string[] = [];
    vi.mocked(applyArtifactModule.applyWorksheetArtifact).mockImplementation(
      async ({ artifactId }) => {
        order.push(artifactId);
        return appliedArtifact(artifactId, artifactId === 'a1' ? 'New A' : 'New B');
      },
    );
    vi.mocked(composeModule.composeDashboardCore).mockImplementation(async () => {
      order.push('compose');
      return composedDashboard();
    });
    const liveExecutor = executor();
    const getExecutor = vi.fn().mockResolvedValue(liveExecutor);

    const result = await callBatch(['a1', 'a2'], { getExecutor });

    expect(result.isError).toBe(false);
    expect(order).toEqual(['a1', 'a2', 'compose']);
    expect(getExecutor).toHaveBeenCalledTimes(1);
    expect(liveExecutor.getWorkbookDocument).toHaveBeenCalledTimes(1);
    expect(applyArtifactModule.applyWorksheetArtifact).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        reservation: expect.objectContaining({
          artifact: expect.objectContaining({ id: 'a1' }),
        }),
      }),
    );
    expect(bodyOf(result)).toMatchObject({
      applied: true,
      retrySafe: false,
      steps: [
        { operation: 'worksheet', artifactId: 'a1', state: 'applied' },
        { operation: 'worksheet', artifactId: 'a2', state: 'applied' },
        { operation: 'dashboard', dashboardName: 'Executive Overview', state: 'applied' },
      ],
    });
  });

  it('reserves every artifact before writes and releases them when the second is invalid', async () => {
    const store = artifactStore(['a1']);
    const release = vi.spyOn(store, 'release');

    const result = await callBatch(['a1', 'missing'], { store });

    expect(result.isError).toBe(true);
    expect(bodyOf(result)).toMatchObject({
      applied: false,
      retrySafe: true,
      steps: [
        { artifactId: 'a1', state: 'skipped' },
        { artifactId: 'missing', state: 'failed', retrySafe: true },
        { operation: 'dashboard', state: 'skipped' },
      ],
    });
    expect(release).toHaveBeenCalledOnce();
    expect(applyArtifactModule.applyWorksheetArtifact).not.toHaveBeenCalled();
    expect(composeModule.composeDashboardCore).not.toHaveBeenCalled();
  });

  it('rejects duplicate artifact ids before reserving or writing', async () => {
    const store = artifactStore(['a1']);
    const reserve = vi.spyOn(store, 'reserve');

    const result = await callBatch(['a1', 'a1'], { store });

    expect(result.isError).toBe(true);
    expect(bodyOf(result)).toMatchObject({ applied: false, retrySafe: true });
    expect(reserve).not.toHaveBeenCalled();
    expect(applyArtifactModule.applyWorksheetArtifact).not.toHaveBeenCalled();
    expect(composeModule.composeDashboardCore).not.toHaveBeenCalled();
  });

  it('rejects a session-mismatched artifact before writing', async () => {
    const store = artifactStore(['a1'], { sessionId: 'other-session' });

    const result = await callBatch(['a1'], { store });

    expect(bodyOf(result)).toMatchObject({ applied: false, retrySafe: true });
    expect(applyArtifactModule.applyWorksheetArtifact).not.toHaveBeenCalled();
  });

  it('rejects an artifact from a different Desktop instance before writing', async () => {
    const store = artifactStore(['a1'], { instanceId: 'inst-other' });

    const result = await callBatch(['a1'], { store });

    expect(bodyOf(result)).toMatchObject({ applied: false, retrySafe: true });
    expect(applyArtifactModule.applyWorksheetArtifact).not.toHaveBeenCalled();
    expect(composeModule.composeDashboardCore).not.toHaveBeenCalled();
  });

  it('rejects stale artifact target state before writing', async () => {
    const staleXml = WORKBOOK_XML.replace(
      '</worksheets>',
      '<worksheet name="New A"><table /></worksheet></worksheets>',
    ).replace('</windows>', '<window class="worksheet" name="New A" /></windows>');

    const result = await callBatch(['a1'], { executor: executor(staleXml) });

    expect(bodyOf(result)).toMatchObject({ applied: false, retrySafe: true });
    expect(applyArtifactModule.applyWorksheetArtifact).not.toHaveBeenCalled();
    expect(composeModule.composeDashboardCore).not.toHaveBeenCalled();
  });

  it('rejects a blocking issue in a later artifact before any writes', async () => {
    const store = artifactStore(['a1', 'a2'], {
      worksheetXmls: {
        a2: '<worksheet name="New B"><table><view><filter column="[DS].[none:Category:nk]"><groupfilter function="end" count="0" /></filter></view></table></worksheet>',
      },
    });

    const result = await callBatch(['a1', 'a2'], { store });

    expect(bodyOf(result)).toMatchObject({
      applied: false,
      retrySafe: true,
      steps: [{ state: 'skipped' }, { state: 'failed' }, { state: 'skipped' }],
    });
    expect(applyArtifactModule.applyWorksheetArtifact).not.toHaveBeenCalled();
    expect(composeModule.composeDashboardCore).not.toHaveBeenCalled();
  });

  it('rejects a missing or unrendered explicit worksheet before writing', async () => {
    const missing = await callBatch([], { existingWorksheetNames: ['Missing'] });
    const unrenderedXml = WORKBOOK_XML.replace(
      '</worksheets>',
      '<worksheet name="Unrendered"><table /></worksheet></worksheets>',
    );
    const unrendered = await callBatch([], {
      existingWorksheetNames: ['Unrendered'],
      executor: executor(unrenderedXml),
    });

    expect(bodyOf(missing)).toMatchObject({ applied: false, retrySafe: true });
    expect(bodyOf(unrendered)).toMatchObject({ applied: false, retrySafe: true });
    expect(composeModule.composeDashboardCore).not.toHaveBeenCalled();
  });

  it('includes artifact titles automatically after canonical existing worksheet names', async () => {
    vi.mocked(applyArtifactModule.applyWorksheetArtifact).mockResolvedValue(
      appliedArtifact('a1', 'New A'),
    );
    vi.mocked(composeModule.composeDashboardCore).mockResolvedValue(composedDashboard());

    const result = await callBatch(['a1']);

    expect(result.isError).toBe(false);
    expect(composeModule.composeDashboardCore).toHaveBeenCalledWith(
      expect.objectContaining({ worksheetNames: ['Existing', 'New A'] }),
    );
  });

  it('rejects canonical title collisions before writing', async () => {
    const store = artifactStore(['a1'], { titles: { a1: 'Existi&#110;g' } });

    const result = await callBatch(['a1'], { store });

    expect(bodyOf(result)).toMatchObject({ applied: false, retrySafe: true });
    expect(applyArtifactModule.applyWorksheetArtifact).not.toHaveBeenCalled();
    expect(composeModule.composeDashboardCore).not.toHaveBeenCalled();
  });

  it('rejects a dashboard name that collides with a worksheet before writing', async () => {
    const store = artifactStore(['a1'], { titles: { a1: 'Executive Overview' } });

    const result = await callBatch(['a1'], { store });

    expect(bodyOf(result)).toMatchObject({ applied: false, retrySafe: true });
    expect(applyArtifactModule.applyWorksheetArtifact).not.toHaveBeenCalled();
    expect(composeModule.composeDashboardCore).not.toHaveBeenCalled();
  });

  it('rejects more than six combined worksheets before writing', async () => {
    const result = await callBatch(['a1'], {
      existingWorksheetNames: ['E1', 'E2', 'E3', 'E4', 'E5', 'E6'],
      executor: executor(renderedWorkbook(['E1', 'E2', 'E3', 'E4', 'E5', 'E6'])),
    });

    expect(bodyOf(result)).toMatchObject({ applied: false, retrySafe: true });
    expect(applyArtifactModule.applyWorksheetArtifact).not.toHaveBeenCalled();
    expect(composeModule.composeDashboardCore).not.toHaveBeenCalled();
  });

  it('returns false and retryable when the first apply fails before dispatch', async () => {
    vi.mocked(applyArtifactModule.applyWorksheetArtifact).mockResolvedValue({
      state: 'failed',
      retrySafe: true,
      error: toolError('artifact unavailable'),
    });

    const result = await callBatch(['a1']);

    expect(result.isError).toBe(true);
    expect(bodyOf(result)).toMatchObject({
      applied: false,
      retrySafe: true,
      steps: [
        { state: 'failed', retrySafe: true },
        { operation: 'dashboard', state: 'skipped' },
      ],
    });
    expect(composeModule.composeDashboardCore).not.toHaveBeenCalled();
  });

  it('keeps an earlier worksheet and returns partial when a later apply fails', async () => {
    vi.mocked(applyArtifactModule.applyWorksheetArtifact)
      .mockResolvedValueOnce(appliedArtifact('a1', 'New A'))
      .mockResolvedValueOnce({
        state: 'failed',
        retrySafe: true,
        error: toolError('second artifact unavailable'),
      });

    const result = await callBatch(['a1', 'a2']);

    expect(result.isError).toBe(true);
    expect(bodyOf(result)).toMatchObject({
      applied: 'partial',
      retrySafe: false,
      steps: [
        { state: 'applied', title: 'New A' },
        { state: 'failed', retrySafe: true },
        { state: 'skipped' },
      ],
    });
    expect(composeModule.composeDashboardCore).not.toHaveBeenCalled();
  });

  it('returns unknown on an uncertain apply and never starts a later artifact', async () => {
    const store = artifactStore(['a1', 'a2']);
    const reserve = vi.spyOn(store, 'reserve');
    vi.mocked(applyArtifactModule.applyWorksheetArtifact).mockImplementationOnce(async () => {
      return { state: 'unknown', retrySafe: false, error: toolError('dispatch uncertain') };
    });

    const result = await callBatch(['a1', 'a2'], { store });

    expect(bodyOf(result)).toMatchObject({
      applied: 'unknown',
      retrySafe: false,
      steps: [{ state: 'unknown' }, { artifactId: 'a2', state: 'skipped' }, { state: 'skipped' }],
    });
    expect(applyArtifactModule.applyWorksheetArtifact).toHaveBeenCalledTimes(1);
    expect(reserve).toHaveBeenCalledTimes(2);
    expect(reserve).toHaveBeenCalledWith('a1', '12345');
  });

  it.each(['failed', 'skipped'] as const)(
    'stops as unknown when worksheet verification is %s',
    async (status) => {
      vi.mocked(applyArtifactModule.applyWorksheetArtifact).mockResolvedValue(
        appliedArtifact('a1', 'New A', status),
      );

      const result = await callBatch(['a1']);

      expect(result.isError).toBe(true);
      expect(bodyOf(result)).toMatchObject({
        applied: 'unknown',
        retrySafe: false,
        steps: [{ state: 'unknown', verification: { status } }, { state: 'skipped' }],
      });
      expect(composeModule.composeDashboardCore).not.toHaveBeenCalled();
    },
  );

  it('continues through worksheet verification warnings', async () => {
    vi.mocked(applyArtifactModule.applyWorksheetArtifact).mockResolvedValue(
      appliedArtifact('a1', 'New A', 'warning'),
    );
    vi.mocked(composeModule.composeDashboardCore).mockResolvedValue(composedDashboard());

    const result = await callBatch(['a1']);

    expect(result.isError).toBe(false);
    expect(bodyOf(result)).toMatchObject({
      applied: true,
      steps: [{ state: 'applied', verification: { status: 'warning' } }, { state: 'applied' }],
    });
  });

  it('supports compose-only with existing sheets and hybrid existing/new names', async () => {
    vi.mocked(composeModule.composeDashboardCore).mockResolvedValue(composedDashboard());

    const composeOnly = await callBatch([], {
      existingWorksheetNames: ['Existing A', 'Existing B'],
    });
    expect(composeOnly.isError).toBe(false);
    expect(composeModule.composeDashboardCore).toHaveBeenLastCalledWith(
      expect.objectContaining({ worksheetNames: ['Existing A', 'Existing B'] }),
    );

    vi.mocked(applyArtifactModule.applyWorksheetArtifact).mockResolvedValue(
      appliedArtifact('a1', 'New A'),
    );
    const hybrid = await callBatch(['a1']);
    expect(hybrid.isError).toBe(false);
    expect(composeModule.composeDashboardCore).toHaveBeenLastCalledWith(
      expect.objectContaining({ worksheetNames: ['Existing', 'New A'] }),
    );
  });

  it('bounds ordinary tool errors, verification messages, and the full six-step result', async () => {
    vi.mocked(applyArtifactModule.applyWorksheetArtifact).mockResolvedValueOnce({
      state: 'failed',
      retrySafe: true,
      error: toolError('x'.repeat(2_000)),
    });
    const ordinary = bodyOf(await callBatch(['a1']));
    expect(ordinary.steps[0].error.length).toBeLessThanOrEqual(500);

    vi.mocked(applyArtifactModule.applyWorksheetArtifact).mockResolvedValueOnce(
      appliedArtifact('a1', 'New A', 'warning', 'v'.repeat(2_000)),
    );
    vi.mocked(composeModule.composeDashboardCore).mockResolvedValueOnce(composedDashboard());
    const verification = bodyOf(await callBatch(['a1']));
    expect(verification.steps[0].verification.message.length).toBeLessThanOrEqual(500);

    const longIds = Array.from({ length: 6 }, (_, index) => `${index}-${'i'.repeat(250)}`);
    const store = artifactStore(longIds.slice(0, 5));
    const bounded = bodyOf(await callBatch(longIds, { store }));
    // The Studio SDK truncates large tool payloads; keep the worst preflight result under 8 KiB.
    expect(JSON.stringify(bounded).length).toBeLessThanOrEqual(8 * 1024);

    const sixIds = Array.from({ length: 6 }, (_, index) => `${index}-${'i'.repeat(250)}`);
    const sixTitles = Object.fromEntries(
      sixIds.map((id, index) => [id, `${index}-${'t'.repeat(250)}`]),
    );
    vi.mocked(applyArtifactModule.applyWorksheetArtifact).mockImplementation(
      async ({ artifactId }) =>
        appliedArtifact(artifactId, sixTitles[artifactId]!, 'warning', 'w'.repeat(2_000)),
    );
    vi.mocked(composeModule.composeDashboardCore).mockResolvedValue({
      state: 'applied',
      retrySafe: false,
      receipt: {
        dashboard: 'Executive Overview',
        worksheets: Object.values(sixTitles),
        replaced: false,
        verification: { status: 'passed', issues: [] },
      },
    });
    const successful = bodyOf(
      await callBatch(sixIds, {
        store: artifactStore(sixIds, { titles: sixTitles }),
        existingWorksheetNames: [],
      }),
    );
    expect(JSON.stringify(successful).length).toBeLessThanOrEqual(8 * 1024);
  });

  it('returns partial and non-retryable when compose fails after successful applies', async () => {
    vi.mocked(applyArtifactModule.applyWorksheetArtifact).mockResolvedValue(
      appliedArtifact('a1', 'New A'),
    );
    vi.mocked(composeModule.composeDashboardCore).mockResolvedValue({
      state: 'failed',
      retrySafe: true,
      stage: 'input-validation',
      error: toolError('compose failed'),
    });

    const result = await callBatch(['a1']);

    expect(bodyOf(result)).toMatchObject({
      applied: 'partial',
      retrySafe: false,
      steps: [{ state: 'applied' }, { state: 'failed', stage: 'input-validation' }],
    });
  });

  it('reports an unexpected apply rejection as unknown and preserves earlier receipts', async () => {
    vi.mocked(applyArtifactModule.applyWorksheetArtifact)
      .mockResolvedValueOnce(appliedArtifact('a1', 'New A'))
      .mockRejectedValueOnce(new Error(`unexpected apply ${'x'.repeat(800)}`));

    const result = await callBatch(['a1', 'a2']);
    const body = bodyOf(result);

    expect(result.isError).toBe(true);
    expect(body).toMatchObject({
      applied: 'unknown',
      retrySafe: false,
      steps: [
        { artifactId: 'a1', state: 'applied' },
        { artifactId: 'a2', state: 'unknown', retrySafe: false },
        { state: 'skipped' },
      ],
    });
    expect(body.steps[1].error.length).toBeLessThanOrEqual(500);
    expect(composeModule.composeDashboardCore).not.toHaveBeenCalled();
  });

  it('reports an unexpected compose rejection as unknown after successful applies', async () => {
    vi.mocked(applyArtifactModule.applyWorksheetArtifact).mockResolvedValue(
      appliedArtifact('a1', 'New A'),
    );
    vi.mocked(composeModule.composeDashboardCore).mockRejectedValue(new Error('compose exploded'));

    const result = await callBatch(['a1']);

    expect(result.isError).toBe(true);
    expect(bodyOf(result)).toMatchObject({
      applied: 'unknown',
      retrySafe: false,
      steps: [
        { artifactId: 'a1', state: 'applied' },
        {
          dashboardName: 'Executive Overview',
          state: 'unknown',
          retrySafe: false,
          stage: 'unexpected-error',
          error: 'compose exploded',
        },
      ],
    });
  });

  it('checks abort before the next task and does not start it', async () => {
    const controller = new AbortController();
    vi.mocked(applyArtifactModule.applyWorksheetArtifact).mockImplementationOnce(async () => {
      controller.abort();
      return appliedArtifact('a1', 'New A');
    });

    const result = await callBatch(['a1', 'a2'], {
      signal: controller.signal,
    });

    expect(bodyOf(result)).toMatchObject({
      applied: 'partial',
      retrySafe: false,
      steps: [{ state: 'applied' }, { state: 'aborted' }, { state: 'skipped' }],
    });
    expect(applyArtifactModule.applyWorksheetArtifact).toHaveBeenCalledTimes(1);
    expect(composeModule.composeDashboardCore).not.toHaveBeenCalled();
  });
});

async function callBatch(
  artifactIds: string[],
  options: {
    store?: TemplateArtifactStore;
    signal?: AbortSignal;
    getExecutor?: ReturnType<typeof vi.fn>;
    executor?: ExternalApiToolExecutor;
    existingWorksheetNames?: string[];
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
      gridColumns: undefined,
      ...(options.existingWorksheetNames
        ? { existingWorksheetNames: options.existingWorksheetNames }
        : {}),
    },
    {
      ...getMockRequestHandlerExtra(),
      signal: options.signal ?? new AbortController().signal,
      getExecutor: options.getExecutor ?? vi.fn().mockResolvedValue(options.executor ?? executor()),
    },
  );
}

function appliedArtifact(
  artifactId: string,
  title: string,
  status: 'passed' | 'warning' | 'failed' | 'skipped' = 'passed',
  message?: string,
): applyArtifactModule.WorksheetArtifactOutcome {
  return {
    state: 'applied',
    retrySafe: false,
    receipt: {
      artifactId,
      title,
      verification: {
        ok: status === 'passed' || status === 'warning',
        status,
        ...(message ? { message } : {}),
      },
    },
  };
}

function composedDashboard(): composeModule.ComposeDashboardOutcome {
  return {
    state: 'applied',
    retrySafe: false,
    receipt: {
      dashboard: 'Executive Overview',
      worksheets: ['Existing', 'New A'],
      replaced: false,
      verification: { status: 'passed', issues: [] },
    },
  };
}

function toolError(message: string): McpToolError {
  return new McpToolError({ type: 'test', message, statusCode: 409 });
}

function bodyOf(result: CallToolResult): Record<string, any> {
  invariant(result.content[0]?.type === 'text');
  return JSON.parse(result.content[0].text) as Record<string, any>;
}

function executor(xml = WORKBOOK_XML, instanceId = 'inst-live'): ExternalApiToolExecutor {
  return {
    getWorkbookDocument: vi
      .fn()
      .mockResolvedValue(
        Ok({ xml, applicationVersion: undefined, xsdPayloadVersion: undefined, instanceId }),
      ),
  } as unknown as ExternalApiToolExecutor;
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
      options.worksheetXmls?.[artifactId] ?? `<worksheet name="${title}"><table /></worksheet>`;
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
      windowXml: `<window class="worksheet" name="${title}" />`,
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
  return `<workbook><worksheets>${names
    .map((name) => `<worksheet name="${name}"><table /></worksheet>`)
    .join('')}</worksheets><windows>${names
    .map((name) => `<window class="worksheet" name="${name}" />`)
    .join('')}</windows></workbook>`;
}
