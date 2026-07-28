import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import ts from 'typescript';

/**
 * Every live write states where the view belongs. The type makes omission a compile error;
 * this test makes a silent reclassification a readable diff.
 *
 * The table below is the checked-in verdict for every call site, in source order. Change a
 * disposition and this test prints the file, the seam, and the before/after — so the change
 * is reviewed as a product decision rather than slipping in as a refactor.
 *
 * - `artifact` — this write produced the thing the user asked to see.
 * - `restore`  — this write produced nothing to look at; give the user their sheet back.
 * - `none`     — a later write in the same call names the place.
 * - `forward`  — a seam passing its own caller's verdict through (the three load commands).
 *
 * Cost note: the scan reads exactly the files listed here, once each. Keep it that way —
 * a whole-tree walk is what makes a source-scan test time out in CI.
 */
const DISPOSITIONS: Readonly<Record<string, readonly string[]>> = {
  'src/desktop/commands/workbook/loadWorkbookXml.ts': ['applyWorkbookText:forward'],
  'src/desktop/commands/workbook/loadWorksheetXml.ts': ['applyWorkbookText:forward'],
  'src/desktop/commands/workbook/loadDashboardXml.ts': ['applyWorkbookText:forward'],
  'src/tools/desktop/binder/bindTemplate.ts': ['loadWorkbookXml:artifact'],
  'src/tools/desktop/coordination/buildAndApplyWorksheet.ts': ['loadWorksheetXml:artifact'],
  'src/tools/desktop/coordination/batchCreateAndCacheSheets.ts': ['loadWorkbookXml:restore'],
  'src/tools/desktop/dashboard/applyDashboard.ts': ['loadDashboardXml:artifact'],
  'src/tools/desktop/dashboard/applyDashboardWithViewpoints.ts': [
    'loadDashboardXml:none',
    'loadWorkbookXml:artifact',
  ],
  'src/tools/desktop/dashboard/buildAndApplyDashboard.ts': [
    'loadDashboardXml:none',
    'loadWorkbookXml:artifact',
  ],
  'src/tools/desktop/dashboard/composeDashboard.ts': [
    'loadDashboardXml:none',
    'loadWorkbookXml:artifact',
  ],
  'src/tools/desktop/dashboard/dashboardAutoApply.ts': [
    'loadWorkbookXml:artifact',
    'loadDashboardXml:artifact',
  ],
  'src/tools/desktop/data-source/authorAction.ts': ['applyWorkbookText:restore'],
  'src/tools/desktop/data-source/authorCalcCore.ts': ['applyWorkbookText:restore'],
  'src/tools/desktop/data-source/authorSet.ts': ['applyWorkbookText:restore'],
  'src/tools/desktop/data-source/formatLabels.ts': ['applyWorkbookText:artifact'],
  'src/tools/desktop/workbook/applyWorkbook.ts': ['loadWorkbookXml:restore'],
  'src/tools/desktop/worksheet/applyWorksheet.ts': ['loadWorksheetXml:artifact'],
  'src/tools/desktop/worksheet/deleteWorksheet.ts': ['loadWorkbookXml:restore'],
  'src/tools/desktop/worksheet/refineWorksheet.ts': ['loadWorksheetXml:artifact'],
};

const SEAMS = new Set([
  'loadWorkbookXml',
  'loadWorksheetXml',
  'loadDashboardXml',
  'applyWorkbookText',
]);

const REPO_ROOT = join(__dirname, '../../../..');

/** Seam calls in one file, in source order, each as `seam:disposition`. */
function seamCalls(source: string): string[] {
  const sourceFile = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true);
  const found: string[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      SEAMS.has(node.expression.text)
    ) {
      found.push(`${node.expression.text}:${disposition(node)}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  return found;
}

function disposition(call: ts.CallExpression): string {
  const [arg] = call.arguments;
  if (!arg || !ts.isObjectLiteralExpression(arg)) return 'NOT-AN-OBJECT-ARGUMENT';

  const focus = arg.properties.find(
    (property) => property.name !== undefined && property.name.getText() === 'focus',
  );
  if (focus === undefined) return 'MISSING';
  if (ts.isShorthandPropertyAssignment(focus)) return 'forward';
  if (!ts.isPropertyAssignment(focus)) return 'UNREADABLE';

  const value = focus.initializer;
  if (ts.isIdentifier(value)) return 'forward';
  if (!ts.isObjectLiteralExpression(value)) return 'NOT-A-LITERAL';

  const navigate = value.properties.find(
    (property) => property.name !== undefined && property.name.getText() === 'navigate',
  );
  if (navigate === undefined || !ts.isPropertyAssignment(navigate)) return 'NO-NAVIGATE';
  return ts.isStringLiteral(navigate.initializer)
    ? navigate.initializer.text
    : 'NOT-A-LITERAL-NAVIGATE';
}

const SEAM_CALL_RE = new RegExp(`\\b(?:${[...SEAMS].join('|')})\\s*\\(`);

/**
 * Files that call a seam, found by reading each source file once and testing one regex —
 * no parsing and no module graph, which is what keeps this in the tens of milliseconds.
 */
function filesCallingASeam(): string[] {
  return readdirSync(join(REPO_ROOT, 'src'), { recursive: true })
    .map(String)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .filter((file) => SEAM_CALL_RE.test(readFileSync(join(REPO_ROOT, 'src', file), 'utf-8')))
    .map((file) => `src/${file}`)
    .sort();
}

describe('apply focus dispositions', () => {
  it('matches the checked-in verdict for every write seam call site', { timeout: 30_000 }, () => {
    const actual: Record<string, string[]> = {};
    for (const file of Object.keys(DISPOSITIONS)) {
      actual[file] = seamCalls(readFileSync(join(REPO_ROOT, file), 'utf-8'));
    }

    expect(actual).toEqual(
      Object.fromEntries(Object.entries(DISPOSITIONS).map(([file, calls]) => [file, [...calls]])),
    );
  });

  it('leaves no seam call site out of the table', { timeout: 30_000 }, () => {
    expect(filesCallingASeam()).toEqual(Object.keys(DISPOSITIONS).sort());
  });
});
