import { describe, expect, it } from 'vitest';

import { InMemorySessionStore } from '../../sessionStore/inMemorySessionStore.js';
import type { SessionStore } from '../../sessionStore/sessionStore.js';
import { milliseconds } from '../../utils/milliseconds.js';
import { checkRedirectUriAllowed } from './authorizeRedirectUri.js';
import { ClientRegistration } from './types.js';

const INVALID = (redirectUri: string): { error: string; error_description: string } => ({
  error: 'invalid_request',
  error_description: `Invalid redirect URI: ${redirectUri}`,
});

async function registrations(
  entries: Record<string, string[]>,
): Promise<SessionStore<ClientRegistration>> {
  const store = new InMemorySessionStore<ClientRegistration>({ ttlMs: milliseconds.fromDays(24) });
  for (const [clientId, redirectUris] of Object.entries(entries)) {
    await store.set(clientId, { redirectUris });
  }
  return store;
}

describe('checkRedirectUriAllowed', () => {
  describe('known (registered) client', () => {
    it('allows a redirect_uri matching a stored URI', async () => {
      expect(
        await checkRedirectUriAllowed({
          clientId: 'client-123',
          redirectUri: 'https://app.example.com/cb',
          clientRegistrations: await registrations({
            'client-123': ['https://app.example.com/cb'],
          }),
        }),
      ).toBeNull();
    });

    it('allows a loopback redirect_uri on a different port (RFC 8252 relaxation)', async () => {
      expect(
        await checkRedirectUriAllowed({
          clientId: 'client-123',
          redirectUri: 'http://127.0.0.1:59152/cb',
          clientRegistrations: await registrations({ 'client-123': ['http://127.0.0.1:0/cb'] }),
        }),
      ).toBeNull();
    });

    it('rejects a redirect_uri not among the stored URIs', async () => {
      const redirectUri = 'https://evil.example.com/cb';
      expect(
        await checkRedirectUriAllowed({
          clientId: 'client-123',
          redirectUri,
          clientRegistrations: await registrations({
            'client-123': ['https://app.example.com/cb'],
          }),
        }),
      ).toEqual(INVALID(redirectUri));
    });
  });

  describe('unknown (never registered / lost on restart) client', () => {
    it('allows a loopback http redirect_uri via native-only fallback', async () => {
      expect(
        await checkRedirectUriAllowed({
          clientId: 'never-registered',
          redirectUri: 'http://localhost:3000/cb',
          clientRegistrations: await registrations({}),
        }),
      ).toBeNull();
    });

    it('allows a custom-scheme redirect_uri via native-only fallback', async () => {
      expect(
        await checkRedirectUriAllowed({
          clientId: 'never-registered',
          redirectUri: 'cursor://cb',
          clientRegistrations: await registrations({}),
        }),
      ).toBeNull();
    });

    it('rejects a remote https redirect_uri (the account-takeover case)', async () => {
      const redirectUri = 'https://evil.example.com/cb';
      expect(
        await checkRedirectUriAllowed({
          clientId: 'never-registered',
          redirectUri,
          clientRegistrations: await registrations({}),
        }),
      ).toEqual(INVALID(redirectUri));
    });
  });
});
