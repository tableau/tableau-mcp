import { Result } from 'ts-results-es';

import { DesktopCommandExecutionError, McpToolError } from '../../errors/mcpToolError.js';
import { ExecuteCommandError } from '../externalApi/executorTypes.js';
import { ExternalApiToolExecutor } from '../externalApi/externalApiToolExecutor.js';
import {
  endpointNotInThisBuild,
  isRouteMissing,
  RouteMissingOptions,
} from '../externalApi/toolUtils.js';
import { resolveSession } from '../session/sessionResolution.js';

// Structural subset of TableauDesktopRequestHandlerExtra (src/tools/desktop/toolContext.ts).
// Kept local so nothing under src/desktop imports from src/tools.
type ExternalApiHarnessExtra = {
  getExecutor: (sessionId: string) => Promise<ExternalApiToolExecutor>;
  signal: AbortSignal;
};

export type ExternalApiCall = <T>(
  endpoint: string,
  call: (
    executor: ExternalApiToolExecutor,
    signal: AbortSignal,
  ) => Promise<Result<T, ExecuteCommandError>>,
  options?: RouteMissingOptions & { routeMissingError?: () => McpToolError },
) => Promise<Result<T, McpToolError>>;

/** @deprecated Use {@link ExternalApiCall}; retained for source compatibility. */
export type ExternalApiRead = ExternalApiCall;

type RunExternalApiToolOptions<T> = {
  session: string | undefined;
  extra: ExternalApiHarnessExtra;
  callback: (
    executor: ExternalApiToolExecutor,
    signal: AbortSignal,
    call: ExternalApiCall,
    resolvedSession: string,
  ) => Promise<Result<T, McpToolError>>;
};

export async function runExternalApiTool<T>({
  session,
  extra,
  callback,
}: RunExternalApiToolOptions<T>): Promise<Result<T, McpToolError>> {
  const sessionResult = resolveSession(session);
  if (sessionResult.isErr()) {
    return sessionResult.error.toErr();
  }
  const resolvedSession = sessionResult.value;

  const executor = await extra.getExecutor(resolvedSession);

  const call: ExternalApiCall = async (endpoint, invokeEndpoint, options) => {
    const result = await invokeEndpoint(executor, extra.signal);
    if (result.isErr()) {
      if (isRouteMissing(result.error, options)) {
        return (options?.routeMissingError?.() ?? endpointNotInThisBuild(endpoint)).toErr();
      }
      return new DesktopCommandExecutionError(result.error).toErr();
    }
    return result;
  };

  return await callback(executor, extra.signal, call, resolvedSession);
}

export async function runExternalApiReadTool<T>(
  options: RunExternalApiToolOptions<T>,
): Promise<Result<T, McpToolError>> {
  return await runExternalApiTool(options);
}
