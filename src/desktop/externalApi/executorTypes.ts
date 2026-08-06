import { z } from 'zod';

import type { ExternalApiToolExecutor } from './externalApiToolExecutor.js';

export type { ExternalApiToolExecutor };

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

type WithAbortSignal = {
  signal: AbortSignal;
};

type WithExecutor = {
  executor: ExternalApiToolExecutor;
};

export type WithExecutorAndAbortSignal = WithExecutor & WithAbortSignal;

export type ExecuteCommandArgs<Z extends z.ZodTypeAny | undefined = undefined> = {
  command: string;
  namespace: 'tabui' | 'tabdoc';
  args?: Record<string, any>;
  schema?: Z;
} & WithAbortSignal;

export type ExecuteCommandError =
  | { type: 'command-failed'; error: ExecuteCommandResponseError }
  | { type: 'command-timed-out'; error: string }
  | { type: 'invalid-response'; error: unknown }
  | { type: 'unknown'; error: unknown };

export type ExecuteCommandWarning = { code: string; message: string };

export type WorkbookDocument = {
  xml: string;
  applicationVersion: string | undefined;
  xsdPayloadVersion: string | undefined;
  instanceId?: string;
};

export type ApplyWorkbookDocumentOptions = {
  expectedInstanceId?: string;
  onDispatch?: () => void;
};

export type ExecuteCommandResult<Z extends z.ZodTypeAny | undefined = undefined> =
  Z extends z.ZodTypeAny
    ? GetCommandStatusResponse & { parsedResult: z.infer<Z>; warnings?: ExecuteCommandWarning[] }
    : GetCommandStatusResponse & { warnings?: ExecuteCommandWarning[] };
