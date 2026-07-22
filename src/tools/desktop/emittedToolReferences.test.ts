import { readFileSync } from 'fs';
import { dirname, join, relative } from 'path';
import ts from 'typescript';
import { fileURLToPath } from 'url';

import { desktopToolNames } from './toolName.js';

const SOURCE_FILES = [
  'src/tools/desktop/binder/bindTemplate.ts',
  'src/desktop/binder/explicit-bind.ts',
  'src/tools/desktop/coordination/planDashboardCreation.ts',
  'src/tools/desktop/dashboard/dashboardAutoApply.ts',
  'src/tools/desktop/fields/addField.ts',
  'src/tools/desktop/fields/removeField.ts',
  'src/tools/desktop/coordination/batchCreateAndCacheSheets.ts',
] as const;

const CONDITIONAL_TOOLS = ['inject-template', 'apply-workbook', 'apply-dashboard'] as const;
const NON_TOOL_VOCABULARY = [
  'all-or-nothing',
  'already-bound',
  'ambiguous-field',
  'auto-apply',
  'auto-grid',
  'base-column-conflict',
  'bind-template-shaped',
  'calc-dependency-unmet',
  'column-instance',
  'cross-datasource-binding',
  'data-source',
  'datasource-dependencies',
  'derivation-illegal',
  'double-count',
  'episode-events',
  'execute-command-error',
  'fast-path',
  'field-not-found',
  'field-resolver',
  'for-parallel-build',
  'get-dashboard-xml-error',
  'get-worksheet-xml-error',
  'higher-confidence',
  'ignored-redundant-aggregation',
  'kind-mismatch',
  'kpi-text',
  'load-dashboard-xml-error',
  'load-rejected',
  'load-workbook',
  'load-workbook-xml-error',
  'low-confidence',
  'manifest-layer-unavailable',
  'manifest-types',
  'missing-required-slot',
  'no-manifest',
  'not-fast-path',
  'order-dependent',
  'part-to-whole-pie-chart',
  'part-to-whole-waterfall',
  'per-viz',
  'pre-edit',
  'promise-check',
  'ranking-ordered-bar',
  're-apply',
  're-call',
  're-planning',
  're-propose',
  're-run',
  're-applying',
  'route-gate',
  'route-spec',
  'route-state',
  'row-type',
  'schema-summary',
  'schema-too-large',
  'server-side',
  'template-not-found',
  'template-owned',
  'ts-results-es',
  'unresolved-column-ref',
  'unresolved-field-mapping',
  'utf-8',
  'validation-failed',
] as const;

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const TOOL_NAME_CANDIDATE_RE = /\b[a-z][a-z0-9]*(?:-[a-z0-9]+)+\b/g;

type Candidate = {
  token: string;
  file: string;
  literal: string;
};

function stringLiterals(source: string): string[] {
  const sourceFile = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true);
  const literals: string[] = [];

  function visit(node: ts.Node): void {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      literals.push(node.text);
    }
    if (ts.isTemplateExpression(node)) {
      literals.push(node.head.text);
      for (const span of node.templateSpans) {
        literals.push(span.literal.text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  return literals;
}

function toolNameCandidates(file: string, source: string): Candidate[] {
  return stringLiterals(source).flatMap((literal) =>
    [...literal.matchAll(TOOL_NAME_CANDIDATE_RE)].map((match) => ({
      token: match[0],
      file,
      literal,
    })),
  );
}

function formatLiteral(literal: string): string {
  const normalized = literal.replace(/\s+/g, ' ').trim();
  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}

describe('Desktop emitted tool references', () => {
  it('keeps guidance tool-name tokens aligned with the Desktop registry', () => {
    const registered = new Set<string>(desktopToolNames);
    const conditional = new Set<string>(CONDITIONAL_TOOLS);
    const nonToolVocabulary = new Set<string>(NON_TOOL_VOCABULARY);

    const conditionalMissing = CONDITIONAL_TOOLS.filter((toolName) => !registered.has(toolName));
    expect(conditionalMissing, 'conditional tools must also be registered').toEqual([]);

    const offenders = SOURCE_FILES.flatMap((sourceFile) => {
      const fullPath = join(REPO_ROOT, sourceFile);
      const file = relative(REPO_ROOT, fullPath);
      const source = readFileSync(fullPath, 'utf-8');
      return toolNameCandidates(file, source).filter(
        ({ token }) =>
          !registered.has(token) && !conditional.has(token) && !nonToolVocabulary.has(token),
      );
    });

    const uniqueOffenders = [
      ...new Map(
        offenders.map((offender) => [
          `${offender.token}\0${offender.file}\0${offender.literal}`,
          offender,
        ]),
      ).values(),
    ];

    expect(
      uniqueOffenders.map(
        ({ token, file, literal }) => `${token} in ${file}: "${formatLiteral(literal)}"`,
      ),
    ).toEqual([]);
  });
});
