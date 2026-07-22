import { getConfig } from '../../config.js';
import { Logger } from '../../logging/logger.js';
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

  // Create bound logger directly (not via logger.child) to avoid issues with mocked logger module
  extra.logger = new Logger({
    getSiteLuid: () => extra.getSiteLuid(),
    getUserLuid: () => extra.getUserLuid(),
  });

  return extra;
}
