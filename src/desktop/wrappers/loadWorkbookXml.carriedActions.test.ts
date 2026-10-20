import { Err, Ok } from 'ts-results-es';

import * as loggerModule from '../../logging/logger.js';
import { makeExecutorMock } from '../externalApi/executor.mock.js';
import { ExternalApiToolExecutor } from '../externalApi/executorTypes.js';
import { captureTargetWorksheetState } from '../metadata/targetWorksheetState.js';
import { parseActions } from '../metadata/workbookActions.js';
import * as validationRegistry from '../validation/registry.js';
import { loadWorkbookXml, resetActionHandlingMemo } from './loadWorkbookXml.js';
import { loadWorksheetXml } from './loadWorksheetXml.js';

const NO_FOCUS = { navigate: 'none', reason: 'intermediate-leg' } as const;
const signal = new AbortController().signal;

const action = (n: number, url = 'https://example.com/'): string =>
  `<action caption='A${n}' name='[Action${n}]'><activation type='on-select' /><source type='sheet' worksheet='A' /><link caption='' expression='${url}${n}' /></action>`;

const workbook = (actions: string[]): string =>
  `<?xml version='1.0' encoding='utf-8'?><workbook><datasources><datasource name='ds' /></datasources>${
    actions.length ? `<actions>${actions.join('')}</actions>` : ''
  }<worksheets><worksheet name='A'><table /></worksheet></worksheets><windows><window class='worksheet' name='A' /></windows></workbook>`;

type Behavior = 'append' | 'replace' | 'stale-replace';

// Models a Desktop whose whole-workbook POST appends to, or replaces, the live action list.
function fakeDesktop(
  behavior: Behavior,
  initialActions: string[],
  instanceId: string | undefined = `inst-${behavior}`,
  desktopApiVersion?: string,
): {
  executor: ExternalApiToolExecutor;
  posted: string[];
  applyWorkbookDocument: ReturnType<typeof vi.fn>;
  liveNames: () => string[];
  liveXml: () => string;
} {
  let live = workbook(initialActions);
  let stalePending: string | undefined;
  const posted: string[] = [];
  const getWorkbookDocument = vi.fn(async (_signal?: AbortSignal) => {
    const xml = stalePending ?? live;
    stalePending = undefined;
    return Ok({ xml, applicationVersion: undefined, xsdPayloadVersion: undefined });
  });
  const applyWorkbookDocument = vi.fn(async (xml: string) => {
    posted.push(xml);
    const before = live;
    const incoming = parseActions(xml).actions.map((a) => a.xml);
    if (behavior === 'append') {
      const liveNames = new Set(parseActions(live).actions.map((a) => a.name));
      const merged = [...parseActions(live).actions.map((a) => a.xml)];
      parseActions(xml).actions.forEach((a) => {
        merged.push(
          liveNames.has(a.name) ? a.xml.replace(a.name, `${a.name.slice(0, -1)}_GUID]`) : a.xml,
        );
      });
      live = workbook(merged);
    } else {
      live = workbook(incoming);
      if (behavior === 'stale-replace') stalePending = before;
    }
    return Ok({ command_id: 'c', status: 'completed' as const, submitted_at: '' });
  });
  const executor = makeExecutorMock({
    getWorkbookDocument,
    applyWorkbookDocument,
    desktopInstanceId: instanceId,
    desktopApiVersion,
  });
  return {
    executor,
    posted,
    applyWorkbookDocument,
    liveNames: () => parseActions(live).actions.map((a) => a.name),
    liveXml: () => live,
  };
}

async function advanceThrough<T>(promise: Promise<T>): Promise<T> {
  let done = false;
  const wrapped = promise.finally(() => {
    done = true;
  });
  while (!done) await vi.advanceTimersByTimeAsync(300);
  return wrapped;
}

