import { exportedForTesting } from '../../src/server/oauth/authorize.js';

const { getDeviceName } = exportedForTesting;

describe('getDeviceName', () => {
  it('should use client_name from CIMD when provided', () => {
    expect(getDeviceName('http://127.0.0.1:33418/', '', 'Visual Studio Code')).toBe(
      'tableau-mcp (Visual Studio Code)',
    );
  });

  it('should prefer client_name over redirect_uri heuristics', () => {
    expect(getDeviceName('cursor://anysdk.cursor.sh/auth/callback', '', 'Cursor')).toBe(
      'tableau-mcp (Cursor)',
    );
  });

  it('should detect Cursor from redirect_uri protocol when no client_name', () => {
    expect(getDeviceName('cursor://anysdk.cursor.sh/auth/callback', '')).toBe(
      'tableau-mcp (Cursor)',
    );
  });

  it('should detect VS Code from redirect_uri + state when no client_name', () => {
    expect(
      getDeviceName(
        'https://vscode.dev/redirect',
        'vscode://vscode.github-authentication/did-authenticate',
      ),
    ).toBe('tableau-mcp (VS Code)');
  });

  it('should use protocol name for other custom protocols', () => {
    expect(getDeviceName('windsurf://auth/callback', '')).toBe('tableau-mcp (windsurf)');
  });

  it('should return Unknown agent for http/https without matching heuristics', () => {
    expect(getDeviceName('http://127.0.0.1:33418/', '')).toBe('tableau-mcp (Unknown agent)');
  });

  it('should return Unknown agent for invalid redirect_uri', () => {
    expect(getDeviceName('not-a-url', '')).toBe('tableau-mcp (Unknown agent)');
  });
});
