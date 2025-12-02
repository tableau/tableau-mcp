import axiosRetry from 'axios-retry';
import { randomBytes, randomUUID } from 'crypto';
import express from 'express';
import { isIP } from 'net';
import { isSSRFSafeURL } from 'ssrfcheck';
import { Err, Ok, Result } from 'ts-results-es';
import { fromError } from 'zod-validation-error';

import { getConfig, ONE_DAY_IN_MS } from '../../config.js';
import { axios, AxiosResponse, getStringResponseHeader } from '../../utils/axios.js';
import { parseUrl } from '../../utils/parseUrl.js';
import { setLongTimeout } from '../../utils/setLongTimeout.js';
import { clientMetadataCache } from './clientMetadataCache.js';
import { getDnsResolver } from './dnsResolver.js';
import { generateCodeChallenge } from './generateCodeChallenge.js';
import { isValidRedirectUri } from './isValidRedirectUri.js';
import { TABLEAU_CLOUD_SERVER_URL } from './provider.js';
import { cimdMetadataSchema, ClientMetadata, mcpAuthorizeSchema } from './schemas.js';
import { PendingAuthorization } from './types.js';

/**
 * OAuth 2.1 Authorization Endpoint
 *
 * Handles authorization requests with PKCE parameters.
 * Validates request, stores pending authorization, and
 * redirects to Tableau OAuth.
 */
export function authorize(
  app: express.Application,
  pendingAuthorizations: Map<string, PendingAuthorization>,
): void {
  const config = getConfig();

  app.get('/oauth/authorize', async (req, res) => {
    const result = mcpAuthorizeSchema.safeParse(req.query);

    if (!result.success) {
      res.status(400).json({
        error: 'invalid_request',
        error_description: fromError(result.error).toString(),
      });
      return;
    }

    const { client_id, redirect_uri, response_type, code_challenge, code_challenge_method, state } =
      result.data;

    const clientIdUrl = parseUrl(client_id);
    if (clientIdUrl) {
      // Client ID is a URL, so we need to attempt to fetch the client metadata from the URL
      const clientResult = await getClientFromMetadataDoc(clientIdUrl);
      if (clientResult.isErr()) {
        res.status(400).json(clientResult.error);
        return;
      }

      if (clientResult.value) {
        const { redirect_uris, response_types } = clientResult.value;

        if (response_types && !response_types.find((type) => type === response_type)) {
          res.status(400).json({
            error: 'unsupported_response_type',
            error_description: `Unsupported response type: ${response_type}`,
          });
          return;
        }

        if (redirect_uris && !redirect_uris.includes(redirect_uri)) {
          res.status(400).json({
            error: 'invalid_request',
            error_description: `Invalid redirect URI: ${redirect_uri}`,
          });
          return;
        }
      }
    }

    if (response_type !== 'code') {
      res.status(400).json({
        error: 'unsupported_response_type',
        error_description: 'Only authorization code flow is supported',
      });
      return;
    }

    if (code_challenge_method !== 'S256') {
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'Only S256 code challenge method is supported',
      });
      return;
    }

    if (!isValidRedirectUri(redirect_uri)) {
      res.status(400).json({
        error: 'invalid_request',
        error_description: `Invalid redirect URI: ${redirect_uri}`,
      });
      return;
    }

    // Generate Tableau state and store pending authorization
    const tableauState = randomBytes(32).toString('hex');
    const authKey = randomBytes(32).toString('hex');

    const tableauClientId = randomUUID();
    // 22-64 bytes (44-128 chars) is the recommended length for code verifiers
    const numCodeVerifierBytes = Math.floor(Math.random() * (64 - 22 + 1)) + 22;
    const tableauCodeVerifier = randomBytes(numCodeVerifierBytes).toString('hex');
    const tableauCodeChallenge = generateCodeChallenge(tableauCodeVerifier);
    pendingAuthorizations.set(authKey, {
      clientId: client_id,
      redirectUri: redirect_uri,
      codeChallenge: code_challenge,
      state: state ?? '',
      tableauState,
      tableauClientId,
      tableauCodeVerifier,
    });

    // Clean up expired authorizations
    setLongTimeout(() => pendingAuthorizations.delete(authKey), config.oauth.authzCodeTimeoutMs);

    // Redirect to Tableau OAuth
    const server = config.server || TABLEAU_CLOUD_SERVER_URL;
    const oauthUrl = new URL(`${server}/oauth2/v1/auth`);
    oauthUrl.searchParams.set('client_id', tableauClientId);
    oauthUrl.searchParams.set('code_challenge', tableauCodeChallenge);
    oauthUrl.searchParams.set('code_challenge_method', 'S256');
    oauthUrl.searchParams.set('response_type', 'code');
    oauthUrl.searchParams.set('redirect_uri', config.oauth.redirectUri);
    oauthUrl.searchParams.set('state', `${authKey}:${tableauState}`);
    oauthUrl.searchParams.set('device_id', randomUUID());
    oauthUrl.searchParams.set('target_site', config.siteName);
    oauthUrl.searchParams.set('device_name', getDeviceName(redirect_uri, state ?? ''));
    oauthUrl.searchParams.set('client_type', 'tableau-mcp');

    res.redirect(oauthUrl.toString());
  });
}

