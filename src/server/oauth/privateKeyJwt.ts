import { isIP } from 'net';

import { createLocalJWKSet, decodeProtectedHeader, JSONWebKeySet, jwtVerify } from 'jose';
import { isSSRFSafeURL } from 'ssrfcheck';
import { Err, Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { log } from '../../logging/logger.js';
import { axios, getStringResponseHeader, isAxiosError } from '../../utils/axios.js';
import { ExpiringMap } from '../../utils/expiringMap.js';
import { milliseconds } from '../../utils/milliseconds.js';
import { parseUrl } from '../../utils/parseUrl.js';
import { retry } from '../../utils/retry.js';
import { getClientFromMetadataDoc } from './authorize.js';
import { getDnsResolver } from './dnsResolver.js';

const CLIENT_ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';
const MAX_ASSERTION_LIFETIME_SECONDS = 5 * 60;
const MAX_JWKS_BYTES = 64 * 1024;

const ALLOWED_ALGORITHMS = [
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512',
  'ES256',
  'ES384',
  'ES512',
  'EdDSA',
];

const usedJtis = new ExpiringMap<string, true>({
  defaultExpirationTimeMs: milliseconds.fromMinutes(5),
  maxSize: 50_000,
});

const jwksSchema = z.object({
  keys: z.array(z.record(z.unknown())).min(1),
});

export async function verifyPrivateKeyJwtClient({
  clientId,
  clientAssertion,
  clientAssertionType,
}: {
  clientId: string | undefined;
  clientAssertion: string | undefined;
  clientAssertionType: string | undefined;
}): Promise<Result<{ clientId: string }, string>> {
  if (!clientId) return Err('client_id is required for private_key_jwt');
  if (!clientAssertion) return Err('client_assertion is required for private_key_jwt');
  if (clientAssertionType !== CLIENT_ASSERTION_TYPE) {
    return Err(`client_assertion_type must be ${CLIENT_ASSERTION_TYPE}`);
  }

  const clientMetadataUrl = parseUrl(clientId);
  if (!clientMetadataUrl || clientMetadataUrl.protocol !== 'https:') {
    return Err('private_key_jwt requires an HTTPS CIMD client_id URL');
  }

  const metadataResult = await getClientFromMetadataDoc(new URL(clientMetadataUrl.toString()));
  if (metadataResult.isErr()) {
    return Err(metadataResult.error.error_description);
  }

  const metadata = metadataResult.value;
  const supportsPrivateKeyJwt =
    metadata.token_endpoint_auth_method === 'private_key_jwt' ||
    metadata.token_endpoint_auth_methods_supported?.includes('private_key_jwt');

  if (!supportsPrivateKeyJwt) {
    return Err('Client metadata does not allow private_key_jwt');
  }

  let jwks: JSONWebKeySet;
  if (metadata.jwks) {
    jwks = jwksSchema.parse(metadata.jwks) as unknown as JSONWebKeySet;
  } else if (metadata.jwks_uri) {
    const jwksResult = await getRemoteJwks(clientMetadataUrl, metadata.jwks_uri);
    if (jwksResult.isErr()) return Err(jwksResult.error);
    jwks = jwksResult.value;
  } else {
    return Err('Client metadata must contain jwks or jwks_uri for private_key_jwt');
  }

  let protectedHeader;
  try {
    protectedHeader = decodeProtectedHeader(clientAssertion);
  } catch {
    return Err('Invalid client_assertion JWT');
  }

  if (!protectedHeader.kid || typeof protectedHeader.kid !== 'string') {
    return Err('client_assertion JWT must contain a kid header');
  }
  if (!protectedHeader.alg || !ALLOWED_ALGORITHMS.includes(protectedHeader.alg)) {
    return Err('Unsupported client_assertion signing algorithm');
  }

  const tokenEndpoint = `${getConfig().oauth.issuer}/oauth2/token`;
  let payload;
  try {
    const verified = await jwtVerify(clientAssertion, createLocalJWKSet(jwks), {
      audience: tokenEndpoint,
      algorithms: ALLOWED_ALGORITHMS,
      clockTolerance: 5,
    });
    payload = verified.payload;
  } catch (error) {
    log({
      message: 'private_key_jwt client assertion verification failed',
      level: 'debug',
      logger: 'oauth',
      data: error,
    });
    return Err('Invalid client_assertion');
  }

  if (payload.iss !== clientId || payload.sub !== clientId) {
    return Err('client_assertion iss and sub must equal client_id');
  }
  if (typeof payload.exp !== 'number') return Err('client_assertion must contain exp');

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) return Err('client_assertion has expired');
  if (payload.exp - now > MAX_ASSERTION_LIFETIME_SECONDS) {
    return Err('client_assertion lifetime is too long');
  }
  if (typeof payload.jti !== 'string' || payload.jti.length === 0) {
    return Err('client_assertion must contain jti');
  }

  const replayKey = `${clientId}:${payload.jti}`;
  if (usedJtis.has(replayKey)) return Err('client_assertion has already been used');

  usedJtis.set(
    replayKey,
    true,
    Math.min(Math.max(1_000, (payload.exp - now) * 1_000), milliseconds.fromMinutes(5)),
  );

  return Ok({ clientId });
}

