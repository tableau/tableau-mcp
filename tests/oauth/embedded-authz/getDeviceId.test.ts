import { getDeviceId, getDeviceName } from '../../../src/server/oauth/device.js';

// RFC 4122 v5 UUID: 8-4-4-4-12 hex, version nibble 5, variant nibble 8/9/a/b.
const UUID_V5_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('getDeviceId', () => {
  it('should produce a valid RFC 4122 v5 UUID', () => {
    expect(getDeviceId('tableau-mcp (VS Code)')).toMatch(UUID_V5_REGEX);
  });

  it('should be deterministic for the same device name', () => {
    expect(getDeviceId('tableau-mcp (Cursor)')).toBe(getDeviceId('tableau-mcp (Cursor)'));
  });

  it('should produce different IDs for different device names', () => {
    expect(getDeviceId('tableau-mcp (VS Code)')).not.toBe(getDeviceId('tableau-mcp (Cursor)'));
  });

  it('should be stable across authorizations from the same client type regardless of ephemeral port', () => {
    // Loopback clients use ephemeral ports in the redirect URI, but the derived device name
    // is port-independent, so the device_id must remain stable across sessions.
    const first = getDeviceId(getDeviceName('http://127.0.0.1:33418/', '', 'Visual Studio Code'));
    const second = getDeviceId(getDeviceName('http://127.0.0.1:51027/', '', 'Visual Studio Code'));
    expect(first).toBe(second);
  });
});
