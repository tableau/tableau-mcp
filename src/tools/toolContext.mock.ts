import { getConfig } from '../config.js';
import { OverridableConfig } from '../overridableConfig.js';
import { Server } from '../server.js';
import { TableauRequestHandlerExtra } from './toolContext.js';

export function getMockRequestHandlerExtra(): TableauRequestHandlerExtra {
  return {
    config: getConfig(),
    server: new Server(),
    tableauAuthInfo: undefined,
    getConfigWithOverrides: vi.fn().mockResolvedValue(new OverridableConfig({})),
    signal: new AbortController().signal,
    requestId: 2,
    sendNotification: vi.fn(),
    sendRequest: vi.fn(),
  };
}
