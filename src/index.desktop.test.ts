const startupState = vi.hoisted(() => ({
  profile: 'web' as 'desktop' | 'web',
  webConfigShouldThrow: false,
  connectPromise: Promise.resolve(),
  serverInfoPromise: Promise.resolve({}),
  sessionStoreConnected: false,
  sessionStoreDisconnected: false,
  connectedAtExpressStart: undefined as boolean | undefined,
  expressStarted: false,
  desktopConnected: false,
  shutdownHandlers: new Map<string, () => Promise<void>>(),
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
  getConfig: vi.fn(() => {
    if (startupState.webConfigShouldThrow) {
      throw new Error('Web config must not be constructed');
    }
    return {
      transport: 'http',
      server: 'https://tableau.example.com',
      oauth: { enabled: true },
      defaultNotificationLevel: 'info',
      loggers: new Set<string>(),
      fileLoggerDirectory: '/tmp',
      disableSessionManagement: false,
      disableLogMasking: false,
      breakGlassDisableGlobally: false,
    };
  }),
}));

vi.mock('./config.desktop.js', () => ({
  getDesktopConfig: vi.fn(() => ({
    defaultNotificationLevel: 'info',
    loggers: new Set<string>(),
    fileLoggerDirectory: '/tmp',
  })),
}));

vi.mock('./features/init.js', () => ({
  initializeFeatureGate: vi.fn(),
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

vi.mock('./server.desktop.js', () => ({
  DesktopMcpServer: vi.fn(function () {
    return {
      name: 'tableau-desktop-mcp',
      version: 'test',
      registerTools: vi.fn(async () => undefined),
      registerResources: vi.fn(async () => undefined),
      mcpServer: {
        server: { setRequestHandler: vi.fn() },
        connect: vi.fn(async () => {
          startupState.desktopConnected = true;
        }),
      },
    };
  }),
}));

vi.mock('./server/express.js', () => ({
  startExpressServer: vi.fn(async () => {
    startupState.connectedAtExpressStart = startupState.sessionStoreConnected;
    startupState.expressStarted = true;
    return { url: 'http://localhost:3927/tableau-mcp' };
  }),
}));

vi.mock('./sessionStore/init.js', () => ({
  initializeSessionStore: vi.fn(),
  connectSessionStore: vi.fn(async () => {
    await startupState.connectPromise;
    startupState.sessionStoreConnected = true;
  }),
  disconnectSessionStore: vi.fn(async () => {
    startupState.sessionStoreDisconnected = true;
  }),
}));

vi.mock('./transportProfile.js', () => ({
  resolveTransportProfile: vi.fn(() => startupState.profile),
}));

import { getDesktopConfig } from './config.desktop.js';
import { getConfig } from './config.js';
import { initializeFeatureGate } from './features/init.js';
import { getTableauServerInfo } from './getTableauServerInfo.js';
import { startExpressServer } from './server/express.js';
import { connectSessionStore, initializeSessionStore } from './sessionStore/init.js';

function deferred<T>(): { promise: Promise<T>; reject: (reason?: unknown) => void } {
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((_resolve, rejectPromise) => {
    reject = rejectPromise;
  });
  return { promise, reject };
}

describe('desktop binary startup', () => {
  let processOnceSpy: { mockRestore(): void };
  let processExitSpy: { mockRestore(): void };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    startupState.profile = 'web';
    startupState.webConfigShouldThrow = false;
    startupState.connectPromise = Promise.resolve();
    startupState.serverInfoPromise = Promise.resolve({});
    startupState.sessionStoreConnected = false;
    startupState.sessionStoreDisconnected = false;
    startupState.connectedAtExpressStart = undefined;
    startupState.expressStarted = false;
    startupState.desktopConnected = false;
    startupState.shutdownHandlers.clear();
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

  it('connects the Web store before opening HTTP and installs one handler per signal', async () => {
    await import('./index.desktop.js');
    await vi.waitFor(() => expect(startupState.expressStarted).toBe(true));

    expect(startupState.connectedAtExpressStart).toBe(true);
    expect(initializeFeatureGate).toHaveBeenCalledOnce();
    expect(initializeSessionStore).toHaveBeenCalledOnce();
    expect(getTableauServerInfo).toHaveBeenCalledOnce();
    expect(processOnceSpy).toHaveBeenCalledTimes(2);
    expect(startupState.shutdownHandlers.size).toBe(2);

    await startupState.shutdownHandlers.get('SIGINT')!();
    expect(startupState.sessionStoreDisconnected).toBe(true);
    expect(processExitSpy).toHaveBeenCalledWith(0);
  });

  it('fails closed before opening HTTP when the session store cannot connect', async () => {
    const connect = deferred<void>();
    startupState.connectPromise = connect.promise;

    await import('./index.desktop.js');
    await vi.waitFor(() => expect(connectSessionStore).toHaveBeenCalledOnce());
    connect.reject(new Error('session store init failed'));
    await vi.waitFor(() => expect(processExitSpy).toHaveBeenCalledWith(1));

    expect(startExpressServer).not.toHaveBeenCalled();
    expect(getTableauServerInfo).not.toHaveBeenCalled();
  });

  it('starts Desktop stdio without constructing or initializing the Web runtime', async () => {
    startupState.profile = 'desktop';
    startupState.webConfigShouldThrow = true;

    await import('./index.desktop.js');
    await vi.waitFor(() => expect(startupState.desktopConnected).toBe(true));

    expect(getDesktopConfig).toHaveBeenCalledOnce();
    expect(getConfig).not.toHaveBeenCalled();
    expect(initializeFeatureGate).not.toHaveBeenCalled();
    expect(initializeSessionStore).not.toHaveBeenCalled();
    expect(getTableauServerInfo).not.toHaveBeenCalled();
    expect(startExpressServer).not.toHaveBeenCalled();
    expect(processOnceSpy).not.toHaveBeenCalled();
    expect(processExitSpy).not.toHaveBeenCalled();
  });
});