// https://client.dev/servers
async function getClientFromMetadataDoc(
  clientMetadataUrl: URL,
): Promise<Result<ClientMetadata, { error: string; error_description: string }>> {
  const originalUrl = clientMetadataUrl.toString();
  const cache = clientMetadataCache.get(originalUrl);
  if (cache) {
    return Ok(cache);
  }

  const originalHostname = clientMetadataUrl.hostname;
  if (!isIP(clientMetadataUrl.hostname)) {
    try {
      // Resolve the IP from DNS
      const dnsResolver = getDnsResolver();
      const resolvedIps = await dnsResolver.resolve4(clientMetadataUrl.hostname);
      let ipAddress = resolvedIps.find(Boolean);
      if (!ipAddress) {
        const resolvedIps = await dnsResolver.resolve6(clientMetadataUrl.hostname);
        ipAddress = resolvedIps.find(Boolean);
        if (!ipAddress) {
          return Err({
            error: 'invalid_request',
            error_description: 'Client URL is not valid',
          });
        }
      }
      // Replace the hostname with the resolved IP Address
      clientMetadataUrl.hostname = ipAddress;
    } catch {
      return Err({
        error: 'invalid_request',
        error_description: 'Client URL is not valid',
      });
    }
  }

  const isSafe = isSSRFSafeURL(clientMetadataUrl.toString(), {
    allowedProtocols: ['https'],
    autoPrependProtocol: false,
  });

  if (!isSafe) {
    return Err({
      error: 'invalid_request',
      error_description: 'Client Metadata URL is not allowed',
    });
  }

  let response: AxiosResponse;
  try {
    const client = axios.create();
    response = await client.get(clientMetadataUrl.toString(), {
      timeout: 5000,
      maxContentLength: 5 * 1024, // 5 KB
      maxRedirects: 3,
      headers: {
        Accept: 'application/json',
        Host: originalHostname,
      },
      'axios-retry': {
        retries: 3,
        retryDelay: axiosRetry.exponentialDelay,
      },
    });
  } catch {
    return Err({
      error: 'invalid_request',
      error_description: 'Unable to fetch client metadata',
    });
  }

  const contentType = getStringResponseHeader(response.headers, 'content-type');
  if (!contentType) {
    return Err({
      error: 'invalid_client_metadata',
      error_description: 'Client Metadata URL must return a valid Content-Type header',
    });
  }

  const contentTypes = contentType.split(';').map((s) => s.trim());
  if (!contentTypes.includes('application/json')) {
    return Err({
      error: 'invalid_client_metadata',
      error_description: 'Client Metadata URL must return a JSON response',
    });
  }

  const clientMetadataResult = cimdMetadataSchema.safeParse(response.data);
  if (!clientMetadataResult.success) {
    return Err({
      error: 'invalid_client_metadata',
      error_description: `Client metadata is invalid: ${fromError(clientMetadataResult.error).toString()}`,
    });
  }

  if (clientMetadataResult.data.client_id !== originalUrl) {
    return Err({
      error: 'invalid_client_metadata',
      error_description: 'Client ID mismatch',
    });
  }

  const cacheControl = getStringResponseHeader(response.headers, 'cache-control');
  let cacheControlMaxAge: string | undefined;
  if (cacheControl) {
    const maxAgeDirective = cacheControl
      .split(',')
      .map((s) => s.trim())
      .find((s) => /^max-age\s*=\s*\d+$/i.test(s));

    if (maxAgeDirective) {
      cacheControlMaxAge = maxAgeDirective.split('=')[1].trim();
    }
  }

  let cacheExpiryMs = clientMetadataCache.defaultExpirationTimeMs;
  if (cacheControlMaxAge) {
    const cacheControlMaxAgeSeconds = parseInt(cacheControlMaxAge);
    if (!isNaN(cacheControlMaxAgeSeconds) && cacheControlMaxAgeSeconds >= 0) {
      cacheExpiryMs = Math.min(ONE_DAY_IN_MS, cacheControlMaxAgeSeconds * 1000);
    }
  }

  if (cacheExpiryMs > 0) {
    clientMetadataCache.set(originalUrl, clientMetadataResult.data, cacheExpiryMs);
  }

  return Ok(clientMetadataResult.data);
}

function getDeviceName(redirectUri: string, state: string): string {
  const defaultDeviceName = 'tableau-mcp (Unknown agent)';

  try {
    const url = new URL(redirectUri);
    if (url.protocol === 'https:' || url.protocol === 'http:') {
      if (redirectUri === 'https://vscode.dev/redirect' && new URL(state).protocol === 'vscode:') {
        // VS Code normally authenticates in a way that doesn't give any clues about who it is.
        // It has a backup authentication method they call "URL Handler" that does though.
        return 'tableau-mcp (VS Code)';
      }

      return defaultDeviceName;
    } else if (url.protocol === 'cursor:') {
      return 'tableau-mcp (Cursor)';
    } else {
      return `tableau-mcp (${url.protocol.slice(0, -1)})`;
    }
  } catch {
    return defaultDeviceName;
  }
}
