const startupState = vi.hoisted(() => ({
  connectShouldReject: false,
  sessionStoreInitialized: false,
  sessionStoreConnected: false,
  sessionStoreDisconnected: false,
  connectedAtExpressStart: undefined as boolean | undefined,
  expressStarted: false,
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
  getConfig: vi.fn(() => ({
    transport: 'http',
    server: 'https://tableau.example.com',
    oauth: { enabled: true },
    defaultNotificationLevel: 'info',
    loggers: new Set<string>(),
    fileLoggerDirectory: '/tmp',
    disableSessionManagement: false,
    disableLogMasking: false,
    breakGlassDisableGlobally: false,
  })),
}));

vi.mock('./config.desktop.js', () => ({
  getDesktopConfig: vi.fn(),
}));

vi.mock('./features/init.js', () => ({
  initializeFeatureGate: vi.fn(),
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

vi.mock('./server.desktop.js', () => ({
  DesktopMcpServer: vi.fn(),
}));

vi.mock('./server/express.js', () => ({
  startExpressServer: vi.fn(async () => {
    startupState.connectedAtExpressStart = startupState.sessionStoreConnected;
    startupState.expressStarted = true;
    return { url: 'http://localhost:3927/tableau-mcp' };
  }),
}));

vi.mock('./sessionStore/init.js', () => ({
  initializeSessionStore: vi.fn(() => {
    startupState.sessionStoreInitialized = true;
  }),
  connectSessionStore: vi.fn(async () => {
    if (startupState.connectShouldReject) throw new Error('session store init failed');
    startupState.sessionStoreConnected = true;
  }),
  disconnectSessionStore: vi.fn(async () => {
    startupState.sessionStoreDisconnected = true;
  }),
}));

vi.mock('./transportProfile.js', () => ({
  resolveTransportProfile: vi.fn(() => 'web'),
}));

describe('desktop binary web-profile startup', () => {
  let processOnceSpy: { mockRestore(): void };
  let processExitSpy: { mockRestore(): void };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    startupState.connectShouldReject = false;
    startupState.sessionStoreInitialized = false;
    startupState.sessionStoreConnected = false;
    startupState.sessionStoreDisconnected = false;
    startupState.connectedAtExpressStart = undefined;
    startupState.expressStarted = false;
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

  it('connects before opening HTTP and closes the store on shutdown', async () => {
    await import('./index.desktop.js');
    await vi.waitFor(() => expect(startupState.expressStarted).toBe(true));

    expect(startupState.sessionStoreInitialized).toBe(true);
    expect(startupState.connectedAtExpressStart).toBe(true);

    const shutdown = startupState.shutdownHandlers.get('SIGINT');
    expect(shutdown).toBeDefined();
    await shutdown!();
    expect(startupState.sessionStoreDisconnected).toBe(true);
    expect(processExitSpy).toHaveBeenCalledWith(0);
  });

  it('fails closed before opening HTTP when the session store cannot connect', async () => {
    startupState.connectShouldReject = true;

    await import('./index.desktop.js');
    await vi.waitFor(() => expect(processExitSpy).toHaveBeenCalledWith(1));

    expect(startupState.sessionStoreInitialized).toBe(true);
    expect(startupState.expressStarted).toBe(false);
  });
});
