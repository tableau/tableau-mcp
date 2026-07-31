import { z } from 'zod';

export const getCommandStatusResponseSchema = z.object({
  command_id: z.string(),
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  submitted_at: z.string(),
  started_at: z.string().optional(),
  completed_at: z.string().optional(),
  duration_ms: z.number().optional(),
  result: z.record(z.string(), z.unknown()).optional(),
  error: z.object({ code: z.string(), message: z.string(), recoverable: z.boolean() }).optional(),
});
export type GetCommandStatusResponse = z.infer<typeof getCommandStatusResponseSchema>;

// Passthrough: carriers add extension keys (e.g. `tableau-error-code`) beyond the required three.
export type ExecuteCommandResponseError =
  | ({ code: string; message: string; recoverable: boolean } & Record<string, unknown>)
  | undefined;
