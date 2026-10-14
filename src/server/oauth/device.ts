import { v5 as uuidv5 } from 'uuid';

// Fixed namespace UUID for tableau-mcp device IDs. Combined with the device name via UUIDv5,
// this yields a stable device_id per client type so repeat authorizations from the same client
// reuse a single device entry in Tableau instead of registering a new device on every re-auth.
const DEVICE_ID_NAMESPACE = 'e3b4f2a0-6c1d-4f8e-9a2b-7d5c1e0f3a6b';

/**
 * Derives a deterministic device ID from the device name using RFC 4122 v5 (namespace + name).
 * Same device name always maps to the same UUID, making the device_id stable per client type
 * without any server-side state (safe across restarts and horizontally scaled instances).
 */
export function getDeviceId(deviceName: string): string {
  return uuidv5(deviceName, DEVICE_ID_NAMESPACE);
}

/**
 * Derives a human-readable device name for the Tableau OAuth `device_name` param, identifying
 * the MCP client (e.g. VS Code, Cursor) from the client metadata name or the redirect URI.
 */
export function getDeviceName(
  redirectUri: string,
  state: string,
  clientName: string | undefined,
): string {
  if (clientName) {
    return `tableau-mcp (${clientName})`;
  }

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
