import { randomUUID } from 'node:crypto';

import { JWTHeaderParameters, JWTPayload, SignJWT } from 'jose';

export async function getJwt({
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
  scopes: Set<string>;
  additionalPayload?: Record<string, unknown>;
}): Promise<string> {
  const header: JWTHeaderParameters = {
    alg: 'HS256',
    typ: 'JWT',
    kid: connectedApp.secretId,
  };

  const payload: JWTPayload = {
    jti: randomUUID(),
    iss: connectedApp.clientId,
    aud: 'tableau',
    sub: username,
    scp: [...scopes],
    iat: Math.floor(Date.now() / 1000) - 5,
    exp: Math.floor(Date.now() / 1000) + 5 * 60,
    ...additionalPayload,
  };

  const token = await new SignJWT(payload)
    .setProtectedHeader(header)
    .sign(new TextEncoder().encode(connectedApp.secretValue));

  return token;
}
