import jwt, { JwtHeader, JwtPayload } from 'jsonwebtoken';

export function getJwt({
  username,
  connectedApp,
  scopes,
}: {
  username: string;
  connectedApp: {
    clientId: string;
    secretId: string;
    secretValue: string;
  };
  scopes: string[];
}): string {
  const header: JwtHeader = {
    alg: 'HS256',
    typ: 'JWT',
    kid: connectedApp.secretId,
  };

  const payload: JwtPayload = {
    jti: crypto.randomUUID(),
    iss: connectedApp.clientId,
    aud: 'tableau',
    sub: username,
    scp: scopes,
    iat: Math.floor(Date.now() / 1000) - 5,
    exp: Math.floor(Date.now() / 1000) + 5 * 60,
  };

  const token = jwt.sign(payload, connectedApp.secretValue, {
    algorithm: 'HS256',
    header,
  });

  return token;
}
