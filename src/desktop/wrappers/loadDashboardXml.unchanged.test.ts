import { Err, Ok } from 'ts-results-es';

import { makeExecutorMock } from '../externalApi/executor.mock.js';
import {
  readbackReflowDashboard,
  REFLOW_DASHBOARD_ID,
  REFLOW_DASHBOARD_NAME,
  reflowWorkbook,
  submittedReflowDashboard,
} from './dashboardReflowFixtures.js';
import { loadDashboardXml, loadStoryboardXml } from './loadDashboardXml.js';
import { READBACK_POLL_MAX_ATTEMPTS } from './pollReadback.js';

const focus = { navigate: 'none', reason: 'intermediate-leg' } as const;
const signal = new AbortController().signal;

const flow = (zones: Array<{ id: string; y: number; h: number }>): string =>
  `<dashboard name='D'><zones><zone id='1' type-v2='layout-flow' param='vert'>${zones
    .map(
      (z) =>
        `<zone id='${z.id}' type-v2='text' x='0' y='${z.y}' w='100000' h='${z.h}'><formatted-text/></zone>`,
    )
    .join('')}</zone></zones><simple-id uuid='dash-1'/></dashboard>`;

const live = flow([
  { id: '2', y: 0, h: 50000 },
  { id: '3', y: 50000, h: 50000 },
]);
const moved = flow([
  { id: '2', y: 0, h: 30000 },
  { id: '3', y: 30000, h: 70000 },
]);
const reordered = flow([
  { id: '3', y: 50000, h: 50000 },
  { id: '2', y: 0, h: 50000 },
]);

const applyOk = Ok({ command_id: 'apply', status: 'completed' as const, submitted_at: '' });

function setup(
  reads: Array<string | 'error' | 'fatal'>,
  kind: 'dashboard' | 'storyboard' = 'dashboard',
  initial: string = live,
  warnings: Array<{ code: string; message: string }> = [],
): {
  executor: ReturnType<typeof makeExecutorMock>;
  postApplyReads: () => number;
} {
  let postApplyReads = 0;
  let applied = false;
  const read = vi.fn().mockImplementation(async () => {
    if (!applied) return Ok({ xml: initial });
    const next = reads[Math.min(postApplyReads++, reads.length - 1)];
    if (next === 'fatal') {
      return Err({
        type: 'command-failed',
        error: { code: 'E71AE512', message: 'Internal Error', recoverable: false },
      });
    }
    return next === 'error'
      ? Err({ type: 'invalid-response', error: new Error('boom') })
      : Ok({ xml: next });
  });
  const apply = vi.fn().mockImplementation(async () => {
    applied = true;
    return Ok({ ...applyOk.value, warnings });
  });
  const executor = makeExecutorMock(
    kind === 'dashboard'
      ? {
          listDashboards: vi
            .fn()
            .mockResolvedValue(Ok({ dashboards: [{ id: 'dash-1', name: 'D' }] })),
          getDashboardDocument: read,
          applyDashboardDocument: apply,
        }
      : {
          listStoryboards: vi
            .fn()
            .mockResolvedValue(Ok({ storyboards: [{ id: 'dash-1', name: 'D' }] })),
          getStoryboardDocument: read,
          applyStoryboardDocument: apply,
        },
  );
  return { executor, postApplyReads: () => postApplyReads };
}

async function run(
  executor: ReturnType<typeof makeExecutorMock>,
  xml: string,
  kind: 'dashboard' | 'storyboard' = 'dashboard',
): Promise<Awaited<ReturnType<typeof loadDashboardXml>>> {
  const pending =
    kind === 'dashboard'
      ? loadDashboardXml({
          dashboardName: 'D',
          xml,
          executor,
          signal,
          focus,
          requireExistingSheet: true,
        })
      : loadStoryboardXml({
          storyboardName: 'D',
          xml,
          executor,
          signal,
          focus,
          requireExistingSheet: true,
        });
  await vi.runAllTimersAsync();
  return pending;
}

