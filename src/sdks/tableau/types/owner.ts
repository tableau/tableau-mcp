import { z } from 'zod';

export const ownerSchema = z.object({
  id: z.string(),
});

export type Owner = z.infer<typeof ownerSchema>;
