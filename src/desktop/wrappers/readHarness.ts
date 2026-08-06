import { Result } from 'ts-results-es';

import { DesktopCommandExecutionError, McpToolError } from '../../errors/mcpToolError.js';
import { ExecuteCommandError } from '../externalApi/executorTypes.js';
import { ExternalApiToolExecutor } from '../externalApi/externalApiToolExecutor.js';
import { endpointNotInThisBuild, isRouteMissing } from '../externalApi/toolUtils.js';
import { resolveSession } from '../session/sessionResolution.js';

// Structural subset of TableauDesktopRequestHandlerExtra (src/tools/desktop/toolContext.ts).
// Kept local so nothing under src/desktop imports from src/tools.
type ReadHarnessExtra = {
  getExecutor: (sessionId: string) => Promise<ExternalApiToolExecutor>;
  signal: AbortSignal;
};

export type ExternalApiRead = <T>(
  endpoint: string,
  read: (
    executor: ExternalApiToolExecutor,
    signal: AbortSignal,
  ) => Promise<Result<T, ExecuteCommandError>>,
  options?: { routeMissingError?: () => McpToolError },
) => Promise<Result<T, McpToolError>>;

export async function runExternalApiReadTool<T>({
  session,
  extra,
  callback,
}: {
  session: string | undefined;
  extra: ReadHarnessExtra;
  callback: (
    executor: ExternalApiToolExecutor,
    signal: AbortSignal,
    read: ExternalApiRead,
    resolvedSession: string,
  ) => Promise<Result<T, McpToolError>>;
}): Promise<Result<T, McpToolError>> {
  const sessionResult = resolveSession(session);
  if (sessionResult.isErr()) {
    return sessionResult.error.toErr();
  }
  const resolvedSession = sessionResult.value;

  const executor = await extra.getExecutor(resolvedSession);

  const read: ExternalApiRead = async (endpoint, readEndpoint, options) => {
    const result = await readEndpoint(executor, extra.signal);
    if (result.isErr()) {
      if (isRouteMissing(result.error)) {
        return (options?.routeMissingError?.() ?? endpointNotInThisBuild(endpoint)).toErr();
      }
      return new DesktopCommandExecutionError(result.error).toErr();
    }
    return result;
  };

  return await callback(executor, extra.signal, read, resolvedSession);
}
