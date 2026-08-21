import type { ExternalApiToolExecutor } from './externalApiToolExecutor.js';

/**
 * The executor's PUBLIC surface (keyof a class type only yields public members). Typing the
 * defaults against this keeps the factory honest: when the executor gains, loses, or
 * re-signs a public method, this file fails to compile instead of tests failing at runtime.
 */
type ExecutorPublicApi = { [K in keyof ExternalApiToolExecutor]: ExternalApiToolExecutor[K] };

/**
 * A fully typed test double for {@link ExternalApiToolExecutor}. Every public method is a
 * bare `vi.fn()` (returns undefined) so tests keep the existing semantics of stubbing only
 * what they use; pass `overrides` for the methods a test actually exercises.
 */
export function makeExecutorMock(
  overrides: Partial<ExternalApiToolExecutor> = {},
): ExternalApiToolExecutor {
  const defaults: ExecutorPublicApi = {
    start: vi.fn(),
    stop: vi.fn(),
    isAvailable: vi.fn(),
    desktopInstanceId: undefined,
    executeCommand: vi.fn(),
    health: vi.fn(),
    getRoot: vi.fn(),
    getApp: vi.fn(),
    getSite: vi.fn(),
    listSiteWorkbooks: vi.fn(),
    listSiteDatasources: vi.fn(),
    getWorkbook: vi.fn(),
    listWorksheets: vi.fn(),
    listDashboards: vi.fn(),
    listStoryboards: vi.fn(),
    listWorkbookDatasources: vi.fn(),
    getWorksheet: vi.fn(),
    getDashboard: vi.fn(),
    getStoryboard: vi.fn(),
    getWorkbookDocument: vi.fn(),
    getWorksheetDocument: vi.fn(),
    getDashboardDocument: vi.fn(),
    getStoryboardDocument: vi.fn(),
    getWorksheetSummaryData: vi.fn(),
    listWorksheetLogicalTables: vi.fn(),
    getWorksheetUnderlyingData: vi.fn(),
    exportWorksheetImage: vi.fn(),
    exportDashboardImage: vi.fn(),
    exportStoryboardImage: vi.fn(),
    validateWorkbookDocument: vi.fn(),
    applyWorkbookDocument: vi.fn(),
    applyWorksheetDocument: vi.fn(),
    applyDashboardDocument: vi.fn(),
    applyStoryboardDocument: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    openFile: vi.fn(),
    saveWorkbook: vi.fn(),
    exportWorkbookAs: vi.fn(),
    publishWorkbook: vi.fn(),
    refreshDatasourceData: vi.fn(),
    refreshDatasourceExtract: vi.fn(),
    addWorksheet: vi.fn(),
    addDashboard: vi.fn(),
    addStoryboard: vi.fn(),
    deleteSheet: vi.fn(),
    renameSheet: vi.fn(),
    sortWorksheet: vi.fn(),
    goToSheet: vi.fn(),
    pauseWorksheetAutoUpdates: vi.fn(),
    resumeWorksheetAutoUpdates: vi.fn(),
    pauseDashboardAutoUpdates: vi.fn(),
    resumeDashboardAutoUpdates: vi.fn(),
  };
  return { ...defaults, ...overrides } as ExternalApiToolExecutor;
}
