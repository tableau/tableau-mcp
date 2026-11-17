import { RequestHandler } from 'express';
import { decodeJwt } from 'jose';
import { z } from 'zod';

import { getConfig } from '../config.js';
import { log } from '../logging/logger.js';
import { RestApi } from '../sdks/tableau/restApi.js';
import { isAxiosError } from '../utils/axios.js';
import { matchAudience } from './oauth/accessTokenValidator.js';
import { AuthenticatedRequest } from './oauth/types.js';
import { X_TABLEAU_AUTH_HEADER } from './passthroughAuthMiddleware.js';

const audienceSchema = z.union([z.string().min(1), z.array(z.string().min(1)).nonempty()]);
const invalidToken = { error: 'invalid_token', error_description: 'Authentication failed' };

export function serverEasAuthMiddleware(): RequestHandler {
  const config = getConfig();

  return async (req: AuthenticatedRequest, res, next): Promise<void> => {
    if (
      req.auth ||
      req.headers[X_TABLEAU_AUTH_HEADER] ||
      req.headers.cookie
        ?.split(';')
        .some((cookie) => cookie.trim().startsWith('workgroup_session_id='))
    ) {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }

    const match = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization ?? '');
    if (!match) {
      res.status(401).header('WWW-Authenticate', 'Bearer realm="MCP"').json(invalidToken);
      return;
    }

    const token = match[1];
    let expiresAt: number | undefined;
    try {
      const claims = decodeJwt(token);
      const aud = audienceSchema.parse(claims.aud);
      if (!matchAudience({ aud, config }).matches) throw new Error('Audience mismatch');
      expiresAt = claims.exp;
    } catch {
      res.status(401).json(invalidToken);
      return;
    }

    const restApi = new RestApi({ maxRequestTimeoutMs: config.maxRequestTimeoutMs });
    let signedIn = false;
    let ended = false;
    let cleanupStarted = false;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = async (): Promise<void> => {
      ended = true;
      clearTimeout(expiryTimer);
      if (!signedIn || cleanupStarted) return;
      cleanupStarted = true;
      try {
        await restApi.signOut();
      } catch {
        log({ message: 'server-eas-signout-failed', level: 'warning', logger: 'auth' });
      }
    };
    res.once('finish', () => void cleanup());
    res.once('close', () => void cleanup());

    let unavailable = false;
    try {
      await restApi.signIn({ type: 'server-eas', siteName: config.siteName, jwt: token });
      signedIn = true;
      if (ended || res.destroyed) {
        await cleanup();
        return;
      }

      const credentials = restApi.sessionCredentials;
      const session = await restApi.authenticatedServerMethods.getCurrentServerSession();
      if (session.isErr()) {
        unavailable = session.error.type === 'unknown';
        throw new Error('Session lookup failed');
      }
      const { user, site } = session.value;
      const siteName = site.contentUrl ?? '';
      if (
        !user.id ||
        !user.name ||
        !site.id ||
        user.id !== credentials.user.id ||
        site.id !== credentials.site.id ||
        siteName !== config.siteName
      )
        throw new Error('Session binding mismatch');
      if (ended || res.destroyed) {
        await cleanup();
        return;
      }

      // Expiry only bounds a session after Server has authenticated the unchanged JWT.
      if (expiresAt !== undefined) {
        const remaining = expiresAt * 1000 - Date.now();
        if (!Number.isFinite(remaining) || remaining <= 0) throw new Error('Expired token');
        expiryTimer = setTimeout(
          () => {
            void cleanup();
            res.end();
          },
          Math.min(remaining, 2_147_483_647),
        );
        expiryTimer.unref();
      }
      req.auth = {
        token: 'server-eas',
        clientId: 'server-eas',
        scopes: [],
        extra: {
          type: 'ServerEas',
          server: config.server,
          siteName,
          siteId: site.id,
          userId: user.id,
          username: user.name,
          accessToken: credentials.token,
        },
      };
      next();
    } catch (error) {
      await cleanup();
      if (res.destroyed || res.headersSent) return;
      unavailable ||= isAxiosError(error) && (!error.response || error.response.status >= 500);
      log({
        message: unavailable
          ? 'server-eas-upstream-unavailable'
          : 'server-eas-authentication-failed',
        level: 'warning',
        logger: 'auth',
      });
      res
        .status(unavailable ? 503 : 401)
        .json(unavailable ? { error: 'temporarily_unavailable' } : invalidToken);
    }
  };
}
