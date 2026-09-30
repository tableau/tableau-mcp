import { getConfig } from '../../config.js';
import { OverridableConfig } from '../../overridableConfig.js';
import { WebMcpServer } from '../../server.web.js';
import { TableauWebRequestHandlerExtra } from './toolContext.js';

export function getMockRequestHandlerExtra(): TableauWebRequestHandlerExtra {
  const extra: any = {
    config: getConfig(),
    server: new WebMcpServer(),
    tableauAuthInfo: undefined,
    _siteLuid: 'test-site-luid',
    _userLuid: 'test-user-luid',
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
  };

  return extra;
}
