import { Result } from 'ts-results-es';
import { z } from 'zod';

import {
  ExecuteCommandResponse,
  GetCommandStatusResponse,
  GetEventsResponse,
} from '../../sdks/desktop/agentApi/types.js';

type WithAbortSignal = {
  signal: AbortSignal;
};

export type ExecuteCommandArgs<Z extends z.ZodTypeAny | undefined = undefined> = {
  command: string;
  namespace: string;
  args?: Record<string, any>;
  schema?: Z;
} & WithAbortSignal;

export type GetEventsArgs = {
  sinceSequence?: number;
} & WithAbortSignal;

export type ExecuteCommandError =
  | { type: 'command-failed'; error: ExecuteCommandResponse['error'] }
  | { type: 'command-timed-out'; error: string }
  | { type: 'unknown'; error: unknown };

export type ExecuteCommandResult<Z extends z.ZodTypeAny | undefined = undefined> =
  Z extends z.ZodTypeAny
    ? GetCommandStatusResponse & { parsedResult: z.infer<Z> }
    : GetCommandStatusResponse;

export abstract class ToolExecutor {
  abstract start(): Promise<void>;
  abstract stop(): void;
  abstract isAvailable(): boolean;
  abstract executeCommand(
    args: ExecuteCommandArgs<undefined>,
  ): Promise<Result<ExecuteCommandResult<undefined>, ExecuteCommandError>>;
  abstract executeCommand<Z extends z.ZodTypeAny>(
    args: ExecuteCommandArgs<Z>,
  ): Promise<Result<ExecuteCommandResult<Z>, ExecuteCommandError>>;
  abstract getEvents(args: GetEventsArgs): Promise<Result<GetEventsResponse, unknown>>;
}
