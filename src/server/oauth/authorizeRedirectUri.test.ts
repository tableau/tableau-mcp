import { describe, expect, it } from 'vitest';

import { checkRedirectUriAllowed } from './authorizeRedirectUri.js';
import { ClientRegistration } from './types.js';

const INVALID = (redirectUri: string) => ({
  error: 'invalid_request',
  error_description: `Invalid redirect URI: ${redirectUri}`,
});

function registrations(
  entries: Record<string, string[]>,
): Map<string, ClientRegistration> {
  const map = new Map<string, ClientRegistration>();
  for (const [clientId, redirectUris] of Object.entries(entries)) {
    map.set(clientId, { redirectUris, tokenEndpointAuthMethod: 'client_secret_basic' });
  }
  return map;
}

describe('checkRedirectUriAllowed', () => {
  describe('CIMD path (clientIdUrl set)', () => {
    it('defers to authorize.ts and always returns null', () => {
      // The CIMD branch enforces its own redirect allowlist upstream, so this helper
      // must not second-guess it — even a remote https URI returns null here.
      expect(
        checkRedirectUriAllowed({
          clientIdUrl: new URL('https://client.example.com/metadata'),
          clientId: 'https://client.example.com/metadata',
          redirectUri: 'https://anything.example.com/cb',
          clientRegistrations: registrations({}),
        }),
      ).toBeNull();
    });
  });

  describe('opaque client_id — known (registered) client', () => {
    it('allows a redirect_uri matching a stored URI', () => {
      expect(
        checkRedirectUriAllowed({
          clientIdUrl: undefined,
          clientId: 'client-123',
          redirectUri: 'https://app.example.com/cb',
          clientRegistrations: registrations({ 'client-123': ['https://app.example.com/cb'] }),
        }),
      ).toBeNull();
    });

    it('allows a loopback redirect_uri on a different port (RFC 8252 relaxation)', () => {
      expect(
        checkRedirectUriAllowed({
          clientIdUrl: undefined,
          clientId: 'client-123',
          redirectUri: 'http://127.0.0.1:59152/cb',
          clientRegistrations: registrations({ 'client-123': ['http://127.0.0.1:0/cb'] }),
        }),
      ).toBeNull();
    });

    it('rejects a redirect_uri not among the stored URIs', () => {
      const redirectUri = 'https://evil.example.com/cb';
      expect(
        checkRedirectUriAllowed({
          clientIdUrl: undefined,
          clientId: 'client-123',
          redirectUri,
          clientRegistrations: registrations({ 'client-123': ['https://app.example.com/cb'] }),
        }),
      ).toEqual(INVALID(redirectUri));
    });
  });

  describe('opaque client_id — unknown (never registered / lost on restart) client', () => {
    it('allows a loopback http redirect_uri via native-only fallback', () => {
      expect(
        checkRedirectUriAllowed({
          clientIdUrl: undefined,
          clientId: 'never-registered',
          redirectUri: 'http://localhost:3000/cb',
          clientRegistrations: registrations({}),
        }),
      ).toBeNull();
    });

    it('allows a custom-scheme redirect_uri via native-only fallback', () => {
      expect(
        checkRedirectUriAllowed({
          clientIdUrl: undefined,
          clientId: 'never-registered',
          redirectUri: 'cursor://cb',
          clientRegistrations: registrations({}),
        }),
      ).toBeNull();
    });

    it('rejects a remote https redirect_uri (the account-takeover case)', () => {
      const redirectUri = 'https://evil.example.com/cb';
      expect(
        checkRedirectUriAllowed({
          clientIdUrl: undefined,
          clientId: 'never-registered',
          redirectUri,
          clientRegistrations: registrations({}),
        }),
      ).toEqual(INVALID(redirectUri));
    });
  });
});
