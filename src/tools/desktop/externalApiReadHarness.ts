import { Result } from 'ts-results-es';

import { ExternalApiToolExecutor } from '../../desktop/externalApi/externalApiToolExecutor.js';
import { endpointNotInThisBuild, isRouteMissing } from '../../desktop/externalApi/toolUtils.js';
import { resolveSession } from '../../desktop/sessionResolution.js';
import { ExecuteCommandError } from '../../desktop/toolExecutor/toolExecutor.js';
import { DesktopCommandExecutionError, McpToolError } from '../../errors/mcpToolError.js';
import { TableauDesktopRequestHandlerExtra } from './toolContext.js';

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
  toolName: string;
  session: string | undefined;
  extra: TableauDesktopRequestHandlerExtra;
  callback: (
    executor: ExternalApiToolExecutor,
    signal: AbortSignal,
    read: ExternalApiRead,
  ) => Promise<Result<T, McpToolError>>;
}): Promise<Result<T, McpToolError>> {
  const sessionResult = resolveSession(session);
  if (sessionResult.isErr()) {
    return sessionResult.error.toErr();
  }

  const executor = await extra.getExecutor(sessionResult.value);

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

  return await callback(executor, extra.signal, read);
}
