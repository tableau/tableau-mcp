import {
  buildAuthenticationErrorMessage,
  buildPermissionErrorMessage,
  describeAuthTarget,
  OAUTH_AUTH_CHALLENGE_GUIDANCE,
} from './authErrorMessage.js';

describe('authErrorMessage (W-23757363)', () => {
  describe('describeAuthTarget', () => {
    it('renders both site and pod when known', () => {
      expect(describeAuthTarget({ site: 'acme', server: 'https://pod.example.com' })).toBe(
        ' (site "acme", pod "https://pod.example.com")',
      );
    });

    it('omits the missing part', () => {
      expect(describeAuthTarget({ site: 'acme' })).toBe(' (site "acme")');
      expect(describeAuthTarget({ server: 'https://pod.example.com' })).toBe(
        ' (pod "https://pod.example.com")',
      );
    });

    it('returns an empty clause when neither is known', () => {
      expect(describeAuthTarget({})).toBe('');
    });
  });

  describe('buildAuthenticationErrorMessage', () => {
    it('names the 401 cause, the site + pod, and the re-auth guidance', () => {
      const message = buildAuthenticationErrorMessage({
        site: 'acme',
        server: 'https://pod.example.com',
      });
      expect(message).toContain('Authentication failed (401)');
      expect(message).toContain('site "acme"');
      expect(message).toContain('pod "https://pod.example.com"');
      expect(message).toContain('missing, invalid, or expired');
      expect(message).toContain('verify the request targeted the intended server');
      expect(message).toContain('A 401 is an authentication problem, not a missing feature.');
    });

    it('still reads when site + pod are unknown', () => {
      const message = buildAuthenticationErrorMessage();
      expect(message).toContain('Authentication failed (401)');
      expect(message).not.toContain('site "');
    });
  });

  describe('buildPermissionErrorMessage', () => {
    it('names the 403 cause, allows for a disabled capability, and rules out re-auth', () => {
      const message = buildPermissionErrorMessage({ site: 'acme' });
      expect(message).toContain('Permission denied (403)');
      expect(message).toContain('may lack the required site role or permission');
      expect(message).toContain('the capability may not be enabled for this site');
      expect(message).toContain('not an authentication failure');
    });
  });

  it('exposes challenge guidance that names the 401-vs-missing-feature distinction', () => {
    expect(OAUTH_AUTH_CHALLENGE_GUIDANCE).toContain(
      'A 401 is an authentication problem, not a missing feature.',
    );
  });
});
