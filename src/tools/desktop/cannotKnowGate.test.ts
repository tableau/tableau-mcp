/*
 * Known limitations: this hunter does not correlate an observed identifier to the claim it
 * supports (an unrelated `result` identifier can satisfy a receipt), and it does not inspect
 * Boolean()/!! coercions whose assigned name falls outside FLAG_NAME. Both are follow-ups.
 */
import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import ts from 'typescript';

const REPO_ROOT = join(__dirname, '../../..');
const DESKTOP_ROOT = join(REPO_ROOT, 'src/tools/desktop');
const FLAG_NAME = /(complete|success|applied|verified|loaded)/i;

type Rule = 'BOOLEAN_FLAG' | 'RECEIPT_OBSERVATION' | 'TERMINAL_RECEIPT';
type Violation = {
  file: string;
  line: number;
  rule: Rule;
  message: string;
};

const RECEIPT_ALLOWLIST: Readonly<Record<string, string>> = {
  // WHY safe: this receipt describes a local retry-policy decision, not an external effect;
  // `reason` is the observed branch input and `unverified` disclaims permanence.
  [receiptExemptionKey(
    'src/tools/desktop/data-source/getSummaryData.ts',
    'nextActionForSummaryError',
    ['stopped get-summary-data on a terminal " " failure'],
  )]: 'Local terminal-policy receipt with no external mutation claim.',
  // WHY safe: callers pass this record only after rememberedSheetStillPresent re-read the live
  // workbook; the receipt limits its claim to name presence and disclaims field/content checks.
  [receiptExemptionKey('src/tools/desktop/binder/bindTemplate.ts', 'reusedSheetResult', [
    'matched this ask to the sheet " " this session already applied (template  )',
    'authored calcs:  ',
  ])]: 'Live name presence is checked immediately before this result is constructed.',
};

const BOOLEAN_FLAG_ALLOWLIST: Readonly<Record<string, string>> = {
  // WHY safe: `true` requires both an actual encoding report and zero reported gaps. Undefined
  // can only produce false, and the receipt separately reports that analysis as unverified.
  [booleanExemptionKey(
    'src/tools/desktop/binder/bindTemplate.ts',
    `encodingAnalysisComplete =
    res.encodings !== undefined && res.encodings.unfilled.length === 0`,
  )]: 'Undefined cannot produce a completed claim; it is explicitly disclosed as unverified.',
  // WHY safe: this flag means a known non-empty unfilled report exists. Undefined can only
  // contribute false and does not by itself assert that the overall bind is complete.
  [booleanExemptionKey(
    'src/tools/desktop/binder/bindTemplate.ts',
    `incomplete =
    waterfallReBindSlotUnfilled(res, schemaSummary) ||
    unfilledEncodings !== undefined ||
    spliced.warnings.length > 0 ||
    promiseOutcome === 'failed'`,
  )]: 'Presence is affirmative evidence of an incomplete bind, never evidence of completion.',
  // WHY safe: this is checked only after getWorkbookXml succeeds; true additionally requires
  // the read-back worksheet to contain the requested mark-label setting.
  [booleanExemptionKey(
    'src/tools/desktop/data-source/formatLabels.ts',
    `applied =
            worksheetXml !== undefined && hasMarkLabelsSetting(worksheetXml, showLabels)`,
  )]: 'The optional worksheet is host readback, and true requires its requested setting.',
};

const CLAIM_EVIDENCE = [
  {
    claim: /\b(quer(?:y|ied)|return(?:ed)?|read|found)\b/i,
    evidence: /\b(summaryResult|dataColumns|dataRows|readback|fetched\w*|response\w*|result\w*)\b/i,
  },
  {
    claim:
      /\b(appl(?:y|ied)|accept(?:ed)?|author(?:ed)?|bound|creat(?:e|ed)|updat(?:e|ed)|wrote|loaded|phase)\b/i,
    evidence:
      /\b(applyResult|readback\w*|verification|receiptInput|fetched\w*|response\w*|result\w*)\b/i,
  },
  {
    claim: /\b(match(?:ed)?|reuse(?:d)?|remember(?:ed)?)\b/i,
    evidence: /\b(readback\w*|fetched\w*|remembered\w*|result\w*|workbookXml)\b/i,
  },
  {
    claim: /\b(stop(?:ped)?|terminal)\b/i,
    evidence: /\b(reason|status|result\w*)\b/i,
  },
] as const;

