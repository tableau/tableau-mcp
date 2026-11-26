import { ConfirmationPreStateForbiddenError } from '../../../errors/mcpToolError.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { FLOW_RUN_PRE_STATE_WINDOW, resolveFlowRunPreState } from './flowRunPreState.js';

const FLOW_ID = 'd00700fe-28a0-4ece-a7af-5543ddf38a82';

function makeRestApi(getFlowRuns: ReturnType<typeof vi.fn>): RestApi {
  return { siteId: 'test-site-id', flowsMethods: { getFlowRuns } } as unknown as RestApi;
}

describe('resolveFlowRunPreState', () => {
  it('queries the newest runs of this flow in a fixed window', async () => {
    const getFlowRuns = vi.fn().mockResolvedValue([]);
    await resolveFlowRunPreState(makeRestApi(getFlowRuns), FLOW_ID);
    expect(getFlowRuns).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filter: `flowId:eq:${FLOW_ID}`,
      sort: 'completedAt:desc',
      pageSize: FLOW_RUN_PRE_STATE_WINDOW,
      pageNumber: 1,
    });
  });

  // Live-probed: a never-run flow returns an empty list (not a 404).
  it('returns a stable fingerprint for a flow that has never run (empty list)', async () => {
    const getFlowRuns = vi.fn().mockResolvedValue([]);
    const first = await resolveFlowRunPreState(makeRestApi(getFlowRuns), FLOW_ID);
    const second = await resolveFlowRunPreState(makeRestApi(getFlowRuns), FLOW_ID);
    expect(first).toBe(second);
    expect(first).toBe(JSON.stringify({ flowId: FLOW_ID, runs: '' }));
  });

  it('differs once the flow has a run (a confirm after the first run is rejected)', async () => {
    const empty = await resolveFlowRunPreState(makeRestApi(vi.fn().mockResolvedValue([])), FLOW_ID);
    const oneRun = await resolveFlowRunPreState(
      makeRestApi(vi.fn().mockResolvedValue([{ id: 'run-a', status: 'Pending' }])),
      FLOW_ID,
    );
    expect(oneRun).not.toBe(empty);
  });

  it('ignores status changes of existing runs (Pending -> InProgress -> Success)', async () => {
    const fingerprintFor = (status: string): Promise<string> =>
      resolveFlowRunPreState(
        makeRestApi(
          vi.fn().mockResolvedValue([
            { id: 'run-a', status },
            { id: 'run-b', status: 'Success' },
          ]),
        ),
        FLOW_ID,
      );
    const pending = await fingerprintFor('Pending');
    expect(await fingerprintFor('InProgress')).toBe(pending);
    expect(await fingerprintFor('Success')).toBe(pending);
  });

  it('differs when a new run id appears', async () => {
    const before = await resolveFlowRunPreState(
      makeRestApi(vi.fn().mockResolvedValue([{ id: 'run-a', status: 'Success' }])),
      FLOW_ID,
    );
    const after = await resolveFlowRunPreState(
      makeRestApi(
        vi.fn().mockResolvedValue([
          { id: 'run-new', status: 'Pending' },
          { id: 'run-a', status: 'Success' },
        ]),
      ),
      FLOW_ID,
    );
    expect(after).not.toBe(before);
  });

  it('is order-independent', async () => {
    const runs = [
      { id: 'run-b', status: 'Success' },
      { id: 'run-a', status: 'Failed' },
    ];
    const a = await resolveFlowRunPreState(makeRestApi(vi.fn().mockResolvedValue(runs)), FLOW_ID);
    const b = await resolveFlowRunPreState(
      makeRestApi(vi.fn().mockResolvedValue([...runs].reverse())),
      FLOW_ID,
    );
    expect(a).toBe(b);
  });

  it('propagates a lookup failure (fail closed)', async () => {
    const getFlowRuns = vi.fn().mockRejectedValue(new Error('lookup failed'));
    await expect(resolveFlowRunPreState(makeRestApi(getFlowRuns), FLOW_ID)).rejects.toThrow(
      'lookup failed',
    );
  });

  it.each([401, 403])(
    'rethrows a %i as a ConfirmationPreStateForbiddenError naming tableau:flow_runs:read',
    async (status) => {
      const error = Object.assign(new Error(`Request failed with status code ${status}`), {
        isAxiosError: true,
        response: { status },
      });
      const promise = resolveFlowRunPreState(
        makeRestApi(vi.fn().mockRejectedValue(error)),
        FLOW_ID,
      );
      await expect(promise).rejects.toBeInstanceOf(ConfirmationPreStateForbiddenError);
      await expect(promise).rejects.toMatchObject({
        statusCode: status,
        requiredScopes: ['tableau:flow_runs:read'],
      });
    },
  );

  it('propagates a non-auth failure unchanged (fail closed)', async () => {
    const error = new Error('lookup failed');
    await expect(
      resolveFlowRunPreState(makeRestApi(vi.fn().mockRejectedValue(error)), FLOW_ID),
    ).rejects.toBe(error);
  });
});
