import { z } from 'zod';

export const restApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    detail: z.string(),
  }),
});

export type RestApiError = z.infer<typeof restApiErrorSchema>;
