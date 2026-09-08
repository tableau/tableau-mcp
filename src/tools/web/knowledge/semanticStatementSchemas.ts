import { z } from 'zod';

export const knowledgeGraphIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9._-]{1,128}$/)
  .refine((value) => value !== '.' && value !== '..')
  .optional()
  .describe("Knowledge graph ID. Omit to use the site's active (default) graph.");

export const knowledgePathIdSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !value.includes('/'), 'Knowledge path IDs cannot contain "/".');

export const semanticStatementSchema = z.object({
  statement: z.string().trim().min(5).max(1000),
  id: z.string().trim().min(1).optional(),
});

export const semanticStatementsSchema = z.array(semanticStatementSchema).min(1);

export function redactSemanticStatements<T extends { statements?: unknown }>(args: T): T {
  return args.statements === undefined ? args : { ...args, statements: '[REDACTED]' };
}

export function validateUpdate(args: { statements?: unknown; name?: string }): void {
  if (args.statements === undefined && args.name === undefined) {
    throw new Error('Provide at least one field to update: statements or name.');
  }
}
