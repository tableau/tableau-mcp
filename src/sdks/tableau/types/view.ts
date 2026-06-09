import { z } from 'zod';

import { tagsSchema } from './tags.js';

const lineageContentSchema = z.object({
  luid: z.string(),
  name: z.string(),
});

export const viewSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  workbook: z
    .object({
      id: z.string(),
      name: z.string().optional(),
    })
    .optional(),
  owner: z
    .object({
      id: z.string().optional(),
      name: z.string().optional(),
    })
    .optional(),
  project: z
    .object({
      id: z.string().optional(),
      name: z.string().optional(),
    })
    .optional(),
  tags: tagsSchema,
  upstreamDatasources: z.array(lineageContentSchema).optional(),
  totalViewCount: z.number().optional(),
  usage: z
    .object({
      totalViewCount: z.coerce.number(),
    })
    .optional(),
});

export type View = z.infer<typeof viewSchema>;
