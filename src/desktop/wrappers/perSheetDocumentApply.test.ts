import { Err, Ok } from 'ts-results-es';

import * as loggerModule from '../../logging/logger.js';
import { makeExecutorMock } from '../externalApi/executor.mock.js';
import * as validationRegistry from '../validation/registry.js';
import { sourceSha256 } from './cacheFingerprint.js';
import { type PerSheetKind, tryApplyViaPerSheetRoute } from './perSheetDocumentApply.js';

// Focus is a required argument at every write seam; suites not about navigation pass the
// disposition that dispatches nothing.
const NO_FOCUS = { navigate: 'none', reason: 'intermediate-leg' } as const;

const routeMissing = {
  type: 'command-failed' as const,
  error: {
    code: 'not-found',
    message: 'No route matches GET /v0/workbook/worksheets',
    recoverable: false,
  },
};

type KindFixture = {
  kind: PerSheetKind;
  sheetName: string;
  fragmentXml: string;
  listMethod: 'listWorksheets' | 'listDashboards' | 'listStoryboards';
  listValue: Record<string, Array<{ id: string; name: string }>>;
  applyMethod: 'applyWorksheetDocument' | 'applyDashboardDocument' | 'applyStoryboardDocument';
  getMethod: 'getWorksheetDocument' | 'getDashboardDocument' | 'getStoryboardDocument';
  id: string;
};

const FIXTURES: KindFixture[] = [
  {
    kind: 'worksheet',
    sheetName: 'Sheet 1',
    fragmentXml: "<worksheet name='Sheet 1'><table><rows /></table></worksheet>",
    listMethod: 'listWorksheets',
    listValue: { worksheets: [{ id: 'sheet-1', name: 'Sheet 1' }] },
    applyMethod: 'applyWorksheetDocument',
    getMethod: 'getWorksheetDocument',
    id: 'sheet-1',
  },
  {
    kind: 'dashboard',
    sheetName: 'Sales Dashboard',
    fragmentXml: "<dashboard name='Sales Dashboard'><zones /></dashboard>",
    listMethod: 'listDashboards',
    listValue: { dashboards: [{ id: 'dash-1', name: 'Sales Dashboard' }] },
    applyMethod: 'applyDashboardDocument',
    getMethod: 'getDashboardDocument',
    id: 'dash-1',
  },
  {
    kind: 'storyboard',
    sheetName: 'QBR Story',
    fragmentXml: "<dashboard name='QBR Story' type='storyboard'><zones /></dashboard>",
    listMethod: 'listStoryboards',
    listValue: { storyboards: [{ id: 'story-1', name: 'QBR Story' }] },
    applyMethod: 'applyStoryboardDocument',
    getMethod: 'getStoryboardDocument',
    id: 'story-1',
  },
];

