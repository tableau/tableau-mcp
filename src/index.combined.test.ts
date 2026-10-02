const startupState = vi.hoisted(() => ({
  activeFeatureGateProvider: 'server',
  providerAtWebToolRegistration: undefined as string | undefined,
  serverInfoPromise: Promise.resolve({}),
  sessionStoreConnected: false,
  sessionStoreConnectedAtWebToolRegistration: undefined as boolean | undefined,
  sessionStoreDisconnected: false,
  shutdownHandlers: new Map<string, () => Promise<void>>(),
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
  getTableauServerInfo: vi.fn(() => startupState.serverInfoPromise),
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

vi.mock('./sessionStore/init.js', () => ({
  initializeSessionStore: vi.fn(),
  connectSessionStore: vi.fn(async () => {
    startupState.sessionStoreConnected = true;
  }),
  disconnectSessionStore: vi.fn(async () => {
    startupState.sessionStoreDisconnected = true;
  }),
}));

vi.mock('./server.web.js', () => ({
  buildWebInstructions: vi.fn(() => 'web instructions'),
  WebMcpServer: vi.fn(function () {
    return {
      registerTools: vi.fn(async () => {
        startupState.providerAtWebToolRegistration = startupState.activeFeatureGateProvider;
        startupState.sessionStoreConnectedAtWebToolRegistration =
          startupState.sessionStoreConnected;
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
        await Promise.resolve();
        startupState.resourcesRegistered = true;
      }),
    };
  }),
}));

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { initializeFeatureGate } from './features/init.js';
import { getTableauServerInfo } from './getTableauServerInfo.js';
import { connectSessionStore } from './sessionStore/init.js';

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('combined entrypoint startup', () => {
  let processOnceSpy: { mockRestore(): void };
  let processExitSpy: { mockRestore(): void };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    startupState.activeFeatureGateProvider = 'server';
    startupState.providerAtWebToolRegistration = undefined;
    startupState.serverInfoPromise = Promise.resolve({});
    startupState.sessionStoreConnected = false;
    startupState.sessionStoreConnectedAtWebToolRegistration = undefined;
    startupState.sessionStoreDisconnected = false;
    startupState.shutdownHandlers.clear();
    startupState.resourcesRegistered = false;
    startupState.resourcesAvailableAtConnect = undefined;
    processOnceSpy = vi.spyOn(process, 'once').mockImplementation(((signal, listener) => {
      startupState.shutdownHandlers.set(String(signal), listener as () => Promise<void>);
      return process;
    }) as typeof process.once);
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    processOnceSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it('waits for Web readiness before registering and connecting the combined stdio server', async () => {
    const serverInfo = deferred<object>();
    startupState.serverInfoPromise = serverInfo.promise;

    await import('./index.combined.js');
    await vi.waitFor(() => expect(getTableauServerInfo).toHaveBeenCalledOnce());

    expect(initializeFeatureGate).toHaveBeenCalledOnce();
    expect(connectSessionStore).toHaveBeenCalledOnce();
    expect(McpServer).not.toHaveBeenCalled();

    serverInfo.resolve({});
    await vi.waitFor(() => expect(startupState.resourcesAvailableAtConnect).toBe(true));

    expect(startupState.providerAtWebToolRegistration).toBe('custom');
    expect(startupState.sessionStoreConnectedAtWebToolRegistration).toBe(true);
    expect(startupState.resourcesAvailableAtConnect).toBe(true);
    expect(processOnceSpy).toHaveBeenCalledTimes(2);
  });

  it('uses the shared shutdown handlers', async () => {
    await import('./index.combined.js');
    await vi.waitFor(() => expect(startupState.resourcesAvailableAtConnect).toBe(true));

    await startupState.shutdownHandlers.get('SIGTERM')!();

    expect(startupState.sessionStoreDisconnected).toBe(true);
    expect(processExitSpy).toHaveBeenCalledWith(0);
  });
});
