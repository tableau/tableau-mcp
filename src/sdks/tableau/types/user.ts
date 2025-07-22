import { z } from 'zod';

export const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  // Add other fields as needed
});

export type User = z.infer<typeof userSchema>;
