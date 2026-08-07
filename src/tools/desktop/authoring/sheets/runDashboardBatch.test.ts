import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import type { ExternalApiToolExecutor } from '../../../../desktop/externalApi/executorTypes.js';
import * as sessionResolution from '../../../../desktop/session/sessionResolution.js';
import { TemplateArtifactStore } from '../../../../desktop/templates/templateArtifactStore.js';
import { McpToolError } from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer, getDesktopToolListEntry } from '../../../../server.desktop.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import * as applyArtifactModule from '../../api/applyWorksheetArtifact.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import * as composeModule from './composeDashboardCore.js';
import { getRunDashboardBatchTool } from './runDashboardBatch.js';

vi.mock('../../../../desktop/session/sessionResolution.js');
vi.mock('../../api/applyWorksheetArtifact.js');
vi.mock('./composeDashboardCore.js');

const BATCH = {
  dashboardName: 'Executive Overview',
  worksheetNames: ['Existing', 'New A', 'New B'],
  title: 'Executive Overview',
  layoutType: 'columns' as const,
};

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
    expect(schema.safeParse({ session: '12345', ...BATCH, worksheetNames: [] }).success).toBe(
      false,
    );
    const tooLong = 'x'.repeat(256);
    expect(schema.safeParse({ ...BATCH, artifactIds: [tooLong] }).success).toBe(false);
    expect(schema.safeParse({ ...BATCH, dashboardName: tooLong }).success).toBe(false);
    expect(schema.safeParse({ ...BATCH, worksheetNames: [tooLong] }).success).toBe(false);
    expect(schema.safeParse({ ...BATCH, title: tooLong }).success).toBe(false);

    const entry = await getDesktopToolListEntry(tool);
    expect(entry.inputSchema).toMatchObject({
      properties: {
        artifactIds: { type: 'array', items: { type: 'string' } },
        dashboardName: { type: 'string' },
        worksheetNames: { type: 'array', items: { type: 'string' } },
        title: { type: 'string' },
        layoutType: { type: 'string' },
        gridColumns: { type: 'integer' },
      },
      required: expect.arrayContaining(['dashboardName', 'worksheetNames']),
    });
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
    const getExecutor = vi.fn().mockResolvedValue({} as ExternalApiToolExecutor);

    const result = await callBatch(['a1', 'a2'], { getExecutor });

    expect(result.isError).toBe(false);
    expect(order).toEqual(['a1', 'a2', 'compose']);
    expect(getExecutor).toHaveBeenCalledTimes(1);
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
    const store = new TemplateArtifactStore();
    const reserve = vi.spyOn(store, 'reserve');
    vi.mocked(applyArtifactModule.applyWorksheetArtifact).mockImplementationOnce(async (args) => {
      args.store.reserve(args.artifactId, args.sessionId);
      return { state: 'unknown', retrySafe: false, error: toolError('dispatch uncertain') };
    });

    const result = await callBatch(['a1', 'a2'], { store });

    expect(bodyOf(result)).toMatchObject({
      applied: 'unknown',
      retrySafe: false,
      steps: [{ state: 'unknown' }, { artifactId: 'a2', state: 'skipped' }, { state: 'skipped' }],
    });
    expect(applyArtifactModule.applyWorksheetArtifact).toHaveBeenCalledTimes(1);
    expect(reserve).toHaveBeenCalledTimes(1);
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

    const composeOnly = await callBatch([], { worksheetNames: ['Existing A', 'Existing B'] });
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
      expect.objectContaining({ worksheetNames: ['Existing', 'New A', 'New B'] }),
    );
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
    worksheetNames?: string[];
  } = {},
): Promise<CallToolResult> {
  const tool = getRunDashboardBatchTool(new DesktopMcpServer(), { store: options.store });
  const callback = await Provider.from(tool.callback);
  return await callback(
    {
      session: '12345',
      artifactIds,
      ...BATCH,
      gridColumns: undefined,
      ...(options.worksheetNames ? { worksheetNames: options.worksheetNames } : {}),
    },
    {
      ...getMockRequestHandlerExtra(),
      signal: options.signal ?? new AbortController().signal,
      getExecutor: options.getExecutor ?? vi.fn().mockResolvedValue({} as ExternalApiToolExecutor),
    },
  );
}

function appliedArtifact(
  artifactId: string,
  title: string,
  status: 'passed' | 'warning' | 'failed' | 'skipped' = 'passed',
): applyArtifactModule.WorksheetArtifactOutcome {
  return {
    state: 'applied',
    retrySafe: false,
    receipt: {
      artifactId,
      title,
      verification: { ok: status === 'passed' || status === 'warning', status },
    },
  };
}

function composedDashboard(): composeModule.ComposeDashboardOutcome {
  return {
    state: 'applied',
    retrySafe: false,
    receipt: {
      dashboard: 'Executive Overview',
      worksheets: ['Existing', 'New A', 'New B'],
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
