import { randomUUID } from 'node:crypto';

import { importPKCS8, JWTHeaderParameters, JWTPayload, SignJWT } from 'jose';

export async function getJwt({
  username,
  config,
  scopes,
  additionalPayload,
}: {
  username: string;
  config:
    | {
        type: 'connected-app';
        clientId: string;
        secretId: string;
        secretValue: string;
      }
    | {
        type: 'uat';
        tenantId: string;
        issuer: string;
        privateKey: string;
        keyId: string;
      };

  scopes: Set<string>;
  additionalPayload?: Record<string, unknown>;
}): Promise<string> {
  const header: JWTHeaderParameters = {
    alg: config.type === 'connected-app' ? 'HS256' : 'RS256',
    typ: 'JWT',
  };

  if (config.type === 'connected-app') {
    header.kid = config.secretId;
  } else if (config.keyId) {
    header.kid = config.keyId;
  }

  const iat = Math.floor(Date.now() / 1000);
  const payload: JWTPayload = {
    sub: username,
    iat: iat - 5,
    exp: iat + 5 * 60,
    nbf: iat - 5,
    scp: [...scopes],
    ...additionalPayload,
  };

  if (config.type === 'connected-app') {
    payload.jti = randomUUID();
    payload.iss = config.clientId;
    payload.aud = 'tableau';

    return await new SignJWT(payload)
      .setProtectedHeader(header)
      .sign(new TextEncoder().encode(config.secretValue));
  } else {
    payload.email = username;
    payload.username = username;
    payload.jti = `${config.issuer}-${payload.iat}`;
    payload.iss = config.issuer;
    payload['https://tableau.com/tenantId'] = config.tenantId;

    const privateKey = await importPKCS8(config.privateKey, 'RS256');
    return await new SignJWT(payload).setProtectedHeader(header).sign(privateKey);
  }
}
