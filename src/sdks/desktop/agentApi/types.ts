import { z } from 'zod';

export const getCommandStatusResponseSchema = z.object({
  command_id: z.string(),
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  submitted_at: z.string(),
  started_at: z.string().optional(),
  completed_at: z.string().optional(),
  duration_ms: z.number().optional(),
  result: z.object({ text: z.string().optional() }).optional(),
  error: z.object({ code: z.string(), message: z.string(), recoverable: z.boolean() }).optional(),
});
export type GetCommandStatusResponse = z.infer<typeof getCommandStatusResponseSchema>;

export const executeCommandRequestSchema = z.object({
  namespace: z.string(),
  command: z.string(),
  args: z.record(z.string(), z.any()).optional(),
});
export type ExecuteCommandRequest = z.infer<typeof executeCommandRequestSchema>;

export const executeCommandResponseSchema = z.object({
  command_id: z.string(),
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  submitted_at: z.string(),
  status_url: z.string(),
  error: z.object({ code: z.string(), message: z.string(), recoverable: z.boolean() }).optional(),
});
export type ExecuteCommandResponse = z.infer<typeof executeCommandResponseSchema>;

export const agentTokenSchema = z.object({
  created: z.string().datetime(),
  pid: z.number(),
  port: z.number(),
  token: z.string(),
  version: z.string(),
});

export const eventSchema = z
  .object({
    sequence: z.number(),
    type: z.string(),
    timestamp: z.string().datetime(),
  })
  .passthrough();

export const getEventsResponseSchema = z.object({
  events: z.array(eventSchema),
  latest_sequence: z.number(),
  count: z.number(),
});
export type GetEventsResponse = z.infer<typeof getEventsResponseSchema>;
