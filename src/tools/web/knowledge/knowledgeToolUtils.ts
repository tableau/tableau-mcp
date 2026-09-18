import { z } from 'zod';

import type { SemanticContextNode } from '../../../sdks/tableau/types/knowledge.js';

export const graphIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9._-]{1,128}$/)
  .refine((value) => value !== '.' && value !== '..');

export const resultLimitSchema = z.number().int().min(1).max(100).optional();

export type KnowledgeStatement = {
  contextId: string;
  contextName: string;
  contextType: SemanticContextNode['type'];
  statementId: string;
  text: string;
  scope: 'attached' | 'global';
  viewGated: boolean;
};

export function isGlobalKnowledgeContext(context: SemanticContextNode): boolean {
  return context.type === 'SEMANTIC_CONTEXT' && context.properties.is_global;
}

export function getKnowledgeResultLimit(
  requested: number | undefined,
  configured: number | null,
): number {
  return Math.min(requested ?? 25, configured ?? 100, 100);
}

export function flattenKnowledgeStatements({
  contexts,
  scope,
  limit,
  rankTerm,
}: {
  contexts: SemanticContextNode[];
  scope?: KnowledgeStatement['scope'];
  limit: number;
  rankTerm?: string;
}): {
  statements: KnowledgeStatement[];
  resultInfo: {
    originalStatementCount: number;
    returnedStatementCount: number;
    truncated: boolean;
    completeness: 'unknown';
  };
} {
  const statements = contexts.flatMap((context) =>
    context.properties.statements.map((statement) => ({
      contextId: context.id,
      contextName: context.name,
      contextType: context.type,
      statementId: statement.id,
      text: statement.statement,
      scope: scope ?? (isGlobalKnowledgeContext(context) ? 'global' : 'attached'),
      viewGated: context.type === 'SEMANTIC_CONTEXT_EXTERNAL',
    })),
  );

  const ranked = rankTerm ? rankStatements(statements, rankTerm) : statements;
  return {
    statements: ranked.slice(0, limit),
    resultInfo: {
      originalStatementCount: statements.length,
      returnedStatementCount: Math.min(statements.length, limit),
      truncated: statements.length > limit,
      completeness: 'unknown' as const,
    },
  };
}

function rankStatements(statements: KnowledgeStatement[], query: string): KnowledgeStatement[] {
  const terms = [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))];
  const score = (statement: KnowledgeStatement): number =>
    terms.filter((term) => statement.text.toLowerCase().includes(term)).length;

  return statements
    .map((statement, index) => ({ statement, index, score: score(statement) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ statement }) => statement);
}
