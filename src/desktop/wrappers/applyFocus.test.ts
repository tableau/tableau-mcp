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

  // Desktop lands on Sheet 1 after the POST; a goto moves the live document.
  function recordingExecutor(
    options: {
      desktopApiVersion?: string | undefined;
      setStartPageVisibility?: ExternalApiToolExecutor['setStartPageVisibility'];
    } = {},
  ): { executor: ExternalApiToolExecutor; calls: string[] } {
    const { setStartPageVisibility } = options;
    const desktopApiVersion = Object.hasOwn(options, 'desktopApiVersion')
      ? options.desktopApiVersion
      : '0.2.11';
    const calls: string[] = [];
    let maximized = 'Sheet 1';
    const executor = makeExecutorMock({
      desktopApiVersion,
      setStartPageVisibility: vi.fn(async (isStartPageVisible: boolean, s: AbortSignal) => {
        calls.push(`start-page:${isStartPageVisible}`);
        return setStartPageVisibility
          ? await setStartPageVisibility(isStartPageVisible, s)
          : Ok({ isStartPageVisible });
      }),
      getWorkbookDocument: vi.fn(async () => {
        calls.push('read');
        return Ok({
          xml: workbookDoc(maximized),
          applicationVersion: undefined,
          xsdPayloadVersion: undefined,
        });
      }),
      getWorkbook: vi.fn(async () =>
        Ok({
          title: 'Book',
          unsavedChanges: false,
          worksheets: ['Sheet 1', 'Sheet 2'].map((name) => ({
            id: `id-${name}`,
            name,
            hidden: false,
          })),
        }),
      ),
      goToSheet: vi.fn(async (sheetId: string) => {
        maximized = sheetId.replace('id-', '');
        calls.push(`goto:${maximized}`);
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
    expect(calls).toEqual(['start-page:false', 'read', 'goto:Sheet 2', 'read']);
  });

  it('hides the Start Page before restoring the pre-apply sheet', async () => {
    const { executor, calls } = recordingExecutor();

    await dispatch(executor, { navigate: 'restore' });

    expect(executor.setStartPageVisibility).toHaveBeenCalledExactlyOnceWith(false, signal);
    expect(calls).toEqual(['start-page:false', 'read', 'goto:Sheet 2', 'read']);
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
      expect(calls).toEqual(['read', 'goto:Sheet 2', 'read']);
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

    expect(calls).toEqual(['start-page:false', 'read', 'goto:Sheet 2', 'read']);
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

    expect(calls).toEqual(['start-page:false', 'read', 'goto:Sheet 2', 'read']);
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
      getWorkbookDocument: vi.fn(async () =>
        Ok({
          xml: workbookDoc('Sheet 2'),
          applicationVersion: undefined,
          xsdPayloadVersion: undefined,
        }),
      ),
    });

    await dispatch(executor, { navigate: 'artifact', sheetName: 'Sheet 2' });

    expect(executor.setStartPageVisibility).toHaveBeenCalledExactlyOnceWith(false, signal);
    expect(loggerModule.log).not.toHaveBeenCalled();
  });
});