function sourceFiles(): string[] {
  return readdirSync(DESKTOP_ROOT, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .map((file) => join(DESKTOP_ROOT, file));
}

function normalizedRelative(file: string): string {
  return relative(REPO_ROOT, file).replaceAll('\\', '/');
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function callName(node: ts.CallExpression): string | undefined {
  if (ts.isIdentifier(node.expression)) {
    return node.expression.text;
  }
  if (ts.isPropertyAccessExpression(node.expression)) {
    return node.expression.name.text;
  }
  return undefined;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  if (
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isParenthesizedExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    return unwrapExpression(expression.expression);
  }
  return expression;
}

function isDirectCall(node: ts.Expression | undefined, name: string): boolean {
  if (!node) {
    return false;
  }
  const expression = unwrapExpression(node);
  return ts.isCallExpression(expression) && callName(expression) === name;
}

function stringValue(expression: ts.Expression): string | undefined {
  const value = unwrapExpression(expression);
  return ts.isStringLiteralLike(value) ? value.text : undefined;
}

function propertyName(node: ts.PropertyName): string | undefined {
  return ts.isIdentifier(node) || ts.isStringLiteralLike(node) ? node.text : undefined;
}

function enclosingFunction(node: ts.Node): ts.FunctionLikeDeclaration | undefined {
  let current = node.parent;
  while (current) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isGetAccessorDeclaration(current) ||
      ts.isSetAccessorDeclaration(current) ||
      ts.isConstructorDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current)
    ) {
      return current;
    }
    current = current.parent;
  }
  return undefined;
}

function functionName(node: ts.FunctionLikeDeclaration, sourceFile: ts.SourceFile): string {
  if (node.name) {
    return node.name.getText(sourceFile);
  }
  if (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
    return node.parent.name.text;
  }
  if (ts.isPropertyAssignment(node.parent)) {
    return propertyName(node.parent.name) ?? `<anonymous@${lineOf(sourceFile, node)}>`;
  }
  return `<anonymous@${lineOf(sourceFile, node)}>`;
}

function receiptExemptionKey(file: string, fn: string, claims: readonly string[]): string {
  return JSON.stringify([file, fn, claims]);
}

function receiptAllowlistKey(
  file: string,
  fn: ts.FunctionLikeDeclaration,
  sourceFile: ts.SourceFile,
  claims: readonly string[],
): string {
  return receiptExemptionKey(normalizedRelative(file), functionName(fn, sourceFile), claims);
}

function booleanExemptionKey(file: string, assignmentSource: string): string {
  return JSON.stringify([file, assignmentSource]);
}

function useAllowlist(
  allowlist: Readonly<Record<string, string>>,
  key: string,
  usedAllowlist: Set<string>,
): boolean {
  if (!allowlist[key] || usedAllowlist.has(key)) {
    return false;
  }
  usedAllowlist.add(key);
  return true;
}

function stringClaims(node: ts.Node): string[] {
  const claims: string[] = [];
  function visit(child: ts.Node): void {
    if (ts.isStringLiteralLike(child) || ts.isNoSubstitutionTemplateLiteral(child)) {
      claims.push(child.text);
      return;
    }
    if (ts.isTemplateExpression(child)) {
      claims.push(
        [child.head.text, ...child.templateSpans.map((span) => span.literal.text)].join(' '),
      );
      return;
    }
    child.forEachChild(visit);
  }
  visit(node);
  return claims;
}

function identifierNames(node: ts.Node): string {
  const names: string[] = [];
  function visit(child: ts.Node): void {
    if (ts.isIdentifier(child)) {
      names.push(child.text);
    }
    child.forEachChild(visit);
  }
  visit(node);
  return names.join(' ');
}

