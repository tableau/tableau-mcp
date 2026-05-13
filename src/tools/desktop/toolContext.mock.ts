import { getDesktopConfig } from '../../config.desktop.js';
import { DesktopMcpServer } from '../../server.desktop.js';
import { TableauDesktopRequestHandlerExtra } from './toolContext.js';

export function getMockRequestHandlerExtra(): TableauDesktopRequestHandlerExtra {
  return {
    config: getDesktopConfig(),
    getExecutor: vi.fn(),
    server: new DesktopMcpServer(),
    signal: new AbortController().signal,
    requestId: 2,
    sendNotification: vi.fn(),
    sendRequest: vi.fn(),
  };
}
