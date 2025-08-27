import { z } from 'zod';

export const connectionSchema = z.object({
  id: z.string(),
  type: z.string(),
  datasource: z
    .object({
      id: z.string(),
      name: z.string(),
    })
    .optional(),
});

export type Connection = z.infer<typeof connectionSchema>;
