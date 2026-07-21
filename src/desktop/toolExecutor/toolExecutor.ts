import { Result } from 'ts-results-es';
import { z } from 'zod';

import {
  ExecuteCommandResponseError,
  GetCommandStatusResponse,
  GetEventsResponse,
} from '../../sdks/desktop/agentApi/types.js';

type WithAbortSignal = {
  signal: AbortSignal;
};

type WithExecutor = {
  executor: ToolExecutor;
};

export type WithExecutorAndAbortSignal = WithExecutor & WithAbortSignal;

export type ExecuteCommandArgs<Z extends z.ZodTypeAny | undefined = undefined> = {
  command: string;
  namespace: 'tabui' | 'tabdoc';
  args?: Record<string, any>;
  schema?: Z;
} & WithAbortSignal;

export type GetEventsArgs = {
  sinceSequence?: number;
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
};

export type ExecuteCommandResult<Z extends z.ZodTypeAny | undefined = undefined> =
  Z extends z.ZodTypeAny
    ? GetCommandStatusResponse & { parsedResult: z.infer<Z>; warnings?: ExecuteCommandWarning[] }
    : GetCommandStatusResponse & { warnings?: ExecuteCommandWarning[] };

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
  abstract getWorkbookDocument(
    signal: AbortSignal,
  ): Promise<Result<WorkbookDocument, ExecuteCommandError>>;
  abstract applyWorkbookDocument(
    xml: string,
    signal: AbortSignal,
  ): Promise<Result<ExecuteCommandResult<undefined>, ExecuteCommandError>>;
  abstract getEvents(args: GetEventsArgs): Promise<Result<GetEventsResponse, unknown>>;
}
