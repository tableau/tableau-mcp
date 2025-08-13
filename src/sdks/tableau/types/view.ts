import { z } from 'zod';

export const viewSchema = z.object({
  id: z.string(),
  name: z.string(),
  tags: z.object({ tag: z.array(z.object({ label: z.string() })).optional() }),
  usage: z
    .object({
      totalViewCount: z.coerce.number(),
    })
    .optional(),
});

export type View = z.infer<typeof viewSchema>;
