import { getClientDisplayName, sanitizeClientIdForTelemetry } from './clientDisplayName.js';

describe('getClientDisplayName', () => {
  it('returns undefined when the client id is undefined', () => {
    expect(getClientDisplayName(undefined)).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(getClientDisplayName('')).toBeUndefined();
  });

  it('maps a known Claude CIMD client id URL to a friendly name', () => {
    expect(getClientDisplayName('https://claude.ai/.well-known/oauth/client-metadata.json')).toBe(
      'Claude',
    );
  });

  it('maps a known Cursor CIMD client id URL to a friendly name', () => {
    expect(getClientDisplayName('https://cursor.com/oauth/client-metadata.json')).toBe('Cursor');
  });

  it('maps a known VS Code CIMD client id URL to a friendly name', () => {
    expect(getClientDisplayName('https://vscode.dev/oauth/client-metadata.json')).toBe('VS Code');
  });

  it('matches subdomains of a known client host', () => {
    expect(getClientDisplayName('https://anysdk.cursor.sh/auth/client-metadata.json')).toBe(
      'Cursor',
    );
  });

  it('returns undefined for an unknown CIMD client id URL', () => {
    expect(
      getClientDisplayName('https://www.fakemcpclient.com/.well-known/oauth/client-metadata.json'),
    ).toBeUndefined();
  });

  it('returns undefined for a non-URL client id', () => {
    expect(getClientDisplayName('not-a-url')).toBeUndefined();
  });

  it('does not match a look-alike host that merely contains a known domain', () => {
    expect(getClientDisplayName('https://claude.ai.evil.com/client-metadata.json')).toBeUndefined();
  });
});

describe('sanitizeClientIdForTelemetry', () => {
  it('returns an empty string for an undefined client id', () => {
    expect(sanitizeClientIdForTelemetry(undefined)).toBe('');
  });

  it('returns an empty string for an empty client id', () => {
    expect(sanitizeClientIdForTelemetry('')).toBe('');
  });

  it('strips query params, fragments, and userinfo from a URL, keeping origin + pathname', () => {
    expect(
      sanitizeClientIdForTelemetry(
        'https://user:secret@claude.ai/.well-known/oauth/client-metadata.json?token=abc#frag',
      ),
    ).toBe('https://claude.ai/.well-known/oauth/client-metadata.json');
  });

  it('caps an over-long URL at 200 chars with no ellipsis injection', () => {
    const longUrl = `https://claude.ai/${'a'.repeat(500)}`;

    const sanitized = sanitizeClientIdForTelemetry(longUrl);

    expect(sanitized.length).toBe(200);
    expect(sanitized.startsWith('https://claude.ai/aaa')).toBe(true);
    expect(sanitized).not.toContain('truncated');
    expect(sanitized).not.toContain('...');
  });

  it('passes a non-URL string through unchanged when within the cap', () => {
    expect(sanitizeClientIdForTelemetry('not-a-url')).toBe('not-a-url');
  });

  it('caps an over-long non-URL string at 200 chars with no ellipsis injection', () => {
    const sanitized = sanitizeClientIdForTelemetry('x'.repeat(500));

    expect(sanitized).toBe('x'.repeat(200));
    expect(sanitized.length).toBe(200);
  });

  it('preserves known-host mapping after sanitization', () => {
    const sanitized = sanitizeClientIdForTelemetry(
      'https://claude.ai/.well-known/oauth/client-metadata.json?token=abc',
    );

    expect(getClientDisplayName(sanitized)).toBe('Claude');
  });
});
