import { matchesRegisteredRedirectUri } from './matchesRegisteredRedirectUri.js';

describe('matchesRegisteredRedirectUri', () => {
  describe('exact matches', () => {
    it('matches identical URIs', () => {
      expect(matchesRegisteredRedirectUri('http://127.0.0.1/cb', 'http://127.0.0.1/cb')).toBe(true);
    });

    it('matches identical custom-scheme URIs', () => {
      expect(matchesRegisteredRedirectUri('cursor://cb', 'cursor://cb')).toBe(true);
    });

    it('matches identical https URIs', () => {
      expect(matchesRegisteredRedirectUri('https://example.com/cb', 'https://example.com/cb')).toBe(
        true,
      );
    });
  });

  describe('loopback port relaxation (RFC 8252 §7.3)', () => {
    it('allows any port for IPv4 loopback (127.0.0.1)', () => {
      expect(
        matchesRegisteredRedirectUri(
          'http://127.0.0.1:54321/callback',
          'http://127.0.0.1/callback',
        ),
      ).toBe(true);
    });

    it('allows any port for IPv6 loopback ([::1])', () => {
      expect(
        matchesRegisteredRedirectUri('http://[::1]:54321/callback', 'http://[::1]/callback'),
      ).toBe(true);
    });

    it('allows any port for localhost', () => {
      expect(
        matchesRegisteredRedirectUri(
          'http://localhost:54321/callback',
          'http://localhost/callback',
        ),
      ).toBe(true);
    });

    it('allows port differences when registered URI also has a port', () => {
      expect(
        matchesRegisteredRedirectUri(
          'http://127.0.0.1:54321/callback',
          'http://127.0.0.1:6274/callback',
        ),
      ).toBe(true);
    });

    it('preserves query and fragment when they match', () => {
      expect(
        matchesRegisteredRedirectUri('http://127.0.0.1:9/cb?x=1#y', 'http://127.0.0.1/cb?x=1#y'),
      ).toBe(true);
    });
  });

  describe('loopback mismatches', () => {
    it('rejects path mismatch', () => {
      expect(matchesRegisteredRedirectUri('http://127.0.0.1:9/a', 'http://127.0.0.1/b')).toBe(
        false,
      );
    });

    it('rejects query mismatch', () => {
      expect(
        matchesRegisteredRedirectUri('http://127.0.0.1:9/cb?x=1', 'http://127.0.0.1/cb?x=2'),
      ).toBe(false);
    });

    it('rejects fragment mismatch', () => {
      expect(matchesRegisteredRedirectUri('http://127.0.0.1:9/cb#a', 'http://127.0.0.1/cb#b')).toBe(
        false,
      );
    });

    it('rejects scheme mismatch (https request vs http registered)', () => {
      expect(matchesRegisteredRedirectUri('https://127.0.0.1:9/cb', 'http://127.0.0.1/cb')).toBe(
        false,
      );
    });

    it('rejects cross-host loopback: localhost vs 127.0.0.1', () => {
      expect(matchesRegisteredRedirectUri('http://localhost:9/cb', 'http://127.0.0.1/cb')).toBe(
        false,
      );
      expect(matchesRegisteredRedirectUri('http://127.0.0.1:9/cb', 'http://localhost/cb')).toBe(
        false,
      );
    });

    it('rejects cross-host loopback: ::1 vs 127.0.0.1', () => {
      expect(matchesRegisteredRedirectUri('http://[::1]:9/cb', 'http://127.0.0.1/cb')).toBe(false);
    });

    it('rejects userinfo mismatch', () => {
      expect(matchesRegisteredRedirectUri('http://u:p@127.0.0.1:9/cb', 'http://127.0.0.1/cb')).toBe(
        false,
      );
    });
  });

  describe('non-loopback strictness', () => {
    it('rejects port difference on non-loopback http host', () => {
      expect(matchesRegisteredRedirectUri('http://example.com:9/cb', 'http://example.com/cb')).toBe(
        false,
      );
    });

    it('rejects port difference on https host', () => {
      expect(
        matchesRegisteredRedirectUri('https://example.com:8443/cb', 'https://example.com/cb'),
      ).toBe(false);
    });

    it('rejects custom scheme mismatch', () => {
      expect(matchesRegisteredRedirectUri('cursor://cb', 'fakemcpclient://cb')).toBe(false);
    });
  });

  describe('invalid input', () => {
    it('returns false for unparseable request URI', () => {
      expect(matchesRegisteredRedirectUri('not a url', 'http://127.0.0.1/cb')).toBe(false);
    });

    it('returns false for unparseable registered URI', () => {
      expect(matchesRegisteredRedirectUri('http://127.0.0.1:9/cb', 'not a url')).toBe(false);
    });

    it('returns false for empty strings that do not match', () => {
      expect(matchesRegisteredRedirectUri('', 'http://127.0.0.1/cb')).toBe(false);
    });
  });
});
