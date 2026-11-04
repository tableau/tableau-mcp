import { Err, Ok, type Result } from 'ts-results-es';

import { makeExecutorMock } from '../externalApi/executor.mock.js';
import { loadDashboardXml } from './loadDashboardXml.js';

const unregistered = vi.hoisted(() => ({ names: [] as string[] }));
vi.mock('./dashboardViewpoints.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./dashboardViewpoints.js')>();
  return {
    ...actual,
    unregisteredDashboardWorksheets: (xml: string, dashboard: string, names: string[]) =>
      unregistered.names.length > 0
        ? unregistered.names
        : actual.unregisteredDashboardWorksheets(xml, dashboard, names),
  };
});

const focus = { navigate: 'none', reason: 'intermediate-leg' } as const;
const signal = new AbortController().signal;
const fragment = (zoneName: string, x = 0): string =>
  `<dashboard name="D"><zones><zone id="1" name="${zoneName}" x="${x}" y="0" w="10" h="10"/></zones><simple-id uuid="dash-1"/></dashboard>`;
const workbook = (dash: string): string =>
  `<workbook><worksheets><worksheet name="A"><table><rows>[ds].[f]</rows></table></worksheet></worksheets>
  <dashboards>${dash}</dashboards><windows><window class="dashboard" name="D"><viewpoints><viewpoint name="A"/></viewpoints></window></windows></workbook>`;

function run(options: {
  afterApply: () => Result<unknown, unknown>;
}): ReturnType<typeof loadDashboardXml> {
  let reads = 0;
  const executor = makeExecutorMock({
    listDashboards: vi.fn().mockResolvedValue(Ok({ dashboards: [{ id: 'dash-1', name: 'D' }] })),
    getDashboardDocument: vi.fn().mockResolvedValue(Ok({ xml: fragment('A') })),
    getWorkbookDocument: vi.fn().mockImplementation(async () => {
      reads++;
      return reads === 1
        ? Ok({ xml: workbook(fragment('A')), instanceId: 'one' })
        : options.afterApply();
    }),
    applyDashboardDocument: vi
      .fn()
      .mockResolvedValue(Ok({ command_id: 'c', status: 'completed', submitted_at: '' })),
  });
  const pending = loadDashboardXml({
    dashboardName: 'D',
    xml: fragment('A', 5),
    verifyReadback: true,
    focus,
    executor,
    signal,
  });
  return pending;
}

const message = (result: Awaited<ReturnType<typeof run>>): string =>
  (result.unwrapErr() as { error: { message: string } }).error.message;

describe('dashboard readback failure reasons', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    unregistered.names = [];
  });
  afterEach(() => vi.useRealTimers());

  it('names the first layout difference after the last read', async () => {
    const pending = run({
      afterApply: () => Ok({ xml: workbook(fragment('A', 0)), instanceId: 'one' }),
    });
    await vi.runAllTimersAsync();
    const text = message(await pending);
    expect(text).toContain('could not be verified on the original Desktop instance.');
    expect(text).toContain(
      'First difference after 8 reads: zone 1 ("A"): x is "0" in Desktop, "5" submitted.',
    );
    expect(text).toContain('do not blindly repeat the apply.');
  });

  it('says Desktop changed instance', async () => {
    const pending = run({
      afterApply: () => Ok({ xml: workbook(fragment('A', 5)), instanceId: 'two' }),
    });
    await vi.runAllTimersAsync();
    expect(message(await pending)).toContain('Desktop is now a different instance');
  });

  it('names worksheets with no registered view', async () => {
    const pending = run({
      afterApply: () => {
        unregistered.names = ['A', 'B'];
        return Ok({ xml: workbook(fragment('A', 5)), instanceId: 'one' });
      },
    });
    await vi.runAllTimersAsync();
    expect(message(await pending)).toContain(
      'Desktop has no view registered for worksheets "A", "B".',
    );
  });

  it('prints unregistered worksheet names as one-line quoted values', async () => {
    const pending = run({
      afterApply: () => {
        unregistered.names = ['say "hi"\nnow'];
        return Ok({ xml: workbook(fragment('A', 5)), instanceId: 'one' });
      },
    });
    await vi.runAllTimersAsync();
    expect(message(await pending)).toContain(
      'Desktop has no view registered for worksheet "say \\"hi\\"\\nnow".',
    );
  });

  it('says the readback failed when the workbook read errors', async () => {
    const pending = run({
      afterApply: () => Err({ type: 'command-timed-out', error: 'late' }),
    });
    await vi.runAllTimersAsync();
    expect(message(await pending)).toContain(
      'Reading the workbook back from Desktop failed (command-timed-out).',
    );
  });
});
