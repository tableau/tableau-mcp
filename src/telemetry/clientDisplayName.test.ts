import { getClientDisplayName } from './clientDisplayName.js';

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
