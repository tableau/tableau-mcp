const startupState = vi.hoisted(() => ({
  activeFeatureGateProvider: 'server',
  providerAtWebToolRegistration: undefined as string | undefined,
  resourcesRegistered: false,
  resourcesAvailableAtConnect: undefined as boolean | undefined,
}));

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: vi.fn(function () {
    return {
      server: {
        setRequestHandler: vi.fn(),
      },
      connect: vi.fn(async () => {
        startupState.resourcesAvailableAtConnect = startupState.resourcesRegistered;
      }),
    };
  }),
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn(),
}));

vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  SetLevelRequestSchema: {},
}));

vi.mock('dotenv', () => ({
  default: { config: vi.fn() },
}));

vi.mock('./config.js', () => ({
  getConfig: vi.fn(() => ({
    transport: 'stdio',
    server: 'https://tableau.example.com',
    defaultNotificationLevel: 'info',
    loggers: new Set<string>(),
    fileLoggerDirectory: '/tmp',
    disableLogMasking: false,
  })),
}));

vi.mock('./config.desktop.js', () => ({
  getDesktopConfig: vi.fn(() => ({
    desktopSessionId: undefined,
    toolProfile: 'dynamic-authoring',
  })),
}));

vi.mock('./desktop/instructions.js', () => ({
  buildDesktopInstructions: vi.fn(() => 'desktop instructions'),
}));

vi.mock('./features/init.js', () => ({
  initializeFeatureGate: vi.fn(() => {
    startupState.activeFeatureGateProvider = 'custom';
  }),
}));

vi.mock('./getTableauServerInfo.js', () => ({
  getTableauServerInfo: vi.fn(async () => undefined),
}));

vi.mock('./logging/fileLogger.js', () => ({
  FileLogger: vi.fn(),
  setFileLogger: vi.fn(),
}));

vi.mock('./logging/logger.js', () => ({
  log: vi.fn(),
}));

vi.mock('./logging/notification.js', () => ({
  isNotificationLevel: vi.fn(() => true),
  notifier: { info: vi.fn() },
  setNotificationLevel: vi.fn(),
}));

vi.mock('./sdks/tableau/restApi.js', () => ({
  RestApi: { host: '' },
}));

vi.mock('./server.web.js', () => ({
  buildWebInstructions: vi.fn(() => 'web instructions'),
  WebMcpServer: vi.fn(function () {
    return {
      registerTools: vi.fn(async () => {
        startupState.providerAtWebToolRegistration = startupState.activeFeatureGateProvider;
      }),
    };
  }),
}));

vi.mock('./server.desktop.js', () => ({
  DesktopMcpServer: vi.fn(function ({ mcpServer }) {
    return {
      mcpServer,
      registerTools: vi.fn(async () => undefined),
      registerResources: vi.fn(async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        startupState.resourcesRegistered = true;
      }),
    };
  }),
}));

describe('combined entrypoint startup', () => {
  beforeAll(async () => {
    await import('./index.combined.js');
    await vi.waitFor(() => {
      expect(startupState.resourcesAvailableAtConnect).not.toBeUndefined();
    });
  });

  it('initializes the configured feature gate before registering web tools', () => {
    expect(startupState.providerAtWebToolRegistration).toBe('custom');
  });

  it('makes Desktop resources available before connecting the shared server', () => {
    expect(startupState.resourcesAvailableAtConnect).toBe(true);
  });
});
