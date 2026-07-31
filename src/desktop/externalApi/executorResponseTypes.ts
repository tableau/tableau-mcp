import { z } from 'zod';

/**
 * Response shapes the {@link ToolExecutor} interface hands back to desktop tools. Named after the
 * Agent API they originated from, but the External Client API executor reuses them verbatim because
 * the wire shapes are identical; they are the transport-neutral executor contract, not Agent-API-only.
 */

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

export const getEventsResponseSchema = z.object({
  events: z.array(
    z.object({ sequence: z.number(), type: z.string(), timestamp: z.string() }).passthrough(),
  ),
  latest_sequence: z.number(),
  count: z.number(),
});
export type GetEventsResponse = z.infer<typeof getEventsResponseSchema>;
