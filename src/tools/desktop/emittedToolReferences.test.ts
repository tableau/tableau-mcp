import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import ts from 'typescript';

import { desktopToolNames } from './toolName.js';

const REPO_ROOT = join(__dirname, '../../..');
const DESKTOP_TOOLS_ROOT = join(REPO_ROOT, 'src/tools/desktop');

// Files outside the walked root whose string literals still reach the model verbatim.
// Keep this list minimal: widen it only when an out-of-root file emits guidance prose.
const EXTRA_FILES = [
  // Binder blocker codes and bind explanations are built here and surfaced unchanged
  // through bind-template results.
  'src/desktop/binder/explicit-bind.ts',
] as const;

const CONDITIONAL_TOOLS = ['inject-template', 'apply-workbook', 'apply-dashboard'] as const;

// Kebab-case tokens emitted by desktop tools that are NOT tool-name references: XML
// element/attribute/value vocabulary, External Client API operation names (load-*),
// blocker/status/disposition codes, repair-primitive and cache-prefix identifiers, file
// names, and hyphenated prose. Sorted; every entry must still be matched by the scan
// (see the dead-vocabulary test below).
const NON_TOOL_VOCABULARY = [
  'active-id',
  'add-or-remove-marks',
  'agg-type',
  'aggregation-level-mismatch',
  'ambiguous-field',
  'apply-native-custom-theme',
  'apply-theme',
  'as-is',
  'async-settle',
  'auto-apply',
  'auto-detect',
  'auto-grid',
  'auto-updates',
  'awaiting-user',
  'background-color',
  'base-column-conflict',
  'binding-field',
  'binding-slot',
  'border-color',
  'border-style',
  'border-width',
  'byte-order',
  'cached-file',
  'calc-dependency-unmet',
  'calculation-input',
  'candidate-build',
  'captured-sheet',
  'changed-or-unreadable',
  'clear-option',
  'column-instance',
  'command-failed',
  'command-postcondition',
  'computed-sort',
  'corner-radius',
  'cross-datasource-binding',
  'custom-theme',
  'dashboard-image',
  'dashboard-xml-guide',
  'data-catalog-connect-to-file',
  'data-source-order',
  'datasource-dependencies',
  'datasource-mismatch',
  'datatype-customized',
  'default-format',
  'derivation-illegal',
  'desktop-instance-missing',
  'diff-corpus',
  'do-nothing',
  'down-saved',
  'edit-group-action',
  'edit-parameter-action',
  'empty-level',
  'enable-sort-zone-taborder',
  'endpoint-not-in-this-build',
  'exclude-all',
  'execute-command-error',
  'executive-summary',
  'export-theme',
  'field-not-compatible',
  'field-not-found',
  'file-contents',
  'file-name',
  'file-not-found',
  'filter-by',
  'filter-field',
  'filter-group',
  'follow-up',
  'for-parallel-build',
  'formatted-text',
  'get-dashboard-xml-error',
  'get-worksheet-xml-error',
  'high-level',
  'ignored-redundant-aggregation',
  'in-dashboard',
  'in-place',
  'in-use',
  'input-validation',
  'intermediate-leg',
  'invalid-response',
  'invalid-xml',
  'is-leaf-connection',
  'is-leaf-connection-ui',
  'judgment-needed',
  'kind-mismatch',
  'kpi-text',
  'layout-basic',
  'layout-flow',
  'level-members',
  // load-* entries are External Client API operation names (and their error codes), the
  // machine the apply-* tools drive — not MCP tool names.
  'load-dashboard',
  'load-dashboard-xml-error',
  'load-rejected',
  'load-storyboard',
  'load-workbook',
  'load-workbook-xml-error',
  'load-worksheet',
  'load-worksheet-xml-error',
  'malformed-worksheet-fragment',
  'mark-labels',
  'mark-labels-show',
  'missing-required-slot',
  'name-only',
  'name-style',
  'nav-type',
  'no-desktop-instances-found',
  'non-empty',
  'non-federated',
  'non-template',
  'none-available',
  'not-applied',
  'not-found',
  'not-run',
  'on-hover',
  'on-menu',
  'on-select',
  'order-dependent',
  'output-serialization-failed',
  'packaged-workbook',
  'param-domain-type',
  'part-to-whole-waterfall',
  'post-apply',
  'post-apply-read',
  'post-dashboard-workbook-read',
  'post-dispatch',
  'post-injection',
  'pre-dispatch',
  'pre-dispatch-validation',
  'pre-dispatch-workbook-drift',
  'preflight-invariant',
  'prior-version',
  'quantitative-or-categorical',
  'ranking-ordered-bar',
  're-call',
  're-enables',
  're-inject',
  're-planning',
  're-read',
  're-reading',
  're-resolve',
  're-run',
  're-scoped',
  'readback-verification',
  // Health-check repair-primitive codes, not tools the model can call.
  'reinject-from-template',
  'render-diagnostics',
  'required-slot-missing',
  'row-level',
  'safe-by-construction',
  'screenshot-diff',
  'selection-clear-set-option',
  'self-closing',
  'session-mismatch',
  'sheet-not-found',
  'should-clear',
  'show-all',
  'show-nav-arrows',
  'simple-id',
  'single-select',
  'sizing-mode',
  'slot-not-offered',
  'slot-to-field',
  'source-field',
  'story-point',
  'story-points',
  'storyboard-image',
  'studio-theme',
  'style-rule',
  'style-theme',
  'success-already-present',
  'summary-data',
  'tableau-agent-idempotency-key',
  'target-group',
  'target-parameter',
  'template-artifact-unavailable',
  'template-not-found',
  'template-not-offered',
  'template-owned',
  'text-format',
  'theme-json-syntax',
  'too-new',
  'top-level',
  'top-n',
  'type-v2',
  'ui-builder',
  'ui-domain',
  'ui-enumeration',
  'ui-filter-by-field',
  'ui-marker',
  'ui-top-by-field',
  'unexpected-error',
  'unresolved-column-ref',
  'unresolved-field-mapping',
  'unsupported-version',
  'utf-8',
  'validation-failed',
  'validation-passing',
  'viewpoint-injection',
  'viewpoint-workbook-apply',
  'viz-specific',
  'well-formed',
  'workbook-change',
  'workbook-datasource',
  'workbook-drift',
  'workbook-read',
  'worksheet-edit-buffer',
  'worksheet-image',
  'zone-delete',
  'zone-style',
  'zone-surgery',
] as const;

