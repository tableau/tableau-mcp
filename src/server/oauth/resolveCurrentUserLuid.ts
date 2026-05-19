import { Err, Ok, Result } from 'ts-results-es';

import { McpToolError, ResolveCurrentUserError } from '../../errors/mcpToolError.js';
import { log } from '../../logging/logger.js';
import { RestApi } from '../../sdks/tableau/restApi.js';
import { TableauWebRequestHandlerExtra } from '../../tools/web/toolContext.js';

export type CurrentUserLuidResolverExtra = Pick<
  TableauWebRequestHandlerExtra,
  '_userLuid' | 'tableauAuthInfo' | 'setUserLuid'
>;

export async function resolveCurrentUserLuid({
  restApi,
  extra,
}: {
  restApi: RestApi;
  extra: CurrentUserLuidResolverExtra;
}): Promise<Result<string, McpToolError>> {
  if (extra._userLuid) {
    return Ok(extra._userLuid);
  }

  const tokenClaimUserLuid = extra.tableauAuthInfo?.userId;
  if (tokenClaimUserLuid) {
    extra.setUserLuid?.(tokenClaimUserLuid);
    return Ok(tokenClaimUserLuid);
  }

  log({
    message: 'Resolving current user LUID via /sessions/current because token claim is absent.',
    level: 'info',
    logger: 'auth',
  });

  const sessionResult = await restApi.authenticatedServerMethods.getCurrentServerSession();
  if (sessionResult.isErr()) {
    log({
      message: 'Current user LUID resolution failed.',
      level: 'debug',
      logger: 'auth',
      data: { reason: sessionResult.error.type },
    });
    return Err(
      new ResolveCurrentUserError(sessionResult.error.type === 'unauthorized' ? 401 : 502),
    );
  }

  const sessionUserLuid = sessionResult.value.user.id;
  if (!sessionUserLuid) {
    log({
      message: 'Current user LUID resolution failed.',
      level: 'debug',
      logger: 'auth',
      data: { reason: 'missing-user-id' },
    });
    return Err(new ResolveCurrentUserError(502));
  }

  extra.setUserLuid?.(sessionUserLuid);
  return Ok(sessionUserLuid);
}
