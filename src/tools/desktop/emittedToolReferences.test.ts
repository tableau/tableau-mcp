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

const CONDITIONAL_TOOLS = ['apply-workbook', 'apply-dashboard'] as const;

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
  'all-fields',
  'ambiguous-field',
  'as-is',
  'assign-fixed-value',
  'async-settle',
  'auto-apply',
  'auto-clear',
  'auto-generated',
  'auto-grid',
  'auto-updates',
  'background-color',
  'base-column-conflict',
  'binding-field',
  'binding-slot',
  'border-color',
  'border-style',
  'border-width',
  'calc-dependency-unmet',
  'calculation-caption',
  'calculation-formula',
  'calculation-input',
  'candidate-build',
  'captured-sheet',
  'categorical-bin',
  'changed-or-unreadable',
  'clear-option',
  'column-instance',
  'command-failed',
  'command-postcondition',
  'computed-sort',
  'corner-radius',
  'count-d',
  'cross-datasource-binding',
  'dashboard-image',
  'dashboard-only',
  'data-catalog-connect-to-file',
  'data-source-order',
  'datasource-dependencies',
  'datatype-customized',
  'date-time',
  'dates-and-times',
  'default-format',
  'default-zone-or-browser',
  'dependency-failed',
  'derivation-illegal',
  'do-nothing',
  'down-saved',
  'duplicate-slot-binding',
  'edit-group-action',
  'edit-parameter-action',
  'empty-level',
  'enable-sort-zone-taborder',
  'endpoint-not-in-this-build',
  'exclude-all',
  'exclude-sheet',
  'execute-command-error',
  'executive-summary',
  'field-captions',
  'field-not-compatible',
  'field-not-found',
  'file-not-found',
  'filter-by',
  'filter-field',
  'filter-group',
  'follow-up',
  'formatted-text',
  'generate-viz-from-notional-spec',
  'get-calc-details-pres-model-for-formula',
  'get-dashboard-xml-error',
  'get-worksheet-xml-error',
  'in-dashboard',
  'in-place',
  'in-use',
  'include-null',
  'input-validation',
  'instance-unavailable',
  'intermediate-leg',
  'invalid-formula',
  'invalid-response',
  'invalid-xml',
  'is-leaf-connection',
  'is-leaf-connection-ui',
  'keep-current',
  'kind-mismatch',
  'kpi-text',
  'layout-basic',
  'layout-cache',
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
  'mark-labels-show',
  'missing-required-slot',
  'multi-select',
  'name-only',
  'name-style',
  'nav-action',
  'nav-type',
  'no-desktop-instances-found',
  'non-empty',
  'non-federated',
  'non-string',
  'non-template',
  'not-applied',
  'not-found',
  'on-empty',
  'on-hover',
  'on-menu',
  'on-select',
  'operation-pending',
  'order-dependent',
  'output-serialization-failed',
  'packaged-workbook',
  'param-domain-type',
  // Field resolver transformation marker, not a callable tool.
  'part-to-whole-waterfall',
  'post-apply',
  'post-apply-read',
  'post-dispatch',
  'pre-dispatch',
  'pre-dispatch-validation',
  'pre-dispatch-workbook-drift',
  'preflight-invariant',
  'prior-version',
  'quantitative-or-categorical',
  're-call',
  're-enables',
  're-read',
  're-reading',
  're-run',
  'readback-verification',
  // Health-check repair-primitive codes, not tools the model can call.
  'required-slot-missing',
  'row-level',
  'selected-fields',
  'selection-clear-set-option',
  'self-closing',
  'semantic-values',
  'session-mismatch',
  'set-active-datasource',
  'set-value',
  'sheet-link',
  'sheet-not-found',
  'should-brush',
  'show-all',
  'show-nav-arrows',
  'simple-id',
  'single-select',
  'sizing-mode',
  'slot-not-offered',
  'source-field',
  'special-fields',
  'specific-zone',
  'stable-id',
  'start-page',
  'std-dev',
  'std-dev-p',
  'story-point',
  'story-points',
  'storyboard-image',
  'structural-readback-unavailable',
  'style-rule',
  'summary-data',
  'tableau-agent-idempotency-key',
  'target-changed',
  'target-group',
  'target-parameter',
  'target-read-failed',
  'target-unproven',
  'target-unresolved',
  'template-artifact-unavailable',
  'template-not-found',
  'template-not-offered',
  'template-owned',
  'text-format',
  'top-level',
  'top-n',
  'tsl-filter',
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
  'unsupported-api',
  'unsupported-version',
  'url-action-target',
  'url-action-type',
  'url-escape',
  'used-field-validity',
  'utf-8',
  'validation-failed',
  'validation-passing',
  'var-p',
  'well-formed',
  'window-screenshot',
  'workbook-datasource',
  'workbook-drift',
  'workbook-read',
  'worksheet-edit-buffer',
  'worksheet-image',
  'zone-style',
] as const;

const TOOL_NAME_CANDIDATE_RE = /\b[a-z][a-z0-9]*(?:-[a-z0-9]+)+\b/g;

type Candidate = {
  token: string;
  file: string;
  literal: string;
};

// Every non-test-support .ts file under src/tools/desktop, plus EXTRA_FILES: a new tool's
// guidance prose is covered the moment its file lands, with no list to remember to update.
// Test-support modules (unit tests, mocks, shared fixtures) are scaffolding, not guidance the
// model ever sees, so skip them all
const TEST_SUPPORT_RE = /(\.test|\.mock|\.testutils|testfixtures)\.ts$/i;
function sourceFiles(): string[] {
  return readdirSync(DESKTOP_TOOLS_ROOT, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith('.ts') && !TEST_SUPPORT_RE.test(file))
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

// A `tableau-`/`tableau_` prefix is never part of a registered name; any such token in
// src/desktop string literals is a stale spelling unless it is one of these.
const PREFIXED_TOKEN_RE = /(?<![\w-])tableau[-_][a-z][\w-]*/g;
const DESKTOP_ROOT = join(REPO_ROOT, 'src/desktop');
const PREFIXED_ALLOWED_TOKENS = new Set([
  'tableau-desktop-mcp',
  'tableau-error-code',
  'tableau-operation-id',
  'tableau-application-version',
  'tableau-xsd-payload-version',
]);
const PREFIXED_ALLOWED_FILES = new Set([
  // QUERY_TOOL_JARGON is a search stop-word list, never rendered.
  'src/desktop/knowledge/index.ts',
]);

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

  it('has no tableau-prefixed tool spellings in src/desktop string literals', () => {
    const offenders: string[] = [];
    for (const entry of readdirSync(DESKTOP_ROOT, { recursive: true }).map(String)) {
      if (!entry.endsWith('.ts') || TEST_SUPPORT_RE.test(entry)) continue;
      const file = `src/desktop/${entry.replaceAll('\\', '/')}`;
      if (PREFIXED_ALLOWED_FILES.has(file)) continue;
      for (const literal of stringLiterals(readFileSync(join(DESKTOP_ROOT, entry), 'utf-8'))) {
        for (const match of literal.matchAll(PREFIXED_TOKEN_RE)) {
          if (!PREFIXED_ALLOWED_TOKENS.has(match[0])) offenders.push(`${match[0]} in ${file}`);
        }
      }
    }
    expect([...new Set(offenders)]).toEqual([]);
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