describe('apply Desktop accepted but did not change', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fails when only y/h move in a flow container and Desktop never changes', async () => {
    const { executor, postApplyReads } = setup([live]);
    const result = await run(executor, moved);
    expect(result.isErr()).toBe(true);
    const message = (result.unwrapErr() as { error: { type: string; message: string } }).error;
    expect(message.type).toBe('verification-failed');
    expect(message.message).toContain('had not changed');
    expect(message.message).toContain('Desktop may have dropped or recomputed the change');
    expect(message.message).toContain('get-dashboard-xml');
    expect(message.message).toContain('If you changed only x, y, w or h');
    expect(message.message).toContain('layout-flow and layout-basic containers');
    expect(message.message).toContain('To reorder zones, move the whole <zone> elements.');
    expect(message.message).toContain(`after ${READBACK_POLL_MAX_ATTEMPTS} reads`);
    expect(postApplyReads()).toBe(READBACK_POLL_MAX_ATTEMPTS);
  });

  it('passes with exactly one post-apply read when Desktop changes at once', async () => {
    const { executor, postApplyReads } = setup([moved]);
    const result = await run(executor, moved);
    expect(result.isOk()).toBe(true);
    expect(postApplyReads()).toBe(1);
  });

  it('passes when Desktop changes on the third read', async () => {
    const { executor, postApplyReads } = setup([live, live, moved]);
    const result = await run(executor, moved);
    expect(result.isOk()).toBe(true);
    expect(postApplyReads()).toBe(3);
  });

  it('passes an idempotent re-apply that differs in attribute order, whitespace and Desktop extras', async () => {
    const desktopLive = `<dashboard name='D' extra='1'><zones><zone id='1' type-v2='layout-flow' param='vert'><layout-cache/>
      <zone id='2' type-v2='text' x='0' y='0' w='100000' h='50000'><formatted-text/><zone-style/></zone>
      <zone id='3' type-v2='text' x='0' y='50000' w='100000' h='50000'><formatted-text/><zone-style/></zone></zone></zones><simple-id uuid='dash-1'/></dashboard>`;
    const submitted = `<dashboard name='D'>
      <zones>
        <zone param='vert' type-v2='layout-flow' id='1'>
          <zone h='50000' w='100000' y='0' x='0' type-v2='text' id='2'><formatted-text/></zone>
          <zone h='50000' w='100000' y='50000' x='0' type-v2='text' id='3'><formatted-text/></zone>
        </zone>
      </zones>
      <simple-id uuid='dash-1'/>
    </dashboard>`;
    const { executor, postApplyReads } = setup([desktopLive], 'dashboard', desktopLive);
    const result = await run(executor, submitted);
    expect(result.isOk()).toBe(true);
    expect(postApplyReads()).toBe(0);
  });

  it('passes a byte-identical re-apply', async () => {
    const { executor, postApplyReads } = setup([live]);
    const result = await run(executor, live);
    expect(result.isOk()).toBe(true);
    expect(postApplyReads()).toBe(0);
  });

  it('skips the readback for a contained submission even if Desktop would change the document', async () => {
    const { executor, postApplyReads } = setup([moved]);
    const result = await run(executor, live);
    expect(result.isOk()).toBe(true);
    expect(postApplyReads()).toBe(0);
  });

  it('does not fail an apply that landed when the readback errors', async () => {
    const { executor, postApplyReads } = setup(['error']);
    const result = await run(executor, moved);
    expect(result.isOk()).toBe(true);
    expect(postApplyReads()).toBe(1);
  });

  it('surfaces a session-fatal no-change readback instead of warning and succeeding', async () => {
    const { executor, postApplyReads } = setup(['fatal']);
    const pending = loadDashboardXml({
      dashboardName: 'D',
      xml: moved,
      executor,
      signal,
      focus,
      requireExistingSheet: true,
    });
    const assertion = expect(pending).rejects.toMatchObject({ type: 'desktop-session-fatal' });
    await vi.runAllTimersAsync();
    await assertion;
    expect(postApplyReads()).toBe(1);
    expect(executor.applyDashboardDocument).toHaveBeenCalledTimes(1);
  });

  it('keeps the warnings result, with no post-apply reads, when Desktop dropped part of the submission', async () => {
    const zone = "<zone id='1' type-v2='layout-basic' x='0' y='0' w='100000' h='100000'/>";
    const warned = `<dashboard name='D'><zones>${zone}</zones><simple-id uuid='dash-1'/></dashboard>`;
    const submitted = `<dashboard name='D'><zones>${zone}<zone id='9' type-v2='bogus'/></zones><simple-id uuid='dash-1'/></dashboard>`;
    const warnings = [{ code: 'node-dropped', message: "Dropped <zone id='9'>" }];
    const { executor, postApplyReads } = setup([warned], 'dashboard', warned, warnings);
    const result = await run(executor, submitted);
    expect(result.unwrap().documentWarnings).toEqual(warnings);
    expect(postApplyReads()).toBe(0);
  });

  it('fails a storyboard apply Desktop ignores, in storyboard wording', async () => {
    const { executor } = setup([live], 'storyboard');
    const result = await run(executor, moved, 'storyboard');
    const error = (result.unwrapErr() as { error: { type: string; message: string } }).error;
    expect(error.type).toBe('verification-failed');
    expect(error.message).toContain('storyboard apply for "D"');
    expect(error.message).toContain('the storyboard had not changed');
    expect(error.message).toContain('Desktop may have dropped or recomputed the change');
    expect(error.message).toContain('get-storyboard-xml');
    expect(error.message).not.toContain('If you changed only');
    expect(error.message).not.toContain('layout-');
  });

  it('adds no dashboard reads when readback is already requested', async () => {
    const empty = `<dashboard name="${REFLOW_DASHBOARD_NAME}"><zones/><simple-id uuid="${REFLOW_DASHBOARD_ID}"/></dashboard>`;
    let liveWorkbook = reflowWorkbook(empty, false);
    const getDashboardDocument = vi.fn().mockResolvedValue(Ok({ xml: empty }));
    const executor = makeExecutorMock({
      desktopApiVersion: '0.2.22',
      listDashboards: vi
        .fn()
        .mockResolvedValue(
          Ok({ dashboards: [{ id: REFLOW_DASHBOARD_ID, name: REFLOW_DASHBOARD_NAME }] }),
        ),
      getDashboardDocument,
      getWorkbookDocument: vi.fn().mockImplementation(async () => Ok({ xml: liveWorkbook })),
      applyDashboardDocument: vi.fn().mockImplementation(async () => {
        liveWorkbook = reflowWorkbook(readbackReflowDashboard);
        return applyOk;
      }),
    });
    const pending = loadDashboardXml({
      dashboardName: REFLOW_DASHBOARD_NAME,
      xml: submittedReflowDashboard,
      requireExistingSheet: true,
      verifyReadback: true,
      focus,
      executor,
      signal,
    });
    await vi.runAllTimersAsync();
    expect((await pending).isOk()).toBe(true);
    expect(getDashboardDocument).toHaveBeenCalledTimes(1);
  });

  function reflowVerifyRun(postApplyRead: () => ReturnType<typeof Err> | ReturnType<typeof Ok>): {
    executor: ReturnType<typeof makeExecutorMock>;
    pending: ReturnType<typeof loadDashboardXml>;
  } {
    const empty = `<dashboard name="${REFLOW_DASHBOARD_NAME}"><zones/><simple-id uuid="${REFLOW_DASHBOARD_ID}"/></dashboard>`;
    let applied = false;
    const getWorkbookDocument = vi
      .fn()
      .mockImplementation(async () =>
        applied ? postApplyRead() : Ok({ xml: reflowWorkbook(empty, false) }),
      );
    const executor = makeExecutorMock({
      desktopApiVersion: '0.2.22',
      listDashboards: vi
        .fn()
        .mockResolvedValue(
          Ok({ dashboards: [{ id: REFLOW_DASHBOARD_ID, name: REFLOW_DASHBOARD_NAME }] }),
        ),
      getDashboardDocument: vi.fn().mockResolvedValue(Ok({ xml: empty })),
      getWorkbookDocument,
      applyDashboardDocument: vi.fn().mockImplementation(async () => {
        applied = true;
        return applyOk;
      }),
    });
    const pending = loadDashboardXml({
      dashboardName: REFLOW_DASHBOARD_NAME,
      xml: submittedReflowDashboard,
      requireExistingSheet: true,
      verifyReadback: true,
      focus,
      executor,
      signal,
    });
    return { executor, pending };
  }

  it('surfaces a session-fatal verification readback instead of verification-failed', async () => {
    const { executor, pending } = reflowVerifyRun(() =>
      Err({
        type: 'command-failed',
        error: { code: 'E71AE512', message: 'Internal Error', recoverable: false },
      }),
    );
    const assertion = expect(pending).rejects.toMatchObject({ type: 'desktop-session-fatal' });
    await vi.runAllTimersAsync();
    await assertion;
    expect(executor.getWorkbookDocument).toHaveBeenCalledTimes(2);
    expect(executor.applyDashboardDocument).toHaveBeenCalledTimes(1);
  });

  it('keeps verification-failed for a non-fatal verification readback error', async () => {
    const { pending } = reflowVerifyRun(() =>
      Err({ type: 'invalid-response', error: new Error('boom') }),
    );
    await vi.runAllTimersAsync();
    const error = (await pending).unwrapErr() as { error: { type: string; message: string } };
    expect(error.error.type).toBe('verification-failed');
    expect(error.error.message).toContain(
      'Reading the workbook back from Desktop failed (invalid-response).',
    );
  });

  it('fails when the elements are reordered but Desktop never changes', async () => {
    const { executor } = setup([live]);
    const result = await run(executor, reordered);
    const error = (result.unwrapErr() as { error: { type: string } }).error;
    expect(error.type).toBe('verification-failed');
  });
});
