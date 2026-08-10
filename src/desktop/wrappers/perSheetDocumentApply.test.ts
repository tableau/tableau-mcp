import { Err, Ok } from 'ts-results-es';

import * as loggerModule from '../../logging/logger.js';
import { makeExecutorMock } from '../externalApi/executor.mock.js';
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

const COMPLETE_WORKBOOK_XML = `<?xml version='1.0'?>
<workbook version='18.1'>
  <datasources>
    <datasource name='Sample - Superstore' />
  </datasources>
  <worksheets>
    <worksheet name='Sheet 1'>
      <table><cols>[Sample - Superstore].[sum:Sales:qk]</cols></table>
    </worksheet>
    <worksheet name='Other Sheet'><table /></worksheet>
  </worksheets>
  <dashboards />
  <windows>
    <window class='worksheet' name='Sheet 1' />
    <window class='worksheet' name='Other Sheet' />
  </windows>
  <thumbnails />
</workbook>`;

type KindFixture = {
  kind: PerSheetKind;
  sheetName: string;
  fragmentXml: string;
  listMethod: 'listWorksheets' | 'listDashboards' | 'listStoryboards';
  listValue: Record<string, Array<{ id: string; name: string }>>;
  applyMethod: 'applyWorksheetDocument' | 'applyDashboardDocument' | 'applyStoryboardDocument';
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
    id: 'sheet-1',
  },
  {
    kind: 'dashboard',
    sheetName: 'Sales Dashboard',
    fragmentXml: "<dashboard name='Sales Dashboard'><zones /></dashboard>",
    listMethod: 'listDashboards',
    listValue: { dashboards: [{ id: 'dash-1', name: 'Sales Dashboard' }] },
    applyMethod: 'applyDashboardDocument',
    id: 'dash-1',
  },
  {
    kind: 'storyboard',
    sheetName: 'QBR Story',
    fragmentXml: "<dashboard name='QBR Story' type='storyboard'><zones /></dashboard>",
    listMethod: 'listStoryboards',
    listValue: { storyboards: [{ id: 'story-1', name: 'QBR Story' }] },
    applyMethod: 'applyStoryboardDocument',
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

  it('posts a complete workbook document when adding a second measure to an existing worksheet', async () => {
    const editedWorksheet =
      '<worksheet name="Sheet 1"><table><cols>[Sample - Superstore].[sum:Sales:qk] / [Sample - Superstore].[sum:Profit:qk]</cols></table></worksheet>';
    const applyWorksheetDocument = vi
      .fn()
      .mockResolvedValue(Ok({ command_id: 'cmd-apply', status: 'completed', submitted_at: '' }));
    const getWorkbookDocument = vi.fn().mockResolvedValue(
      Ok({
        xml: COMPLETE_WORKBOOK_XML,
        instanceId: 'desktop-instance',
        applicationVersion: '2026.1',
        payloadVersion: '18.1',
      }),
    );
    const executor = makeExecutorMock({
      listWorksheets: vi
        .fn()
        .mockResolvedValue(Ok({ worksheets: [{ id: 'sheet-1', name: 'Sheet 1' }] })),
      getWorkbookDocument,
      applyWorksheetDocument,
      executeCommand: vi
        .fn()
        .mockResolvedValue(Ok({ command_id: 'cmd-ok', status: 'completed', submitted_at: '' })),
    });

    const result = await tryApplyViaPerSheetRoute({
      kind: 'worksheet',
      sheetName: 'Sheet 1',
      fragmentXml: editedWorksheet,
      focus: NO_FOCUS,
      executor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(getWorkbookDocument).toHaveBeenCalledTimes(1);
    expect(applyWorksheetDocument).toHaveBeenCalledTimes(1);
    const postedXml = applyWorksheetDocument.mock.calls[0]?.[1] as string;
    expect(postedXml).toContain('<workbook');
    expect(postedXml).toContain('<worksheets>');
    expect(postedXml).toContain('[sum:Profit:qk]');
    expect(postedXml).toContain('name="Other Sheet"');
    expect(postedXml).toContain('<windows>');
    expect(postedXml).toContain('<thumbnails');
  });

  it.each(FIXTURES)(
    'posts the current $kind payload shape to its per-sheet route and reports applied',
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
        getWorkbookDocument: vi.fn().mockResolvedValue(
          Ok({
            xml: COMPLETE_WORKBOOK_XML,
            instanceId: 'desktop-instance',
            applicationVersion: '2026.1',
            payloadVersion: '18.1',
          }),
        ),
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
        expect(result.value).toBe('applied');
      }
      expect(apply).toHaveBeenCalledTimes(1);
      const [postedId, postedXml] = apply.mock.calls[0];
      expect(postedId).toBe(id);
      if (kind === 'worksheet') {
        expect(postedXml).toContain('<workbook');
        expect(postedXml).toContain('<worksheets>');
        expect(postedXml).toContain('name="Other Sheet"');
      } else {
        expect(postedXml).toBe(fragmentXml);
      }
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
        getWorkbookDocument: vi.fn().mockResolvedValue(
          Ok({
            xml: COMPLETE_WORKBOOK_XML,
            instanceId: 'desktop-instance',
            applicationVersion: '2026.1',
            payloadVersion: '18.1',
          }),
        ),
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
