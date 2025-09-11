import { z } from 'zod';

export const serverInfoSchema = z.object({
  productVersion: z.object({
    value: z.string(),
    build: z.string(),
  }),
  restApiVersion: z.string(),
});

export type ServerInfo = z.infer<typeof serverInfoSchema>;