describe('whole-workbook apply and live actions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetActionHandlingMemo();
    vi.spyOn(loggerModule, 'log').mockImplementation(() => undefined);
    vi.spyOn(validationRegistry, 'runValidation').mockReturnValue({ valid: true, issues: [] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const three = [action(1), action(2), action(3)];
  const payload = workbook([...three, action(4)]);

  const run = (
    executor: ExternalApiToolExecutor,
    xml = payload,
  ): ReturnType<typeof loadWorkbookXml> =>
    advanceThrough(loadWorkbookXml({ xml, executor, signal, focus: NO_FOCUS }));

  it.each(['0.2.24', '0.3.0'])(
    'API %s: one POST of the full document, no readback after, no memo',
    async (version) => {
      const d = fakeDesktop('replace', three, 'inst-shared', version);
      expect((await run(d.executor)).isOk()).toBe(true);
      expect(d.posted).toEqual([payload]);
      const getMock = vi.mocked(d.executor.getWorkbookDocument);
      expect(getMock).toHaveBeenCalledTimes(1);
      expect(getMock.mock.invocationCallOrder[0]).toBeLessThan(
        d.applyWorkbookDocument.mock.invocationCallOrder[0],
      );

      const older = fakeDesktop('append', three, 'inst-shared', '0.2.21');
      expect((await run(older.executor)).isOk()).toBe(true);
      expect(parseActions(older.posted[0]).actions.map((a) => a.name)).toEqual(['[Action4]']);
    },
  );

  it.each(['0.2.23', undefined, '0.2.24-dev'])(
    'API %s: still strips carried actions',
    async (version) => {
      const d = fakeDesktop('append', three, 'inst-old', version);
      expect((await run(d.executor)).isOk()).toBe(true);
      expect(parseActions(d.posted[0]).actions.map((a) => a.name)).toEqual(['[Action4]']);
    },
  );

  it('append build: one POST that leaves out the carried actions; ends with 4', async () => {
    const d = fakeDesktop('append', three);
    const result = await run(d.executor);
    expect(result.isOk()).toBe(true);
    expect(d.posted).toHaveLength(1);
    expect(parseActions(d.posted[0]).actions.map((a) => a.name)).toEqual(['[Action4]']);
    expect(d.liveNames()).toEqual(['[Action1]', '[Action2]', '[Action3]', '[Action4]']);
  });

  it('replace build: re-POSTs the original once, remembers replace, and skips stripping next time', async () => {
    const d = fakeDesktop('replace', three);
    expect((await run(d.executor)).isOk()).toBe(true);
    expect(d.posted).toHaveLength(2);
    expect(d.posted[1]).toBe(payload);
    expect(d.liveNames()).toHaveLength(4);

    d.posted.length = 0;
    const next = workbook([...parseActions(d.liveXml()).actions.map((a) => a.xml), action(5)]);
    expect((await run(d.executor, next)).isOk()).toBe(true);
    expect(d.posted).toEqual([next]);
    expect(d.liveNames()).toHaveLength(5);
  });

  it('does not memo append: the next call on an append build strips again', async () => {
    const d = fakeDesktop('append', three);
    await run(d.executor);
    d.posted.length = 0;
    const next = workbook([...parseActions(d.liveXml()).actions.map((a) => a.xml), action(5)]);
    await run(d.executor, next);
    expect(d.posted).toHaveLength(1);
    expect(parseActions(d.posted[0]).actions.map((a) => a.name)).toEqual(['[Action5]']);
    expect(d.liveNames()).toHaveLength(5);
  });

  it('stale replace build: first readback is the pre-POST doc, still ends with 4 actions', async () => {
    const d = fakeDesktop('stale-replace', three);
    expect((await run(d.executor)).isOk()).toBe(true);
    expect(d.posted).toHaveLength(2);
    expect(d.liveNames()).toHaveLength(4);
  });

  it('never settling decides nothing: no re-POST and no memo', async () => {
    const d = fakeDesktop('append', three);
    // Same bytes on every GET: the POST never visibly lands.
    const frozen = d.liveXml();
    vi.mocked(d.executor.getWorkbookDocument).mockImplementation(async () =>
      Ok({ xml: frozen, applicationVersion: undefined, xsdPayloadVersion: undefined }),
    );
    expect((await run(d.executor)).isOk()).toBe(true);
    expect(d.posted).toHaveLength(1);
    d.posted.length = 0;
    await run(d.executor);
    expect(parseActions(d.posted[0]).actions.map((a) => a.name)).toEqual(['[Action4]']);
  });

  it('live with no actions: one POST, payload byte-identical', async () => {
    const d = fakeDesktop('append', []);
    expect((await run(d.executor)).isOk()).toBe(true);
    expect(d.posted).toEqual([payload]);
  });

  it('edit-shaped payload (same name, different structure) is not stripped', async () => {
    const d = fakeDesktop('append', three);
    const edited = workbook([action(1), action(2, 'https://edited.example/'), action(3)]);
    await run(d.executor, edited);
    expect(parseActions(d.posted[0]).actions.map((a) => a.name)).toEqual(['[Action2]']);
  });

  it('drops the whole block when every action is carried', async () => {
    const d = fakeDesktop('append', three);
    const same = workbook(three);
    await run(d.executor, same);
    expect(d.posted).toHaveLength(1);
    expect(d.posted[0]).toBe(same.replace(/<actions>[\s\S]*<\/actions>/, ''));
    expect(d.liveNames()).toEqual(['[Action1]', '[Action2]', '[Action3]']);
  });

  it('duplicate-name live actions: POST unchanged', async () => {
    const d = fakeDesktop('append', []);
    vi.mocked(d.executor.getWorkbookDocument).mockImplementation(async () =>
      Ok({
        xml: workbook([action(1), action(1)]),
        applicationVersion: undefined,
        xsdPayloadVersion: undefined,
      }),
    );
    await run(d.executor);
    expect(d.posted).toEqual([payload]);
  });

  it('a failed re-POST says the build removed the actions and points to undo-workbook', async () => {
    const d = fakeDesktop('replace', three);
    const original = d.applyWorkbookDocument.getMockImplementation()!;
    d.applyWorkbookDocument.mockImplementationOnce(original);
    d.applyWorkbookDocument.mockImplementationOnce(async (xml: string) => {
      d.posted.push(xml);
      return Err({ type: 'command-timed-out' as const, error: 'Timeout' });
    });
    // Second call is the re-POST; first call above already consumed the original once.
    const result = await run(d.executor);
    expect(result.isErr()).toBe(true);
    expect(JSON.stringify(result.unwrapErr())).toContain('undo-workbook');
    expect(JSON.stringify(result.unwrapErr())).toContain('workbook-actions-removed');
  });

  it('append build that drops one carried action: one POST, no re-POST, no memo', async () => {
    const d = fakeDesktop('append', three);
    const original = d.applyWorkbookDocument.getMockImplementation()!;
    d.applyWorkbookDocument.mockImplementationOnce(async (xml: string) => {
      const result = await original(xml);
      const dropped = d.liveXml().replace(/<action caption="A2"[\s\S]*?<\/action>/, '');
      vi.mocked(d.executor.getWorkbookDocument).mockImplementation(async () =>
        Ok({ xml: dropped, applicationVersion: undefined, xsdPayloadVersion: undefined }),
      );
      return result;
    });
    expect((await run(d.executor)).isOk()).toBe(true);
    expect(d.posted).toHaveLength(1);
    d.posted.length = 0;
    await run(d.executor);
    expect(parseActions(d.posted[0]).actions.map((a) => a.name)).toEqual(['[Action2]']);
  });

  it('abort during the post-POST poll still returns the POST result', async () => {
    const d = fakeDesktop('append', three);
    const controller = new AbortController();
    const frozen = d.liveXml();
    vi.mocked(d.executor.getWorkbookDocument).mockImplementation(async () => {
      if (d.posted.length > 0) controller.abort(new Error('aborted'));
      return Ok({ xml: frozen, applicationVersion: undefined, xsdPayloadVersion: undefined });
    });
    const result = await advanceThrough(
      loadWorkbookXml({
        xml: payload,
        executor: d.executor,
        signal: controller.signal,
        focus: NO_FOCUS,
      }),
    );
    expect(result.isOk()).toBe(true);
    expect(d.posted).toHaveLength(1);
  });

  it('does not memo when the executor has no instance id', async () => {
    const d = fakeDesktop('replace', three, undefined);
    await run(d.executor);
    expect(d.posted).toHaveLength(2);
    d.posted.length = 0;
    await run(d.executor, workbook([...parseActions(d.liveXml()).actions.map((a) => a.xml)]));
    expect(d.posted).toHaveLength(1);
  });
});

describe('loadWorksheetXml whole-workbook paths pass the live document', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetActionHandlingMemo();
    vi.spyOn(loggerModule, 'log').mockImplementation(() => undefined);
    vi.spyOn(validationRegistry, 'runValidation').mockReturnValue({ valid: true, issues: [] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const sheetXml = "<worksheet name='A'><table><rows /></table></worksheet>";
  const three = [action(1), action(2), action(3)];

  it('build-and-apply-worksheet path strips carried actions', async () => {
    const d = fakeDesktop('append', three);
    const result = await advanceThrough(
      loadWorksheetXml({
        worksheetName: 'A',
        xml: sheetXml,
        executor: d.executor,
        signal,
        focus: NO_FOCUS,
      }),
    );
    expect(result.isOk()).toBe(true);
    expect(d.posted[0]).not.toContain('<actions');
    expect(d.liveNames()).toEqual(['[Action1]', '[Action2]', '[Action3]']);
  });

  it('artifact apply path strips carried actions', async () => {
    const d = fakeDesktop('append', three);
    const baseline = d.liveXml();
    const result = await advanceThrough(
      loadWorksheetXml({
        worksheetName: 'A',
        xml: sheetXml,
        executor: d.executor,
        signal,
        focus: NO_FOCUS,
        artifactApply: {
          windowXml: "<window class='worksheet' name='A' />",
          expectedTargetState: captureTargetWorksheetState(baseline, 'A', sheetXml),
          expectedInstanceId: 'inst-append',
          dispatchState: { attempted: false },
        },
      }),
    );
    expect(result.isOk()).toBe(true);
    expect(d.posted[0]).not.toContain('<actions');
    expect(d.liveNames()).toEqual(['[Action1]', '[Action2]', '[Action3]']);
  });
});