function auditReceipt(
  call: ts.CallExpression,
  file: string,
  sourceFile: ts.SourceFile,
  usedAllowlist: Set<string>,
): Violation[] {
  const fn = enclosingFunction(call);
  if (!fn) {
    return [
      {
        file: normalizedRelative(file),
        line: lineOf(sourceFile, call),
        rule: 'RECEIPT_OBSERVATION',
        message: 'receipt() must be produced inside a function with observable evidence',
      },
    ];
  }

  const facts = call.arguments[0] && unwrapExpression(call.arguments[0]);
  const did =
    facts && ts.isObjectLiteralExpression(facts)
      ? facts.properties.find(
          (property): property is ts.PropertyAssignment =>
            ts.isPropertyAssignment(property) && propertyName(property.name) === 'did',
        )
      : undefined;
  if (!did || !ts.isArrayLiteralExpression(unwrapExpression(did.initializer))) {
    return [
      {
        file: normalizedRelative(file),
        line: lineOf(sourceFile, call),
        rule: 'RECEIPT_OBSERVATION',
        message: 'receipt.did must be an inline array so its claims can be audited',
      },
    ];
  }

  const functionIdentifiers = identifierNames(fn);
  const claims = stringClaims(did.initializer);
  if (claims.length === 0) {
    return [
      {
        file: normalizedRelative(file),
        line: lineOf(sourceFile, did),
        rule: 'RECEIPT_OBSERVATION',
        message: 'receipt.did has no statically reviewable claim text',
      },
    ];
  }

  const allowlistKey = receiptAllowlistKey(file, fn, sourceFile, claims);
  if (useAllowlist(RECEIPT_ALLOWLIST, allowlistKey, usedAllowlist)) {
    return [];
  }

  return claims.flatMap((claim) => {
    const category = CLAIM_EVIDENCE.find(({ claim: claimWords }) => claimWords.test(claim));
    if (!category) {
      return [
        {
          file: normalizedRelative(file),
          line: lineOf(sourceFile, did),
          rule: 'RECEIPT_OBSERVATION' as const,
          message: `did claim has no reviewed claim-word category: ${JSON.stringify(claim)}`,
        },
      ];
    }
    if (category.evidence.test(functionIdentifiers)) {
      return [];
    }
    return [
      {
        file: normalizedRelative(file),
        line: lineOf(sourceFile, did),
        rule: 'RECEIPT_OBSERVATION' as const,
        message: `did claim lacks a correlated observation in ${functionName(fn, sourceFile)}: ${JSON.stringify(claim)}`,
      },
    ];
  });
}

function containsUndefinedComparison(node: ts.Node): boolean {
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken &&
    ((ts.isIdentifier(node.left) && node.left.text === 'undefined') ||
      (ts.isIdentifier(node.right) && node.right.text === 'undefined'))
  ) {
    return true;
  }
  let found = false;
  node.forEachChild((child) => {
    found ||= containsUndefinedComparison(child);
  });
  return found;
}

function booleanFlagAssignment(
  node: ts.Node,
): { name: string; initializer: ts.Expression } | undefined {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
    return { name: node.name.text, initializer: node.initializer };
  }
  if (ts.isPropertyAssignment(node)) {
    const name = propertyName(node.name);
    return name ? { name, initializer: node.initializer } : undefined;
  }
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    (ts.isIdentifier(node.left) || ts.isPropertyAccessExpression(node.left))
  ) {
    return {
      name: ts.isIdentifier(node.left) ? node.left.text : node.left.name.text,
      initializer: node.right,
    };
  }
  return undefined;
}

function isBooleanExpression(expression: ts.Expression): boolean {
  const value = unwrapExpression(expression);
  if (value.kind === ts.SyntaxKind.TrueKeyword || value.kind === ts.SyntaxKind.FalseKeyword) {
    return true;
  }
  if (ts.isPrefixUnaryExpression(value)) {
    return value.operator === ts.SyntaxKind.ExclamationToken;
  }
  if (!ts.isBinaryExpression(value)) {
    return false;
  }
  return [
    ts.SyntaxKind.AmpersandAmpersandToken,
    ts.SyntaxKind.BarBarToken,
    ts.SyntaxKind.EqualsEqualsEqualsToken,
    ts.SyntaxKind.ExclamationEqualsEqualsToken,
    ts.SyntaxKind.EqualsEqualsToken,
    ts.SyntaxKind.ExclamationEqualsToken,
    ts.SyntaxKind.GreaterThanToken,
    ts.SyntaxKind.GreaterThanEqualsToken,
    ts.SyntaxKind.LessThanToken,
    ts.SyntaxKind.LessThanEqualsToken,
    ts.SyntaxKind.InKeyword,
    ts.SyntaxKind.InstanceOfKeyword,
  ].includes(value.operatorToken.kind);
}

