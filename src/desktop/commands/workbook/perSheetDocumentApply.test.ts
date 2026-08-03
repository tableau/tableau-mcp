import { Err, Ok } from 'ts-results-es';

import * as loggerModule from '../../../logging/logger.js';
import { ToolExecutor } from '../../toolExecutor/toolExecutor.js';
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

  it.each(FIXTURES)(
    'posts the $kind fragment as-is to its per-sheet route and reports applied',
    async ({ kind, sheetName, fragmentXml, listMethod, listValue, applyMethod, id }) => {
      const apply = vi
        .fn()
        .mockResolvedValue(Ok({ command_id: 'cmd-apply', status: 'completed', submitted_at: '' }));
      const executeCommand = vi
        .fn()
        .mockResolvedValue(Ok({ command_id: 'cmd-ok', status: 'completed', submitted_at: '' }));
      const executor = {
        [listMethod]: vi.fn().mockResolvedValue(Ok(listValue)),
        [applyMethod]: apply,
        executeCommand,
      } as unknown as ToolExecutor;

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
      // The route resolves by id, and the posted body is the sheet fragment as-is (Tableau Desktop
      // wraps it into the live workbook server-side — the MCP does not build a <workbook> envelope).
      expect(apply).toHaveBeenCalledTimes(1);
      const [postedId, postedXml] = apply.mock.calls[0];
      expect(postedId).toBe(id);
      expect(postedXml).toBe(fragmentXml);
      expect(postedXml).not.toContain('<workbook>');
    },
  );

  it.each(FIXTURES)(
    'reports sheet-absent for an unresolved $kind name without posting',
    async ({ kind, fragmentXml, listMethod, applyMethod }) => {
      const apply = vi.fn();
      const executor = {
        // Empty list: the name resolves to nothing, so the route (which cannot create) is skipped.
        [listMethod]: vi.fn().mockResolvedValue(Ok({})),
        [applyMethod]: apply,
      } as unknown as ToolExecutor;

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
      const executor = {
        [listMethod]: vi.fn().mockResolvedValue(Err(routeMissing)),
        [applyMethod]: apply,
      } as unknown as ToolExecutor;

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
      const executor = {
        [listMethod]: vi.fn().mockResolvedValue(Ok(listValue)),
        [applyMethod]: apply,
      } as unknown as ToolExecutor;

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
    const executor = {
      listWorksheets: vi.fn().mockResolvedValue(Err(listError)),
      applyWorksheetDocument: vi.fn(),
    } as unknown as ToolExecutor;

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
