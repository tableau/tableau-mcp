import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Ok } from 'ts-results-es';
import ts from 'typescript';

import { makeExecutorMock } from '../../desktop/externalApi/executor.mock.js';
import { ExecuteCommandResult } from '../../desktop/externalApi/executorTypes.js';
import { ExternalApiToolExecutor } from '../../desktop/externalApi/externalApiToolExecutor.js';
import * as sessionResolution from '../../desktop/session/sessionResolution.js';
import { DesktopMcpServer } from '../../server.desktop.js';
import invariant from '../../utils/invariant.js';
import { Provider } from '../../utils/provider.js';
import { getActivateSheetTool } from './api/activateSheet.js';
import { getAddDashboardTool } from './api/addDashboard.js';
import { getAddStoryboardTool } from './api/addStoryboard.js';
import { getAddWorksheetTool } from './api/addWorksheet.js';
import { getDeleteSheetTool } from './api/deleteSheet.js';
import { getOpenFileTool } from './api/openFile.js';
import { getPauseAutoUpdatesTool } from './api/pauseAutoUpdates.js';
import { getRedoWorkbookTool } from './api/redoWorkbook.js';
import { getRefreshAutoUpdatesTool } from './api/refreshAutoUpdates.js';
import { getRefreshDashboardAutoUpdatesTool } from './api/refreshDashboardAutoUpdates.js';
import { getRefreshDatasourceDataTool } from './api/refreshDatasourceData.js';
import { getRefreshDatasourceExtractTool } from './api/refreshDatasourceExtract.js';
import { getRefreshStoryboardAutoUpdatesTool } from './api/refreshStoryboardAutoUpdates.js';
import { getRenameSheetTool } from './api/renameSheet.js';
import { getResumeAutoUpdatesTool } from './api/resumeAutoUpdates.js';
import { getSaveWorkbookTool } from './api/saveWorkbook.js';
import { getShowMeTool } from './api/showMe.js';
import { getSortWorksheetTool } from './api/sortWorksheet.js';
import { getUndoWorkbookTool } from './api/undoWorkbook.js';
import { getWorkbookExportAsTool } from './api/workbookExportAs.js';
import { DesktopTool } from './tool.js';
import { getMockRequestHandlerExtra } from './toolContext.mock.js';

vi.mock('../../desktop/session/sessionResolution.js');

const REPO_ROOT = join(__dirname, '../../..');
const EXECUTOR_FILE = join(REPO_ROOT, 'src/desktop/externalApi/externalApiToolExecutor.ts');
const SRC_ROOT = join(REPO_ROOT, 'src');
const TOOLS_DIR = 'src/tools/desktop/';
const EXECUTOR_DIR = 'src/desktop/externalApi/';

// Callers of these executor methods outside src/tools/desktop, with the reason each is safe.
const OUTSIDE_TOOLS_ALLOWLIST: Readonly<Record<string, string>> = {};

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
}

function callsMatching(node: ts.Node, test: (call: ts.CallExpression) => boolean): boolean {
  let found = false;
  const visit = (child: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(child) && test(child)) {
      found = true;
      return;
    }
    child.forEachChild(visit);
  };
  visit(node);
  return found;
}

function calledMethod(call: ts.CallExpression): string | undefined {
  return ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : undefined;
}

// Public executor methods that route through applyDocument, except the apply*Document family
// (those tools already render warnings through the apply preamble). Direct calls only: a method
// that reaches applyDocument through another public method is not seen.
function applyBackedMethods(): string[] {
  const methods: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isMethodDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text !== 'applyDocument' &&
      !/^apply\w+Document$/.test(node.name.text) &&
      !node.modifiers?.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword) &&
      node.body &&
      callsMatching(
        node.body,
        (call) =>
          ts.isPropertyAccessExpression(call.expression) &&
          call.expression.expression.kind === ts.SyntaxKind.ThisKeyword &&
          call.expression.name.text === 'applyDocument',
      )
    ) {
      methods.push(node.name.text);
    }
    node.forEachChild(visit);
  };
  visit(parse(EXECUTOR_FILE));
  return methods.sort();
}

function isEnoent(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

// Other suites create scratch directories under src/, so a vanished directory is skipped.
function sourceFiles(dir = SRC_ROOT): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if (isEnoent(error)) return [];
    throw error;
  }
  return entries.flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return relativePath(path + '/').startsWith(EXECUTOR_DIR) ? [] : sourceFiles(path);
    }
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

function relativePath(file: string): string {
  return file.slice(REPO_ROOT.length + 1).replaceAll('\\', '/');
}