async function getRemoteJwks(
  clientMetadataUrl: URL,
  jwksUri: string,
): Promise<Result<JSONWebKeySet, string>> {
  const url = parseUrl(jwksUri);
  if (!url || url.protocol !== 'https:') return Err('jwks_uri must be an HTTPS URL');

  if (url.origin !== clientMetadataUrl.origin) {
    return Err('jwks_uri must use the same origin as client_id');
  }

  const originalHostname = url.hostname;
  if (!isIP(url.hostname)) {
    try {
      const dnsResolver = getDnsResolver();
      const ipv4 = await dnsResolver.resolve4(url.hostname);
      let ipAddress = ipv4.find(Boolean);
      if (!ipAddress) {
        const ipv6 = await dnsResolver.resolve6(url.hostname);
        ipAddress = ipv6.find(Boolean);
      }
      if (!ipAddress) return Err('IP address of jwks_uri could not be resolved');
      url.hostname = ipAddress;
    } catch (error) {
      log({
        message: `DNS resolution failed for JWKS URL ${originalHostname}`,
        level: 'error',
        logger: 'oauth',
        data: error,
      });
      return Err('IP address of jwks_uri could not be resolved');
    }
  }

  if (
    !isSSRFSafeURL(url.toString(), {
      allowedProtocols: ['https'],
      autoPrependProtocol: false,
    })
  ) {
    return Err('jwks_uri is not allowed');
  }

  try {
    const response = await retry(
      () =>
        axios.get(url.toString(), {
          timeout: 5000,
          maxContentLength: MAX_JWKS_BYTES,
          maxRedirects: 0,
          headers: {
            Accept: 'application/json',
            Host: originalHostname,
          },
        }),
      {
        retryIf: (error) => {
          if (!isAxiosError(error)) return true;
          const status = error.response?.status;
          return !status || (status >= 500 && status < 600);
        },
      },
    );

    const contentType = getStringResponseHeader(response.headers, 'content-type');
    if (!contentType?.split(';').map((s) => s.trim()).includes('application/json')) {
      return Err('jwks_uri must return application/json');
    }

    const parsed = jwksSchema.safeParse(response.data);
    if (!parsed.success) return Err('jwks_uri returned an invalid JWKS');

    return Ok(parsed.data as unknown as JSONWebKeySet);
  } catch (error) {
    log({
      message: 'Failed to fetch CIMD JWKS',
      level: 'error',
      logger: 'oauth',
      data: error,
    });
    return Err('Unable to fetch client JWKS');
  }
}
