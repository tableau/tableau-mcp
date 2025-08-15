import { z } from 'zod';

export const viewSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  workbook: z
    .object({
      id: z.string(),
    })
    .optional(),
  owner: z
    .object({
      id: z.string(),
    })
    .optional(),
  project: z
    .object({
      id: z.string(),
    })
    .optional(),
  tags: z.object({ tag: z.array(z.object({ label: z.string() })).optional() }),
  usage: z
    .object({
      totalViewCount: z.coerce.number(),
    })
    .optional(),
});

export type View = z.infer<typeof viewSchema>;