function registeredToolName(source: ts.SourceFile): string | undefined {
  let name: string | undefined;
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'name' &&
      ts.isStringLiteralLike(node.initializer) &&
      ts.isObjectLiteralExpression(node.parent) &&
      ts.isNewExpression(node.parent.parent)
    ) {
      name ??= node.initializer.text;
    }
    node.forEachChild(visit);
  };
  visit(source);
  return name;
}

function passesProperty(source: ts.SourceFile, property: string): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === property
    ) {
      found = true;
    }
    node.forEachChild(visit);
  };
  visit(source);
  return found;
}

type Offender = { file: string; tool: string | undefined; problem: string };

function unwiredTools(): { offenders: Offender[]; toolNames: string[] } {
  const methods = new Set(applyBackedMethods());
  const offenders: Offender[] = [];
  const toolNames: string[] = [];
  for (const file of sourceFiles()) {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch (error) {
      if (isEnoent(error)) continue;
      throw error;
    }
    if (![...methods].some((method) => text.includes(`.${method}(`))) continue;
    const source = parse(file);
    if (!callsMatching(source, (call) => methods.has(calledMethod(call) ?? ''))) continue;
    const relative = relativePath(file);
    if (!relative.startsWith(TOOLS_DIR)) {
      if (OUTSIDE_TOOLS_ALLOWLIST[relative] === undefined) {
        offenders.push({
          file: relative,
          tool: undefined,
          problem: 'calls an applyDocument backed executor method outside src/tools/desktop',
        });
      }
      continue;
    }
    const tool = registeredToolName(source);
    if (tool !== undefined) toolNames.push(tool);
    if (
      !callsMatching(
        source,
        (call) => ts.isIdentifier(call.expression) && call.expression.text === 'commandOk',
      )
    ) {
      offenders.push({ file: relative, tool, problem: 'does not call commandOk' });
    }
    if (!passesProperty(source, 'getSuccessResult')) {
      offenders.push({ file: relative, tool, problem: 'does not pass getSuccessResult' });
    }
  }
  return { offenders, toolNames: toolNames.sort() };
}

type ToolCase = {
  make: (server: DesktopMcpServer) => DesktopTool<any>;
  args: Record<string, unknown>;
  clean: Record<string, unknown>;
};

const SORT_XML = `<?xml version="1.0"?>
<worksheet name="Sales">
  <table>
    <view>
      <datasources><datasource name="Superstore" /></datasources>
      <datasource-dependencies datasource="Superstore">
        <column-instance column="[Region]" derivation="None" name="[none:Region:nk]" pivot="key" type="nominal" />
      </datasource-dependencies>
    </view>
    <rows>[Superstore].[none:Region:nk]</rows>
  </table>
</worksheet>`;

