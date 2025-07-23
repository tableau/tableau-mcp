import { randomUUID } from 'node:crypto';

// TODO: Rewrite this using jose
import jwt, { JwtHeader, JwtPayload } from 'jsonwebtoken';

export function getJwt({
  username,
  connectedApp,
  scopes,
  additionalPayload,
}: {
  username: string;
  connectedApp: {
    clientId: string;
    secretId: string;
    secretValue: string;
  };
  scopes: string[];
  additionalPayload?: Record<string, unknown>;
}): string {
  const header: JwtHeader = {
    alg: 'HS256',
    typ: 'JWT',
    kid: connectedApp.secretId,
  };

  const payload: JwtPayload = {
    jti: randomUUID(),
    iss: connectedApp.clientId,
    aud: 'tableau',
    sub: username,
    scp: scopes,
    iat: Math.floor(Date.now() / 1000) - 5,
    exp: Math.floor(Date.now() / 1000) + 5 * 60,
    ...additionalPayload,
  };

  const token = jwt.sign(payload, connectedApp.secretValue, {
    algorithm: 'HS256',
    header,
  });

  return token;
}