function auditBooleanFlag(
  node: ts.Node,
  file: string,
  sourceFile: ts.SourceFile,
  usedAllowlist: Set<string>,
): Violation[] {
  const assignment = booleanFlagAssignment(node);
  if (
    !assignment ||
    !FLAG_NAME.test(assignment.name) ||
    !isBooleanExpression(assignment.initializer) ||
    !containsUndefinedComparison(assignment.initializer)
  ) {
    return [];
  }

  const key = booleanExemptionKey(normalizedRelative(file), node.getText(sourceFile));
  if (useAllowlist(BOOLEAN_FLAG_ALLOWLIST, key, usedAllowlist)) {
    return [];
  }
  return [
    {
      file: normalizedRelative(file),
      line: lineOf(sourceFile, node),
      rule: 'BOOLEAN_FLAG',
      message: `"${assignment.name}" derives a truth claim from optional-data presence (!== undefined)`,
    },
  ];
}

function enclosingCall(node: ts.Node, name: string): ts.CallExpression | undefined {
  let current = node.parent;
  while (current && !ts.isFunctionLike(current)) {
    if (ts.isCallExpression(current) && callName(current) === name) {
      return current;
    }
    current = current.parent;
  }
  return undefined;
}

function isBrandedDoneFactory(node: ts.PropertyAssignment, sourceFile: ts.SourceFile): boolean {
  const fn = enclosingFunction(node);
  if (!fn || functionName(fn, sourceFile) !== 'doneNextAction') {
    return false;
  }
  const receiptParameter = fn.parameters.find(
    (parameter) =>
      ts.isIdentifier(parameter.name) &&
      parameter.name.text === 'toolReceipt' &&
      parameter.type?.getText(sourceFile) === 'Receipt',
  );
  const object = node.parent;
  const receiptProperty =
    ts.isObjectLiteralExpression(object) &&
    object.properties.find(
      (property): property is ts.PropertyAssignment =>
        ts.isPropertyAssignment(property) && propertyName(property.name) === 'receipt',
    );
  return Boolean(
    receiptParameter &&
    receiptProperty &&
    ts.isIdentifier(receiptProperty.initializer) &&
    receiptProperty.initializer.text === 'toolReceipt',
  );
}

function auditTerminal(node: ts.Node, file: string, sourceFile: ts.SourceFile): Violation[] {
  if (ts.isCallExpression(node) && callName(node) === 'doneNextAction') {
    const toolReceipt = node.arguments[0] && unwrapExpression(node.arguments[0]);
    if (toolReceipt && ts.isCallExpression(toolReceipt) && callName(toolReceipt) === 'receipt') {
      return [];
    }
    return [
      {
        file: normalizedRelative(file),
        line: lineOf(sourceFile, node),
        rule: 'TERMINAL_RECEIPT',
        message: 'doneNextAction must receive a receipt() result directly',
      },
    ];
  }
  if (!ts.isPropertyAssignment(node)) {
    return [];
  }
  const name = propertyName(node.name);
  const value = stringValue(node.initializer);
  if (name === 'kind' && value === 'done') {
    if (isBrandedDoneFactory(node, sourceFile)) {
      return [];
    }
    return [
      {
        file: normalizedRelative(file),
        line: lineOf(sourceFile, node),
        rule: 'TERMINAL_RECEIPT',
        message: "kind:'done' may only be minted by doneNextAction(Receipt)",
      },
    ];
  }
  if (name !== 'status' || value !== 'terminal') {
    return [];
  }

  const envelope = enclosingCall(node, 'withNextAction');
  if (envelope && isDirectCall(envelope.arguments[1], 'doneNextAction')) {
    return [];
  }
  return [
    {
      file: normalizedRelative(file),
      line: lineOf(sourceFile, node),
      rule: 'TERMINAL_RECEIPT',
      message:
        "status:'terminal' must use doneNextAction(Receipt) as its unconditional next action",
    },
  ];
}

function auditSource(
  file: string,
  text = readFileSync(file, 'utf-8'),
): {
  violations: Violation[];
  receiptAllowlist: Set<string>;
  booleanAllowlist: Set<string>;
} {
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const violations: Violation[] = [];
  const receiptAllowlist = new Set<string>();
  const booleanAllowlist = new Set<string>();

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && callName(node) === 'receipt') {
      violations.push(...auditReceipt(node, file, sourceFile, receiptAllowlist));
    }
    violations.push(...auditTerminal(node, file, sourceFile));
    violations.push(...auditBooleanFlag(node, file, sourceFile, booleanAllowlist));
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return { violations, receiptAllowlist, booleanAllowlist };
}

function formatViolations(violations: readonly Violation[]): string {
  return violations
    .map(({ file, line, rule, message }) => `${file}:${line} [${rule}] ${message}`)
    .join('\n');
}