const TOOL_CASES: Record<string, ToolCase> = {
  'undo-workbook': {
    make: getUndoWorkbookTool,
    args: {},
    clean: { message: 'Undid the last change to the open workbook.' },
  },
  'redo-workbook': {
    make: getRedoWorkbookTool,
    args: {},
    clean: { message: 'Reapplied the most recently undone change to the open workbook.' },
  },
  'add-worksheet': {
    make: getAddWorksheetTool,
    args: {},
    clean: { message: 'Added a blank worksheet.' },
  },
  'add-dashboard': {
    make: getAddDashboardTool,
    args: {},
    clean: { message: 'Added a blank dashboard.' },
  },
  'add-storyboard': {
    make: getAddStoryboardTool,
    args: {},
    clean: { message: 'Added a blank storyboard.' },
  },
  'delete-sheet': {
    make: getDeleteSheetTool,
    args: { sheet: 'Dash' },
    clean: {
      deleted: true,
      sheet: { id: 'd1', kind: 'dashboard', name: 'Dash' },
      message: 'Deleted dashboard "Dash".',
    },
  },
  'rename-sheet': {
    make: getRenameSheetTool,
    args: { sheet: 'Sales', name: 'Revenue' },
    clean: {
      sheet: { id: 'ws1', kind: 'worksheet', name: 'Revenue' },
      previousName: 'Sales',
      message: 'Renamed worksheet "Sales" to "Revenue".',
    },
  },
  'sort-worksheet': {
    make: getSortWorksheetTool,
    args: { worksheet: 'Sales', fieldName: 'Region' },
    clean: {
      worksheet: { id: 'ws1', name: 'Sales' },
      fieldName: '[Superstore].[none:Region:nk]',
      message:
        'Desktop accepted the request to sort worksheet "Sales" by "[Superstore].[none:Region:nk]". The result was not independently verified.',
    },
  },
  'show-me': {
    make: getShowMeTool,
    args: { worksheet: 'Sales', showMeType: 'bars' },
    clean: {
      showMeRequested: true,
      operationStatus: 'completed',
      worksheet: { id: 'ws1', name: 'Sales' },
      showMeType: 'bars',
      message:
        'Desktop accepted Show Me type "bars" for worksheet "Sales". The resulting visualization was not independently verified.',
    },
  },
  'open-file': {
    make: getOpenFileTool,
    args: { filePath: '/a/Book.twbx' },
    clean: { message: 'Opened "/a/Book.twbx".' },
  },
  'save-workbook': {
    make: getSaveWorkbookTool,
    args: { filePath: '/a/Copy.twbx' },
    clean: { message: 'Saved a copy to "/a/Copy.twbx".' },
  },
  'workbook-export-as': {
    make: getWorkbookExportAsTool,
    args: { format: 'pdf', filePath: '/a/Book.pdf' },
    clean: { message: 'Exported the workbook to "/a/Book.pdf".' },
  },
  'refresh-datasource-data': {
    make: getRefreshDatasourceDataTool,
    args: { datasourceId: 'ds1' },
    clean: { message: 'Refreshed the live data for datasource "ds1".' },
  },
  'refresh-datasource-extract': {
    make: getRefreshDatasourceExtractTool,
    args: { datasourceId: 'ds1' },
    clean: { message: 'Refreshed the extract for datasource "ds1".' },
  },
  'pause-auto-updates': {
    make: getPauseAutoUpdatesTool,
    args: { sheet: 'Sales' },
    clean: {
      paused: true,
      sheet: { id: 'ws1', kind: 'worksheet', name: 'Sales' },
      message: 'Paused auto-updates for worksheet "Sales".',
    },
  },
  'resume-auto-updates': {
    make: getResumeAutoUpdatesTool,
    args: { sheet: 'Sales' },
    clean: {
      resumed: true,
      sheet: { id: 'ws1', kind: 'worksheet', name: 'Sales' },
      message: 'Resumed auto-updates for worksheet "Sales".',
    },
  },
  'refresh-auto-updates': {
    make: getRefreshAutoUpdatesTool,
    args: { worksheet: 'Sales' },
    clean: {
      refreshed: true,
      worksheet: { id: 'ws1', name: 'Sales' },
      message: 'Refreshed auto-updates for worksheet "Sales".',
    },
  },
  'refresh-dashboard-auto-updates': {
    make: getRefreshDashboardAutoUpdatesTool,
    args: { dashboard: 'Dash' },
    clean: {
      dashboard: { id: 'd1', name: 'Dash' },
      outcome: 'COMPLETE',
      refreshed: [],
      failed: [],
      message: 'Refreshed auto-updates for dashboard "Dash".',
    },
  },
  'refresh-storyboard-auto-updates': {
    make: getRefreshStoryboardAutoUpdatesTool,
    args: { storyboard: 'Story' },
    clean: {
      storyboard: { id: 's1', name: 'Story' },
      outcome: 'COMPLETE',
      refreshed: [],
      failed: [],
      message: 'Refreshed auto-updates for the current point of storyboard "Story".',
    },
  },
  'activate-sheet': {
    make: getActivateSheetTool,
    args: { sheetName: 'Sales' },
    clean: {
      focus_requested: true,
      sheetName: 'Sales',
      message: 'Requested focus on sheet "Sales".',
      availableSheets: ['Sales', 'Dash', 'Story'],
    },
  },
};

function executorReturning(
  warnings: Array<{ code: string; message: string }> | undefined,
  status: 'completed' | 'running' = 'completed',
): {
  executor: ExternalApiToolExecutor;
} {
  const command = {
    command_id: 'c1',
    status,
    submitted_at: '2026-01-01T00:00:00Z',
    parsedResult: { outcome: 'COMPLETE', refreshed: [], failed: [] },
    ...(warnings ? { warnings } : {}),
  } as unknown as ExecuteCommandResult<undefined>;
  const overrides: Record<string, unknown> = {
    listWorksheets: vi
      .fn()
      .mockResolvedValue(Ok({ worksheets: [{ id: 'ws1', name: 'Sales', hidden: false }] })),
    listDashboards: vi
      .fn()
      .mockResolvedValue(Ok({ dashboards: [{ id: 'd1', name: 'Dash', hidden: false }] })),
    listStoryboards: vi
      .fn()
      .mockResolvedValue(Ok({ storyboards: [{ id: 's1', name: 'Story', hidden: false }] })),
    getWorksheetDocument: vi.fn().mockResolvedValue(Ok({ xml: SORT_XML })),
    getWorkbook: vi.fn().mockResolvedValue(Ok({ title: 'Book1', unsavedChanges: false })),
  };
  for (const method of applyBackedMethods()) {
    overrides[method] = vi.fn().mockResolvedValue(Ok(command));
  }
  return { executor: makeExecutorMock(overrides as Partial<ExternalApiToolExecutor>) };
}

