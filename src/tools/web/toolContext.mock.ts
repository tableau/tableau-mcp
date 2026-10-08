import { getConfig } from '../../config.js';
import { OverridableConfig } from '../../overridableConfig.js';
import { WebMcpServer } from '../../server.web.js';
import { TableauWebRequestHandlerExtra } from './toolContext.js';

// Valid LUIDs: S3 key builders reject anything that isn't a UUID.
export const MOCK_SITE_LUID = '0a1b2c3d-1111-4222-8333-444455556666';
export const MOCK_USER_LUID = '9f8e7d6c-aaaa-4bbb-8ccc-ddddeeeeffff';

export function getMockRequestHandlerExtra(
  overrides: Partial<TableauWebRequestHandlerExtra> = {},
): TableauWebRequestHandlerExtra {
  const extra: any = {
    config: getConfig(),
    server: new WebMcpServer(),
    tableauAuthInfo: undefined,
    _siteLuid: MOCK_SITE_LUID,
    _userLuid: MOCK_USER_LUID,
    // Default to false so tools that gate their app-card path on this signal fall back to the plain
    // text result under test unless a case explicitly opts into an app-renderable client.
    mcpAppToolsRenderable: false,
    getSiteLuid() {
      return extra._siteLuid ?? '';
    },
    getSiteName() {
      return 'tc25';
    },
    getUserLuid() {
      return extra._userLuid ?? '';
    },
    setSiteLuid: vi.fn(),
    setUserLuid: vi.fn(),
    getConfigWithOverrides: vi.fn().mockResolvedValue(new OverridableConfig({})),
    signal: new AbortController().signal,
    requestId: 2,
    sendNotification: vi.fn(),
    sendRequest: vi.fn(),
    ...overrides,
  };

  return extra;
}
