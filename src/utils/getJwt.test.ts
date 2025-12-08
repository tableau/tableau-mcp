import {
  decodeJwt,
  decodeProtectedHeader,
  exportPKCS8,
  generateKeyPair,
  importPKCS8,
  jwtVerify,
} from 'jose';

import { getJwt } from './getJwt.js';

vi.mock('node:crypto', () => {
  return { randomUUID: vi.fn(() => '123e4567-e89b-12d3-a456-426614174000') };
});

describe('getJwt', () => {
  const mockUsername = 'test-user';
  const mockScopes = new Set(['read', 'write']);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('connected-app', () => {
    const mockConnectedApp = {
      clientId: 'test-client-id',
      secretId: 'test-secret-id',
      secretValue: 'test-secret-value',
    };

    it('should include correct header in the token', async () => {
      const token = await getJwt({
        username: mockUsername,
        config: { type: 'connected-app', ...mockConnectedApp },
        scopes: mockScopes,
      });

      const decodedHeader = decodeProtectedHeader(token);
      expect(decodedHeader).toEqual({
        alg: 'HS256',
        typ: 'JWT',
        kid: mockConnectedApp.secretId,
      });
    });

    it('should include correct payload in the token', async () => {
      const token = await getJwt({
        username: mockUsername,
        config: { type: 'connected-app', ...mockConnectedApp },
        scopes: mockScopes,
      });

      const decodedPayload = decodeJwt(token);
      expect(decodedPayload).toMatchObject({
        jti: '123e4567-e89b-12d3-a456-426614174000',
        iss: mockConnectedApp.clientId,
        aud: 'tableau',
        sub: mockUsername,
        scp: [...mockScopes],
      });

      // Verify timestamp fields are within expected ranges
      const now = Math.floor(Date.now() / 1000);
      expect(decodedPayload.iat).toBeLessThanOrEqual(now);
      expect(decodedPayload.exp).toBeGreaterThan(now);
    });

    it('should generate a token that can be verified with the secret', async () => {
      const token = await getJwt({
        username: mockUsername,
        config: { type: 'connected-app', ...mockConnectedApp },
        scopes: mockScopes,
      });

      await expect(
        jwtVerify(token, new TextEncoder().encode(mockConnectedApp.secretValue)),
      ).resolves.not.toThrow();
    });

    it('should throw when verifying with incorrect secret', async () => {
      const token = await getJwt({
        username: mockUsername,
        config: { type: 'connected-app', ...mockConnectedApp },
        scopes: mockScopes,
      });

      await expect(jwtVerify(token, new TextEncoder().encode('wrong-secret'))).rejects.toThrow();
    });
  });

  describe('uat', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
    const privateKeyPem = await exportPKCS8(privateKey);

    const mockUatConfig = {
      tenantId: 'test-tenant-id',
      issuer: 'test-issuer',
      keyId: 'test-key-id',
      privateKey: privateKeyPem,
    };

    it('should include correct header in the token', async () => {
      const token = await getJwt({
        username: mockUsername,
        config: {
          type: 'uat',
          ...mockUatConfig,
        },
        scopes: mockScopes,
      });

      const decodedHeader = decodeProtectedHeader(token);
      expect(decodedHeader).toEqual({
        alg: 'RS256',
        typ: 'JWT',
        kid: mockUatConfig.keyId,
      });
    });

    it('should include correct payload in the token', async () => {
      const token = await getJwt({
        username: mockUsername,
        config: { type: 'uat', ...mockUatConfig },
        scopes: mockScopes,
      });

      const decodedPayload = decodeJwt(token);
      expect(decodedPayload).toMatchObject({
        jti: `${mockUatConfig.issuer}-${decodedPayload.iat}`,
        iss: mockUatConfig.issuer,
        sub: mockUsername,
        scp: [...mockScopes],
      });

      // Verify timestamp fields are within expected ranges
      const now = Math.floor(Date.now() / 1000);
      expect(decodedPayload.iat).toBeLessThanOrEqual(now);
      expect(decodedPayload.exp).toBeGreaterThan(now);
    });

    it('should generate a token that can be verified with the secret', async () => {
      const token = await getJwt({
        username: mockUsername,
        config: { type: 'uat', ...mockUatConfig },
        scopes: mockScopes,
      });

      await expect(jwtVerify(token, publicKey)).resolves.not.toThrow();
    });

    it('should throw when verifying with incorrect secret', async () => {
      const token = await getJwt({
        username: mockUsername,
        config: { type: 'uat', ...mockUatConfig },
        scopes: mockScopes,
      });

      const { publicKey: wrongPublicKey } = await generateKeyPair('RS256');
      await expect(jwtVerify(token, wrongPublicKey)).rejects.toThrow();
    });
  });
});
