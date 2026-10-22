import { Err, Ok } from 'ts-results-es';

import * as loggerModule from '../../logging/logger.js';
import { makeExecutorMock } from '../externalApi/executor.mock.js';
import type { ExternalApiToolExecutor } from '../externalApi/executorTypes.js';
import { type ApplyFocus, dispatchApplyFocus } from './applyFocus.js';

describe('dispatchApplyFocus Start Page hide', () => {
  const signal = new AbortController().signal;

  function workbookDoc(maximized: string | undefined): string {
    return (
      "<?xml version='1.0'?><workbook>" +
      '<worksheets><worksheet name="Sheet 1"><table /></worksheet><worksheet name="Sheet 2"><table /></worksheet></worksheets>' +
      '<windows>' +
      ['Sheet 1', 'Sheet 2']
        .map(
          (name) =>
            `<window class="worksheet" name="${name}"${name === maximized ? ' maximized="true"' : ''}/>`,
        )
        .join('') +
      '</windows></workbook>'
    );
  }

  // Desktop lands on Sheet 1 after the POST; a navigation moves the live active sheet.
  function recordingExecutor(
    options: {
      desktopApiVersion?: string | undefined;
      setStartPageVisibility?: ExternalApiToolExecutor['setStartPageVisibility'];
      gotoLands?: boolean;
    } = {},
  ): { executor: ExternalApiToolExecutor; calls: string[] } {
    const { setStartPageVisibility, gotoLands = true } = options;
    const desktopApiVersion = Object.hasOwn(options, 'desktopApiVersion')
      ? options.desktopApiVersion
      : '0.2.11';
    const calls: string[] = [];
    let active = 'Sheet 1';
    const executor = makeExecutorMock({
      desktopApiVersion,
      setStartPageVisibility: vi.fn(async (isStartPageVisible: boolean, s: AbortSignal) => {
        calls.push(`start-page:${isStartPageVisible}`);
        return setStartPageVisibility
          ? await setStartPageVisibility(isStartPageVisible, s)
          : Ok({ isStartPageVisible });
      }),
      getWorkbook: vi.fn(async () => {
        calls.push('read');
        return Ok({
          title: 'Book',
          unsavedChanges: false,
          worksheets: ['Sheet 1', 'Sheet 2'].map((name) => ({
            id: `id-${name}`,
            name,
            hidden: false,
            isActiveSheet: name === active,
          })),
        });
      }),
      goToSheet: vi.fn(async (sheetId: string) => {
        const name = sheetId.replace('id-', '');
        calls.push(`goto:${name}`);
        if (gotoLands) {
          active = name;
        }
        return Ok({ command_id: 'goto', status: 'completed' as const, submitted_at: '' });
      }),
    });
    return { executor, calls };
  }

  async function dispatch(
    executor: ExternalApiToolExecutor,
    focus: ApplyFocus,
    postedXml = workbookDoc('Sheet 2'),
  ): Promise<void> {
    await dispatchApplyFocus({ focus, postedXml, executor, signal });
  }

  beforeEach(() => {
    vi.spyOn(loggerModule, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hides the Start Page before navigating to the artifact', async () => {
    const { executor, calls } = recordingExecutor();

    await dispatch(executor, { navigate: 'artifact', sheetName: 'Sheet 2' });

    expect(executor.setStartPageVisibility).toHaveBeenCalledExactlyOnceWith(false, signal);
    expect(calls).toEqual(['start-page:false', 'read', 'read', 'goto:Sheet 2', 'read']);
  });

  it('navigates by the sheet id the inventory reports for the target name', async () => {
    const { executor } = recordingExecutor();

    await dispatch(executor, { navigate: 'artifact', sheetName: 'Sheet 2' });

    expect(executor.goToSheet).toHaveBeenCalledExactlyOnceWith('id-Sheet 2', signal);
  });

  it('dispatches nothing when the target is already the active sheet', async () => {
    const { executor, calls } = recordingExecutor();

    await dispatch(executor, { navigate: 'artifact', sheetName: 'Sheet 1' });

    expect(executor.goToSheet).not.toHaveBeenCalled();
    expect(calls).toEqual(['start-page:false', 'read', 'read']);
  });

  it('reissues once when the first navigation does not land', async () => {
    const { executor, calls } = recordingExecutor({ gotoLands: false });

    await dispatch(executor, { navigate: 'artifact', sheetName: 'Sheet 2' });

    expect(calls).toEqual([
      'start-page:false',
      'read',
      'read',
      'goto:Sheet 2',
      'read',
      'goto:Sheet 2',
    ]);
  });

  it('skips navigation when the target is absent from the inventory', async () => {
    const { executor, calls } = recordingExecutor();

    await dispatch(executor, { navigate: 'artifact', sheetName: 'Missing' });

    expect(executor.goToSheet).not.toHaveBeenCalled();
    expect(calls).toEqual(['start-page:false', 'read']);
    expect(loggerModule.log).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warning',
        message: 'Focus skipped; target is absent from the post-apply workbook read',
        data: expect.objectContaining({ availableSheets: ['Sheet 1', 'Sheet 2'] }),
      }),
    );
  });

  it('logs and skips navigation when the workbook read fails', async () => {
    const error = { type: 'command-timed-out' as const, error: 'read timed out' };
    const { executor } = recordingExecutor();
    vi.mocked(executor.getWorkbook).mockResolvedValue(Err(error));

    await dispatch(executor, { navigate: 'artifact', sheetName: 'Sheet 2' });

    expect(executor.goToSheet).not.toHaveBeenCalled();
    expect(loggerModule.log).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Focus skipped; could not re-read the applied workbook',
        data: expect.objectContaining({ error }),
      }),
    );
  });

  it('logs and does not reissue when goToSheet fails', async () => {
    const error = { type: 'command-timed-out' as const, error: 'goto timed out' };
    const { executor } = recordingExecutor();
    vi.mocked(executor.goToSheet).mockResolvedValue(Err(error));

    await dispatch(executor, { navigate: 'artifact', sheetName: 'Sheet 2' });

    expect(executor.goToSheet).toHaveBeenCalledTimes(1);
    expect(loggerModule.log).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'goToSheet failed; the apply itself remains successful',
        data: expect.objectContaining({ error }),
      }),
    );
  });

  it('hides the Start Page before restoring the pre-apply sheet', async () => {
    const { executor, calls } = recordingExecutor();

    await dispatch(executor, { navigate: 'restore' });

    expect(executor.setStartPageVisibility).toHaveBeenCalledExactlyOnceWith(false, signal);
    expect(calls).toEqual(['start-page:false', 'read', 'read', 'goto:Sheet 2', 'read']);
  });

  it('hides the Start Page on a restore whose posted document names no active window', async () => {
    const { executor, calls } = recordingExecutor();

    await dispatch(executor, { navigate: 'restore' }, workbookDoc(undefined));

    expect(executor.setStartPageVisibility).toHaveBeenCalledExactlyOnceWith(false, signal);
    expect(calls).toEqual(['start-page:false']);
  });

  it.each([{ reason: 'intermediate-leg' as const }, { reason: 'no-live-write' as const }])(
    'leaves the Start Page alone for navigate none ($reason)',
    async ({ reason }) => {
      const { executor, calls } = recordingExecutor();

      await dispatch(executor, { navigate: 'none', reason });

      expect(executor.setStartPageVisibility).not.toHaveBeenCalled();
      expect(calls).toEqual([]);
    },
  );

  it.each([
    { desktopApiVersion: '0.2.10' },
    { desktopApiVersion: '0.1.0' },
    { desktopApiVersion: undefined },
  ])(
    'skips the hide below the Start Page API floor ($desktopApiVersion) and still navigates',
    async ({ desktopApiVersion }) => {
      const { executor, calls } = recordingExecutor({ desktopApiVersion });

      await dispatch(executor, { navigate: 'artifact', sheetName: 'Sheet 2' });

      expect(executor.setStartPageVisibility).not.toHaveBeenCalled();
      expect(calls).toEqual(['read', 'read', 'goto:Sheet 2', 'read']);
    },
  );

  it('keeps navigating and logs when the hide returns Err', async () => {
    const error = { type: 'command-timed-out' as const, error: 'start page timeout' };
    const { executor, calls } = recordingExecutor({
      setStartPageVisibility: async () => Err(error),
    });

    await expect(
      dispatch(executor, { navigate: 'artifact', sheetName: 'Sheet 2' }),
    ).resolves.toBeUndefined();

    expect(calls).toEqual(['start-page:false', 'read', 'read', 'goto:Sheet 2', 'read']);
    expect(loggerModule.log).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warning',
        message: 'Start Page hide failed; the apply itself remains successful',
        data: expect.objectContaining({ error }),
      }),
    );
  });

  it('keeps navigating and logs when the hide throws', async () => {
    const thrown = new Error('socket hang up');
    const { executor, calls } = recordingExecutor({
      setStartPageVisibility: async () => {
        throw thrown;
      },
    });

    await expect(dispatch(executor, { navigate: 'restore' })).resolves.toBeUndefined();

    expect(calls).toEqual(['start-page:false', 'read', 'read', 'goto:Sheet 2', 'read']);
    expect(loggerModule.log).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warning',
        message: 'Start Page hide threw; the apply itself remains successful',
        data: expect.objectContaining({ error: thrown }),
      }),
    );
  });

  it('uses the default executor mock without awaiting undefined', async () => {
    const executor = makeExecutorMock({
      desktopApiVersion: '0.2.16',
      getWorkbook: vi.fn(async () =>
        Ok({
          title: 'Book',
          unsavedChanges: false,
          worksheets: [{ id: 'id-Sheet 2', name: 'Sheet 2', hidden: false, isActiveSheet: true }],
        }),
      ),
    });

    await dispatch(executor, { navigate: 'artifact', sheetName: 'Sheet 2' });

    expect(executor.setStartPageVisibility).toHaveBeenCalledExactlyOnceWith(false, signal);
    expect(loggerModule.log).not.toHaveBeenCalled();
  });
});
