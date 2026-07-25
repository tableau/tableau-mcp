import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import ts from 'typescript';

const REPO_ROOT = join(__dirname, '../../../..');
const SRC_ROOT = join(REPO_ROOT, 'src');
const ENVELOPE_HELPERS = new Set(['attachNextAction', 'wireStructuredContent', 'withNextAction']);

function sourceFiles(): string[] {
  return readdirSync(SRC_ROOT, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .map((file) => join(SRC_ROOT, file));
}

function extendsMcpToolError(node: ts.ClassDeclaration): boolean {
  return (
    node.heritageClauses?.some(
      (clause) =>
        clause.token === ts.SyntaxKind.ExtendsKeyword &&
        clause.types.some((type) => type.expression.getText() === 'McpToolError'),
    ) ?? false
  );
}

function usesStructuredEnvelope(node: ts.Node): boolean {
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    ENVELOPE_HELPERS.has(node.expression.text)
  ) {
    return true;
  }

  let found = false;
  node.forEachChild((child) => {
    found ||= usesStructuredEnvelope(child);
  });
  return found;
}

describe('McpToolError structured-content invariant', () => {
  it('envelopes every structuredContent assignment with body and nextAction', () => {
    const assignments: string[] = [];
    const violations: string[] = [];

    for (const file of sourceFiles()) {
      const sourceFile = ts.createSourceFile(
        file,
        readFileSync(file, 'utf-8'),
        ts.ScriptTarget.Latest,
        true,
      );

      function visit(node: ts.Node): void {
        if (ts.isClassDeclaration(node) && extendsMcpToolError(node)) {
          const className = node.name?.text ?? '<anonymous>';
          node.forEachChild(function inspectClass(child): void {
            if (
              ts.isBinaryExpression(child) &&
              child.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
              ts.isPropertyAccessExpression(child.left) &&
              child.left.expression.kind === ts.SyntaxKind.ThisKeyword &&
              child.left.name.text === 'structuredContent'
            ) {
              const line = sourceFile.getLineAndCharacterOfPosition(child.getStart()).line + 1;
              const location = `${relative(REPO_ROOT, file)}:${line} (${className})`;
              assignments.push(location);
              if (!usesStructuredEnvelope(child.right)) {
                violations.push(location);
              }
            }
            child.forEachChild(inspectClass);
          });
        }
        ts.forEachChild(node, visit);
      }

      visit(sourceFile);
    }

    expect(assignments.length).toBeGreaterThanOrEqual(3);
    expect(violations).toEqual([]);
  });
});
