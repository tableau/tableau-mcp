import { getConfig } from './config.js';
import { OverridableConfig } from './overridableConfig.js';
import { ProductVersion } from './sdks/tableau/types/serverInfo.js';
import { Server } from './server.js';
import { TableauRequestHandlerExtra } from './tools/toolContext.js';

export const testProductVersion = {
  value: '2025.3.0',
  build: '20253.25.0903.0012',
} satisfies ProductVersion;

export function stubDefaultEnvVars(): void {
  vi.stubEnv('SERVER', 'https://my-tableau-server.com');
  vi.stubEnv('SITE_NAME', 'tc25');
  vi.stubEnv('PAT_NAME', 'sponge');
  vi.stubEnv('PAT_VALUE', 'bob');
  vi.stubEnv('TABLEAU_MCP_TEST', 'true');
  vi.stubEnv('PRODUCT_TELEMETRY_ENABLED', 'false');
}

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
