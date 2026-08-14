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
  'src/desktop/wrappers/loadWorkbookXml.ts': ['applyWorkbookText:forward'],
  'src/desktop/wrappers/loadWorksheetXml.ts': [
    'applyWorkbookText:forward',
    'applyWorkbookText:forward',
  ],
  // loadStoryboardXml forwards its caller's verdict straight into loadDashboardXml (storyboards
  // reuse the dashboard per-sheet path), so this file has two forward seams in source order.
  'src/desktop/wrappers/loadDashboardXml.ts': [
    'loadDashboardXml:forward',
    'applyWorkbookText:forward',
  ],
  'src/tools/desktop/authoring/binder/bindTemplate.ts': ['loadWorkbookXml:artifact'],
  'src/tools/desktop/authoring/sheets/buildAndApplyWorksheet.ts': ['loadWorksheetXml:artifact'],
  'src/tools/desktop/authoring/sheets/batchCreateAndCacheSheets.ts': ['loadWorkbookXml:restore'],
  'src/tools/desktop/api/applyDashboard.ts': ['loadDashboardXml:artifact'],
  'src/tools/desktop/authoring/sheets/applyDashboardWithViewpoints.ts': [
    'loadDashboardXml:artifact',
    'loadWorkbookXml:artifact',
  ],
  'src/tools/desktop/authoring/sheets/buildAndApplyDashboard.ts': [
    'loadDashboardXml:artifact',
    'loadWorkbookXml:artifact',
  ],
  'src/tools/desktop/api/applyWorksheetArtifact.ts': ['loadWorksheetXml:artifact'],
  'src/tools/desktop/authoring/sheets/composeDashboardCore.ts': ['loadWorkbookXml:artifact'],
  'src/tools/desktop/authoring/sheets/runDashboardBatch.ts': ['loadWorkbookXml:none'],
  'src/tools/desktop/authoring/datasource/authorAction.ts': ['loadWorkbookXml:restore'],
  'src/tools/desktop/authoring/datasource/authorCalcCore.ts': ['loadWorkbookXml:restore'],
  'src/tools/desktop/authoring/datasource/authorSet.ts': ['loadWorkbookXml:restore'],
  'src/tools/desktop/authoring/datasource/formatLabels.ts': ['loadWorkbookXml:artifact'],
  'src/tools/desktop/authoring/style/applyWorkbookStyle.ts': ['loadWorkbookXml:restore'],
  'src/tools/desktop/api/applyWorkbook.ts': ['loadWorkbookXml:restore'],
  'src/tools/desktop/api/applyWorksheet.ts': ['loadWorksheetXml:artifact'],
  'src/tools/desktop/authoring/sheets/refineWorksheet.ts': ['loadWorksheetXml:artifact'],
};

const SEAMS = new Set([
  'loadWorkbookXml',
  'loadWorksheetXml',
  'loadDashboardXml',
  'applyWorkbookText',
]);

const REPO_ROOT = join(__dirname, '../../..');

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

function unguardedDerivedWorkbookCalls(source: string): number {
  const sourceFile = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true);
  let count = 0;
  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'loadWorkbookXml'
    ) {
      const [arg] = node.arguments;
      const guarded =
        arg &&
        ts.isObjectLiteralExpression(arg) &&
        arg.properties.some(
          (property) =>
            (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
            property.name.getText(sourceFile) === 'expectedWorkbookXml',
        );
      if (!guarded) count += 1;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return count;
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

  it('keeps raw whole-workbook dispatch inside the locking wrappers', () => {
    const outsideWrappers = Object.entries(DISPOSITIONS).flatMap(([file, expected]) =>
      file.startsWith('src/desktop/wrappers/')
        ? []
        : expected.filter((call) => call.startsWith('applyWorkbookText:')).map(() => file),
    );
    expect(outsideWrappers).toEqual([]);
  });

  it('guards every derived whole-workbook candidate against its live baseline', () => {
    const unconditionalTool = 'src/tools/desktop/api/applyWorkbook.ts';
    const unguarded = filesCallingASeam().flatMap((file) => {
      if (file.startsWith('src/desktop/wrappers/') || file === unconditionalTool) return [];
      const count = unguardedDerivedWorkbookCalls(readFileSync(join(REPO_ROOT, file), 'utf8'));
      return Array.from({ length: count }, () => file);
    });
    expect(unguarded).toEqual([]);
  });
});