async function callTool(
  toolCase: ToolCase,
  warnings: Array<{ code: string; message: string }> | undefined,
  status: 'completed' | 'running' = 'completed',
): Promise<CallToolResult> {
  const tool = toolCase.make(new DesktopMcpServer());
  const callback = (await Provider.from(tool.callback)) as (
    args: Record<string, unknown>,
    extra: ReturnType<typeof getMockRequestHandlerExtra>,
  ) => Promise<CallToolResult>;
  const { executor } = executorReturning(warnings, status);
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: vi.fn().mockResolvedValue(executor),
  };
  return await callback(toolCase.args, extra);
}

function textOf(result: CallToolResult): string {
  invariant(result.content[0].type === 'text');
  return result.content[0].text;
}

describe('Desktop command tools show Desktop warnings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('wires commandOk and getSuccessResult into every tool backed by an applyDocument method', () => {
    expect(unwiredTools().offenders).toEqual([]);
  });

  it('has a behavioural case for exactly the tools backed by an applyDocument method', () => {
    expect(Object.keys(TOOL_CASES).sort()).toEqual(unwiredTools().toolNames);
  });

  describe.each(Object.entries(TOOL_CASES))('%s', (_name, toolCase) => {
    it('keeps a clean result byte identical', async () => {
      const result = await callTool(toolCase, undefined);

      expect(result.isError).toBe(false);
      expect(result.structuredContent).toBeUndefined();
      expect(textOf(result)).toBe(JSON.stringify(toolCase.clean));
    });

    it('treats an empty warnings array as clean', async () => {
      const result = await callTool(toolCase, []);

      expect(result.structuredContent).toBeUndefined();
      expect(textOf(result)).toBe(JSON.stringify(toolCase.clean));
    });

    it('shows the warnings and never reads as done', async () => {
      const result = await callTool(toolCase, [{ code: 'w1', message: 'm' }]);

      expect(result.isError).toBe(false);
      const body = JSON.parse(textOf(result)) as { message: string; warnings: unknown };
      expect(body.message).toContain('but Desktop reported 1 warning(s).');
      expect(body.message).toContain('- w1: m');
      expect(body.warnings).toEqual([{ code: 'w1', message: 'm' }]);
      expect(result.structuredContent).toMatchObject({ nextAction: { kind: 'prefill' } });
    });
  });

  it.each(['show-me', 'sort-worksheet'])(
    'keeps the not independently verified note on a warned %s result',
    async (name) => {
      const result = await callTool(TOOL_CASES[name], [{ code: 'w1', message: 'm' }]);

      expect(JSON.parse(textOf(result)).message).toContain('not independently verified');
    },
  );

  it('words a pending dashboard refresh as a request, not a completed refresh', async () => {
    const result = await callTool(
      TOOL_CASES['refresh-dashboard-auto-updates'],
      undefined,
      'running',
    );

    expect(JSON.parse(textOf(result)).message).toBe(
      'Requested refreshing auto-updates for dashboard "Dash"; Desktop is still applying it.',
    );
  });

  it('keeps Desktop warnings on an in place save that left the workbook dirty', async () => {
    const tool = getSaveWorkbookTool(new DesktopMcpServer());
    const callback = (await Provider.from(tool.callback)) as (
      args: Record<string, unknown>,
      extra: ReturnType<typeof getMockRequestHandlerExtra>,
    ) => Promise<CallToolResult>;
    const { executor } = executorReturning([{ code: 'w1', message: 'm' }]);
    vi.mocked(executor.getWorkbook).mockResolvedValue(
      Ok({ title: 'Book1', unsavedChanges: true } as never),
    );
    const extra = {
      ...getMockRequestHandlerExtra(),
      getExecutor: vi.fn().mockResolvedValue(executor),
    };

    const result = await callback({}, extra);

    expect(result.isError).toBe(true);
    const body = JSON.parse(textOf(result)) as { message: string; warnings: unknown };
    expect(body.message).toContain('The save did not complete');
    expect(body.message).toContain('- w1: m');
    expect(body.warnings).toEqual([{ code: 'w1', message: 'm' }]);
    expect(result.structuredContent).toMatchObject({ nextAction: { kind: 'prefill' } });
  });
});
