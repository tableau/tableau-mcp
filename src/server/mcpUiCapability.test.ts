import { RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { describe, expect, it } from 'vitest';

import { ClientCapabilitiesWithUiExtension, clientSupportsMcpApps } from './mcpUiCapability.js';

const UI_EXTENSION_ID = 'io.modelcontextprotocol/ui';

describe('clientSupportsMcpApps', () => {
  it('returns false when capabilities are undefined', () => {
    expect(clientSupportsMcpApps(undefined)).toBe(false);
  });

  it('returns false when the extensions field is absent', () => {
    expect(clientSupportsMcpApps({})).toBe(false);
  });

  it('returns false when the UI extension is present but has no matching mimeTypes', () => {
    const capabilities: ClientCapabilitiesWithUiExtension = {
      extensions: {
        [UI_EXTENSION_ID]: { mimeTypes: ['text/plain'] },
      },
    };
    expect(clientSupportsMcpApps(capabilities)).toBe(false);
  });

  it('returns false when the UI extension is present but mimeTypes is missing', () => {
    const capabilities: ClientCapabilitiesWithUiExtension = {
      extensions: {
        [UI_EXTENSION_ID]: {},
      },
    };
    expect(clientSupportsMcpApps(capabilities)).toBe(false);
  });

  it('returns true when the UI extension advertises the MCP Apps MIME type', () => {
    const capabilities: ClientCapabilitiesWithUiExtension = {
      extensions: {
        [UI_EXTENSION_ID]: { mimeTypes: [RESOURCE_MIME_TYPE] },
      },
    };
    expect(clientSupportsMcpApps(capabilities)).toBe(true);
  });
});
