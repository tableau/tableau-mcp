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
        usernameClaim: string;
        privateKey: string;
        keyId: string;
      };

  scopes: Set<string>;
  additionalPayload?: Record<string, unknown>;
}): Promise<string> {
  const header: JWTHeaderParameters =
    config.type === 'connected-app'
      ? {
          alg: 'HS256',
          typ: 'JWT',
          kid: config.secretId,
        }
      : {
          alg: 'RS256',
          typ: 'JWT',
          kid: config.keyId,
        };

  const iat = Math.floor(Date.now() / 1000);
  const payload: JWTPayload = {
    iat: iat - 5,
    exp: iat + 5 * 60,
    nbf: iat - 5,
    scp: [...scopes],
    ...additionalPayload,
  };

  if (config.type === 'connected-app') {
    payload.sub = username;
    payload.jti = randomUUID();
    payload.iss = config.clientId;
    payload.aud = 'tableau';

    return await new SignJWT(payload)
      .setProtectedHeader(header)
      .sign(new TextEncoder().encode(config.secretValue));
  } else {
    payload[config.usernameClaim] = username;
    payload.jti = `${config.issuer}-${payload.iat}`;
    payload.iss = config.issuer;
    payload['https://tableau.com/tenantId'] = config.tenantId;

    const privateKey = await importPKCS8(config.privateKey, 'RS256');
    return await new SignJWT(payload).setProtectedHeader(header).sign(privateKey);
  }
}
