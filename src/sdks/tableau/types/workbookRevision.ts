import { z } from 'zod';

import { looseBooleanFalsy } from './looseBoolean.js';

export const revisionNumberSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

/** Revision authors can be absent after the user has been deleted. */
export const workbookRevisionSchema = z.object({
  revisionNumber: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  createdAt: z.string().optional(),
  isCurrent: looseBooleanFalsy.optional(),
  isDeleted: looseBooleanFalsy.optional(),
  user: z.object({ id: z.string(), name: z.string().optional() }).optional(),
});

export type WorkbookRevision = z.infer<typeof workbookRevisionSchema>;
