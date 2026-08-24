import { z } from 'zod';

export const knowledgeGraphIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9._-]{1,128}$/)
  .refine((value) => value !== '.' && value !== '..')
  .optional()
  .describe("Knowledge graph ID. Omit to target the site's active (default) graph.");

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

export function validateCreateAttachment(args: {
  targetNodeId?: string;
  isGlobal?: boolean;
}): void {
  if ((args.targetNodeId !== undefined) === (args.isGlobal === true)) {
    throw new Error('Provide exactly one targetNodeId or isGlobal: true.');
  }
}

export function validateUpdate(args: {
  statements?: unknown;
  targetNodeId?: string | null;
  isGlobal?: boolean;
  name?: string;
}): void {
  const hasTarget = Object.prototype.hasOwnProperty.call(args, 'targetNodeId');
  const hasGlobal = Object.prototype.hasOwnProperty.call(args, 'isGlobal');
  if (args.statements === undefined && !hasTarget && !hasGlobal && args.name === undefined) {
    throw new Error('Provide at least one field to update.');
  }
  if (
    hasGlobal !== hasTarget ||
    (hasGlobal && (args.isGlobal === true) !== (args.targetNodeId === null))
  ) {
    throw new Error(
      'Changing global state requires isGlobal: true with targetNodeId: null, or isGlobal: false with a non-null targetNodeId.',
    );
  }
}
