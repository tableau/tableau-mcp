import { Result } from 'ts-results-es';

import {
  ExecuteCommandResponse,
  GetCommandStatusResponse,
} from '../../sdks/desktop/agentApi/types';

export type ExecuteCommandArgs = {
  command: string;
  namespace: string;
  args?: Record<string, any>;
};

export type GetEventsArgs = {
  sinceSequence?: number;
};

export type ExecuteCommandError =
  | { type: 'command-failed'; error: ExecuteCommandResponse['error'] }
  | { type: 'command-timed-out' }
  | { type: 'unknown'; error: unknown };

export abstract class ToolExecutor {
  abstract start(): Promise<void>;
  abstract stop(): void;
  abstract isAvailable(): boolean;
  abstract executeCommand(
    args: ExecuteCommandArgs,
  ): Promise<Result<GetCommandStatusResponse, ExecuteCommandError>>;
}