const treeAudit = sourceFiles()
  .map((file) => auditSource(file))
  .reduce(
    (all, audit) => {
      all.violations.push(...audit.violations);
      audit.receiptAllowlist.forEach((key) => all.receiptAllowlist.add(key));
      audit.booleanAllowlist.forEach((key) => all.booleanAllowlist.add(key));
      return all;
    },
    {
      violations: [] as Violation[],
      receiptAllowlist: new Set<string>(),
      booleanAllowlist: new Set<string>(),
    },
  );

describe('cannot-know hunter gate', () => {
  it('requires observable evidence for every receipt.did claim', () => {
    const violations = treeAudit.violations.filter(({ rule }) => rule === 'RECEIPT_OBSERVATION');
    expect(violations, `Cannot-know gate failed:\n${formatViolations(violations)}`).toEqual([]);
    expect([...treeAudit.receiptAllowlist].sort()).toEqual(Object.keys(RECEIPT_ALLOWLIST).sort());
  });

  it('requires terminal results to flow through the branded Receipt factory', () => {
    const violations = treeAudit.violations.filter(({ rule }) => rule === 'TERMINAL_RECEIPT');
    expect(violations, `Cannot-know gate failed:\n${formatViolations(violations)}`).toEqual([]);
  });

  it('rejects truth flags derived from optional-data presence', () => {
    const violations = treeAudit.violations.filter(({ rule }) => rule === 'BOOLEAN_FLAG');
    expect(violations, `Cannot-know gate failed:\n${formatViolations(violations)}`).toEqual([]);
    expect([...treeAudit.booleanAllowlist].sort()).toEqual(
      Object.keys(BOOLEAN_FLAG_ALLOWLIST).sort(),
    );
  });

  it('recognizes synthetic violations for all three rules', () => {
    const synthetic = auditSource(
      join(DESKTOP_ROOT, 'syntheticViolation.ts'),
      `
        function fakeApply(optionalResult?: object) {
          const appliedComplete = optionalResult !== undefined;
          return withNextAction(
            { status: 'terminal' as const, appliedComplete },
            prefillNextAction('Keep going'),
          );
        }
        function fakeReceipt() {
          return receipt({
            did: ['applied the workbook'],
            unverified: [],
          });
        }
      `,
    );
    expect(synthetic.violations.map(({ rule }) => rule).sort()).toEqual([
      'BOOLEAN_FLAG',
      'RECEIPT_OBSERVATION',
      'TERMINAL_RECEIPT',
    ]);
  });

  it('does not exempt a new receipt in an allowlisted function', () => {
    const file = join(DESKTOP_ROOT, 'data-source/getSummaryData.ts');
    const source = readFileSync(file, 'utf-8');
    const mutated = source.replace(
      `function nextActionForSummaryError(
  status: SummaryDataErrorStatus,
  reason: SummaryDataErrorReason,
): NextAction {
`,
      `function nextActionForSummaryError(
  status: SummaryDataErrorStatus,
  reason: SummaryDataErrorReason,
): NextAction {
  receipt({ did: ['applied an unobserved workbook change'], unverified: [] });
`,
    );
    expect(mutated).not.toBe(source);

    const violations = auditSource(file, mutated).violations.filter(
      ({ rule }) => rule === 'RECEIPT_OBSERVATION',
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('applied an unobserved workbook change');
  });

  it('does not exempt a new same-named flag in an allowlisted file', () => {
    const file = join(DESKTOP_ROOT, 'data-source/formatLabels.ts');
    const source = `${readFileSync(file, 'utf-8')}
      function syntheticFlag(optionalResult?: object) {
        const applied = optionalResult !== undefined;
        return applied;
      }
    `;

    const violations = auditSource(file, source).violations.filter(
      ({ rule }) => rule === 'BOOLEAN_FLAG',
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('"applied"');
  });

  it('rejects a conditional alternative to doneNextAction for terminal status', () => {
    const synthetic = auditSource(
      join(DESKTOP_ROOT, 'syntheticConditionalTerminal.ts'),
      `
        function conditionalTerminal(condition: boolean) {
          return withNextAction(
            { status: 'terminal' as const },
            condition
              ? prefillNextAction('Keep going')
              : doneNextAction(receipt({
                  did: ['stopped because status was terminal'],
                  unverified: [],
                })),
          );
        }
      `,
    );
    const violations = synthetic.violations.filter(({ rule }) => rule === 'TERMINAL_RECEIPT');
    expect(violations).toHaveLength(1);
  });
});