describe('tryApplyViaPerSheetRoute', () => {
  const mockSignal = new AbortController().signal;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(loggerModule, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(FIXTURES)(
    'posts the $kind fragment as-is to its per-sheet route and reports applied',
    async ({ kind, sheetName, fragmentXml, listMethod, listValue, applyMethod, id }) => {
      const apply = vi
        .fn()
        .mockResolvedValue(Ok({ command_id: 'cmd-apply', status: 'completed', submitted_at: '' }));
      const executeCommand = vi
        .fn()
        .mockResolvedValue(Ok({ command_id: 'cmd-ok', status: 'completed', submitted_at: '' }));
      const executor = makeExecutorMock({
        [listMethod]: vi.fn().mockResolvedValue(Ok(listValue)),
        [applyMethod]: apply,
        executeCommand,
      });

      const result = await tryApplyViaPerSheetRoute({
        kind,
        sheetName,
        fragmentXml,
        focus: NO_FOCUS,
        executor,
        signal: mockSignal,
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual({
          status: 'applied',
          id,
          name: sheetName,
          fragmentXml,
        });
      }
      // The route resolves by id, and the posted body is the sheet fragment as-is (Tableau Desktop
      // wraps it into the live workbook server-side — the MCP does not build a <workbook> envelope).
      expect(apply).toHaveBeenCalledTimes(1);
      const [postedId, postedXml] = apply.mock.calls[0];
      expect(postedId).toBe(id);
      expect(postedXml).toBe(fragmentXml);
      expect(postedXml).not.toContain('<workbook>');
    },
  );

  it.each([
    {
      ...FIXTURES[0],
      sheetName: 'sheet-1',
      fragmentXml:
        "<worksheet name='Old worksheet'><table><rows /></table><simple-id uuid='sheet-1' /></worksheet>",
      currentName: 'Renamed worksheet',
      listValue: { worksheets: [{ id: 'sheet-1', name: 'Renamed worksheet' }] },
    },
    {
      ...FIXTURES[1],
      sheetName: 'dash-1',
      fragmentXml:
        "<dashboard name='Old dashboard'><zones /><simple-id uuid='dash-1' /></dashboard>",
      currentName: 'Renamed dashboard',
      listValue: { dashboards: [{ id: 'dash-1', name: 'Renamed dashboard' }] },
    },
    {
      ...FIXTURES[2],
      sheetName: 'story-1',
      fragmentXml:
        "<dashboard name='Old story' type='storyboard'><zones /><simple-id uuid='story-1' /></dashboard>",
      currentName: 'Renamed story',
      listValue: { storyboards: [{ id: 'story-1', name: 'Renamed story' }] },
    },
  ])(
    'retitles a stale $kind fragment to the current live name before posting by id',
    async ({
      kind,
      sheetName,
      fragmentXml,
      listMethod,
      listValue,
      applyMethod,
      id,
      currentName,
    }) => {
      const apply = vi
        .fn()
        .mockResolvedValue(Ok({ command_id: 'cmd-apply', status: 'completed', submitted_at: '' }));
      const executor = makeExecutorMock({
        [listMethod]: vi.fn().mockResolvedValue(Ok(listValue)),
        [applyMethod]: apply,
      });

      const result = await tryApplyViaPerSheetRoute({
        kind,
        sheetName,
        fragmentXml,
        focus: NO_FOCUS,
        executor,
        signal: mockSignal,
      });

      expect(result.isOk()).toBe(true);
      expect(apply).toHaveBeenCalledTimes(1);
      const [postedId, postedXml] = apply.mock.calls[0];
      expect(postedId).toBe(id);
      expect(postedXml).toContain(`name='${currentName}'`);
      expect(postedXml).toContain(`uuid='${id}'`);
    },
  );

  it('changes only the root name when a stale fragment contains numeric entities', async () => {
    const fragmentXml =
      "<worksheet name='Old worksheet'>" +
      '<column formula="real:&#13; literal:&amp;#13;" />' +
      "<simple-id uuid='sheet-1' />" +
      '</worksheet>';
    const applyWorksheetDocument = vi
      .fn()
      .mockResolvedValue(Ok({ command_id: 'cmd-apply', status: 'completed', submitted_at: '' }));
    const executor = makeExecutorMock({
      listWorksheets: vi
        .fn()
        .mockResolvedValue(Ok({ worksheets: [{ id: 'sheet-1', name: 'Renamed worksheet' }] })),
      applyWorksheetDocument,
    });

    const result = await tryApplyViaPerSheetRoute({
      kind: 'worksheet',
      sheetName: 'sheet-1',
      fragmentXml,
      focus: NO_FOCUS,
      executor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(applyWorksheetDocument).toHaveBeenCalledWith(
      'sheet-1',
      fragmentXml.replace("name='Old worksheet'", "name='Renamed worksheet'"),
      mockSignal,
    );
  });

  it('accepts an unchanged preexisting blocker using one live target GET', async () => {
    const fixture = FIXTURES[0];
    const issue = { ruleId: 'existing', severity: 'error' as const, message: 'already broken' };
    vi.spyOn(validationRegistry, 'runValidation')
      .mockReturnValueOnce({ valid: false, issues: [issue] })
      .mockReturnValueOnce({ valid: false, issues: [issue] });
    const getDocument = vi.fn().mockResolvedValue(Ok({ xml: fixture.fragmentXml }));
    const apply = vi
      .fn()
      .mockResolvedValue(Ok({ command_id: 'cmd-apply', status: 'completed', submitted_at: '' }));
    const executor = makeExecutorMock({
      [fixture.listMethod]: vi.fn().mockResolvedValue(Ok(fixture.listValue)),
      [fixture.getMethod]: getDocument,
      [fixture.applyMethod]: apply,
    });

    const result = await tryApplyViaPerSheetRoute({
      kind: fixture.kind,
      sheetName: fixture.sheetName,
      fragmentXml: fixture.fragmentXml,
      expectedSourceHash: sourceSha256(fixture.fragmentXml),
      validationContext: 'worksheet',
      focus: NO_FOCUS,
      executor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toMatchObject({ status: 'applied' });
    expect(getDocument).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledOnce();
  });

  it.each([
    ['new', [], [{ ruleId: 'new', severity: 'error' as const, message: 'new blocker' }]],
    [
      'worsened',
      [{ ruleId: 'same', severity: 'error' as const, message: 'same', occurrenceCount: 1 }],
      [{ ruleId: 'same', severity: 'error' as const, message: 'same', occurrenceCount: 2 }],
    ],
  ])(
    'returns validation-failed before POST for a %s blocker',
    async (_label, liveIssues, candidateIssues) => {
      const fixture = FIXTURES[0];
      vi.spyOn(validationRegistry, 'runValidation')
        .mockReturnValueOnce({ valid: liveIssues.length === 0, issues: liveIssues })
        .mockReturnValueOnce({ valid: false, issues: candidateIssues });
      const apply = vi.fn();
      const getDocument = vi.fn().mockResolvedValue(Ok({ xml: fixture.fragmentXml }));
      const executor = makeExecutorMock({
        [fixture.listMethod]: vi.fn().mockResolvedValue(Ok(fixture.listValue)),
        [fixture.getMethod]: getDocument,
        [fixture.applyMethod]: apply,
      });

      const result = await tryApplyViaPerSheetRoute({
        kind: fixture.kind,
        sheetName: fixture.sheetName,
        fragmentXml: fixture.fragmentXml,
        validationContext: 'worksheet',
        focus: NO_FOCUS,
        executor,
        signal: mockSignal,
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual({ type: 'validation-failed', issues: candidateIssues });
      }
      expect(getDocument).toHaveBeenCalledOnce();
      expect(apply).not.toHaveBeenCalled();
    },
  );

  it('checks source hash before differential validation and never posts stale input', async () => {
    const fixture = FIXTURES[0];
    const validation = vi.spyOn(validationRegistry, 'runValidation');
    const apply = vi.fn();
    const getDocument = vi.fn().mockResolvedValue(Ok({ xml: fixture.fragmentXml }));
    const executor = makeExecutorMock({
      [fixture.listMethod]: vi.fn().mockResolvedValue(Ok(fixture.listValue)),
      [fixture.getMethod]: getDocument,
      [fixture.applyMethod]: apply,
    });

    const result = await tryApplyViaPerSheetRoute({
      kind: fixture.kind,
      sheetName: fixture.sheetName,
      fragmentXml: fixture.fragmentXml,
      expectedSourceHash: '0'.repeat(64),
      validationContext: 'worksheet',
      focus: NO_FOCUS,
      executor,
      signal: mockSignal,
    });

    expect(result.isOk() && result.value).toBe('source-drift');
    expect(getDocument).toHaveBeenCalledOnce();
    expect(validation).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it.each(FIXTURES.filter(({ kind }) => kind !== 'worksheet'))(
    'refuses a stale $kind source before posting the target fragment',
    async ({ kind, sheetName, fragmentXml, listMethod, listValue, applyMethod, getMethod }) => {
      const apply = vi.fn();
      const getDocument = vi.fn().mockResolvedValue(Ok({ xml: `${fragmentXml}<!-- changed -->` }));
      const executor = makeExecutorMock({
        [listMethod]: vi.fn().mockResolvedValue(Ok(listValue)),
        [getMethod]: getDocument,
        [applyMethod]: apply,
      });

      const result = await tryApplyViaPerSheetRoute({
        kind,
        sheetName,
        fragmentXml,
        expectedSourceHash: '0'.repeat(64),
        focus: NO_FOCUS,
        executor,
        signal: mockSignal,
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) expect(result.value).toBe('source-drift');
      expect(getDocument).toHaveBeenCalledOnce();
      expect(apply).not.toHaveBeenCalled();
    },
  );

  it.each(FIXTURES.filter(({ kind }) => kind !== 'worksheet'))(
    'allows a $kind apply when its target is unchanged even if an unrelated sheet changed',
    async ({ kind, sheetName, fragmentXml, listMethod, listValue, applyMethod, getMethod }) => {
      const apply = vi
        .fn()
        .mockResolvedValue(Ok({ command_id: 'cmd-apply', status: 'completed', submitted_at: '' }));
      const getWorkbookDocument = vi
        .fn()
        .mockResolvedValue(
          Ok({ xml: '<workbook><worksheet name="Unrelated changed"/></workbook>' }),
        );
      const executor = makeExecutorMock({
        [listMethod]: vi.fn().mockResolvedValue(Ok(listValue)),
        [getMethod]: vi.fn().mockResolvedValue(Ok({ xml: fragmentXml })),
        [applyMethod]: apply,
        getWorkbookDocument,
      });

      const result = await tryApplyViaPerSheetRoute({
        kind,
        sheetName,
        fragmentXml,
        expectedSourceHash:
          kind === 'dashboard'
            ? '8eb05f71faec6763ba147ca53b742f12613cc296459438470cc1f084c128cf68'
            : 'ee506c8c5138212a5b0af8c9ef394dd2efa8ecbf74a103a7609cf1c2716cc877',
        focus: NO_FOCUS,
        executor,
        signal: mockSignal,
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) expect(result.value).toMatchObject({ status: 'applied' });
      expect(getWorkbookDocument).not.toHaveBeenCalled();
      expect(apply).toHaveBeenCalledOnce();
    },
  );

  it.each(FIXTURES)(
    'reports sheet-absent for an unresolved $kind name without posting',
    async ({ kind, fragmentXml, listMethod, applyMethod }) => {
      const apply = vi.fn();
      const executor = makeExecutorMock({
        // Empty list: the name resolves to nothing, so the route (which cannot create) is skipped.
        [listMethod]: vi.fn().mockResolvedValue(Ok({})),
        [applyMethod]: apply,
      });

      const result = await tryApplyViaPerSheetRoute({
        kind,
        sheetName: 'Nonexistent',
        fragmentXml,
        focus: NO_FOCUS,
        executor,
        signal: mockSignal,
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe('sheet-absent');
      }
      expect(apply).not.toHaveBeenCalled();
    },
  );

  it.each(FIXTURES)(
    'reports route-missing when the $kind list route is absent (old Desktop build)',
    async ({ kind, sheetName, fragmentXml, listMethod, applyMethod }) => {
      const apply = vi.fn();
      const executor = makeExecutorMock({
        [listMethod]: vi.fn().mockResolvedValue(Err(routeMissing)),
        [applyMethod]: apply,
      });

      const result = await tryApplyViaPerSheetRoute({
        kind,
        sheetName,
        fragmentXml,
        focus: NO_FOCUS,
        executor,
        signal: mockSignal,
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe('route-missing');
      }
      expect(apply).not.toHaveBeenCalled();
    },
  );

  it.each(FIXTURES)(
    'reports route-missing when the $kind POST route is absent but the list route is present',
    async ({ kind, sheetName, fragmentXml, listMethod, listValue, applyMethod }) => {
      const apply = vi.fn().mockResolvedValue(Err(routeMissing));
      const executor = makeExecutorMock({
        [listMethod]: vi.fn().mockResolvedValue(Ok(listValue)),
        [applyMethod]: apply,
      });

      const result = await tryApplyViaPerSheetRoute({
        kind,
        sheetName,
        fragmentXml,
        focus: NO_FOCUS,
        executor,
        signal: mockSignal,
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe('route-missing');
      }
      expect(apply).toHaveBeenCalledTimes(1);
    },
  );

  it('surfaces a non-route list error instead of falling back', async () => {
    const listError = {
      type: 'command-failed' as const,
      error: { code: 'boom', message: 'internal error', recoverable: false },
    };
    const executor = makeExecutorMock({
      listWorksheets: vi.fn().mockResolvedValue(Err(listError)),
      applyWorksheetDocument: vi.fn(),
    });

    const result = await tryApplyViaPerSheetRoute({
      kind: 'worksheet',
      sheetName: 'Sheet 1',
      fragmentXml: "<worksheet name='Sheet 1'><table /></worksheet>",
      focus: NO_FOCUS,
      executor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toEqual(listError);
    }
  });
});
