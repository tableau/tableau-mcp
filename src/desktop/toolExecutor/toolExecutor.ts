import { Result } from 'ts-results-es';
import { z } from 'zod';

import {
  ExecuteCommandResponse,
  GetCommandStatusResponse,
} from '../../sdks/desktop/agentApi/types';

export type ExecuteCommandArgs<Z extends z.ZodTypeAny = z.ZodTypeAny> = {
  command: string;
  namespace: string;
  args?: Record<string, any>;
  schema?: Z;
};

export type ExecuteCommandError =
  | { type: 'command-failed'; error: ExecuteCommandResponse['error'] }
  | { type: 'command-timed-out' }
  | { type: 'unknown'; error: unknown };

export abstract class ToolExecutor {
  abstract start(): Promise<void>;
  abstract stop(): void;
  abstract isAvailable(): boolean;
  abstract executeCommand<Z extends z.ZodTypeAny = z.ZodTypeAny>(
    args: ExecuteCommandArgs<Z>,
  ): Promise<Result<GetCommandStatusResponse & { parsedResult?: z.infer<Z> }, ExecuteCommandError>>;
}