const TOOL_NAME_CANDIDATE_RE = /\b[a-z][a-z0-9]*(?:-[a-z0-9]+)+\b/g;

type Candidate = {
  token: string;
  file: string;
  literal: string;
};

// Every non-test .ts file under src/tools/desktop, plus EXTRA_FILES: a new tool's guidance
// prose is covered the moment its file lands, with no list to remember to update.
function sourceFiles(): string[] {
  return readdirSync(DESKTOP_TOOLS_ROOT, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .map((file) => join(DESKTOP_TOOLS_ROOT, file))
    .concat(EXTRA_FILES.map((file) => join(REPO_ROOT, file)));
}

function stringLiterals(source: string): string[] {
  const sourceFile = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true);
  const literals: string[] = [];

  function visit(node: ts.Node): void {
    // Module specifiers are dependency paths, not emitted guidance. Scanning them forces an
    // allowlist entry for every hyphenated internal filename and obscures real tool references.
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      return;
    }
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

const scannedCandidates = sourceFiles().flatMap((fullPath) => {
  const file = relative(REPO_ROOT, fullPath).replaceAll('\\', '/');
  return toolNameCandidates(file, readFileSync(fullPath, 'utf-8'));
});

describe('Desktop emitted tool references', () => {
  it('does not register retired template wrappers', () => {
    expect(desktopToolNames).not.toEqual(
      expect.arrayContaining(['propose-template', 'validate-proposal', 'list-xml-templates']),
    );
  });

  it('keeps guidance tool-name tokens aligned with the Desktop registry', () => {
    const registered = new Set<string>(desktopToolNames);
    const conditional = new Set<string>(CONDITIONAL_TOOLS);
    const nonToolVocabulary = new Set<string>(NON_TOOL_VOCABULARY);

    const conditionalMissing = CONDITIONAL_TOOLS.filter((toolName) => !registered.has(toolName));
    expect(conditionalMissing, 'conditional tools must also be registered').toEqual([]);

    const offenders = scannedCandidates.filter(
      ({ token }) =>
        !registered.has(token) && !conditional.has(token) && !nonToolVocabulary.has(token),
    );

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

  it('keeps NON_TOOL_VOCABULARY sorted, unique, and matched by the scan', () => {
    // used == declared: an entry no source file emits any more is dead weight that could
    // silently mask a future tool-name typo, so it must be removed when its literal goes.
    expect([...NON_TOOL_VOCABULARY]).toEqual([...new Set(NON_TOOL_VOCABULARY)].sort());

    const matched = new Set(scannedCandidates.map(({ token }) => token));
    const dead = NON_TOOL_VOCABULARY.filter((entry) => !matched.has(entry));
    expect(dead, 'vocabulary entries no scanned file emits — delete them').toEqual([]);
  });
});
