const startupState = vi.hoisted(() => ({
  transport: 'http' as 'http' | 'stdio',
  connectPromise: Promise.resolve(),
  serverInfoPromise: Promise.resolve({}),
  expressPromise: Promise.resolve({ url: 'http://localhost:3927/tableau-mcp' }),
  events: [] as string[],
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
    transport: startupState.transport,
    server: 'https://tableau.example.com',
    auth: 'pat',
    oauth: { enabled: true },
    defaultNotificationLevel: 'info',
    loggers: new Set<string>(),
    fileLoggerDirectory: '/tmp',
    disableSessionManagement: false,
    disableLogMasking: false,
    breakGlassDisableGlobally: false,
  })),
}));

vi.mock('./features/init.js', () => ({
  initializeFeatureGate: vi.fn(() => {
    startupState.events.push('feature gate');
  }),
}));

vi.mock('./getTableauServerInfo.js', () => ({
  getTableauServerInfo: vi.fn(() => {
    startupState.events.push('server info');
    return startupState.serverInfoPromise;
  }),
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
  WebMcpServer: vi.fn(function () {
    return {
      name: 'tableau-mcp',
      version: 'test',
      registerTools: vi.fn(async () => {
        startupState.events.push('tools registered');
      }),
      mcpServer: {
        server: { setRequestHandler: vi.fn() },
        connect: vi.fn(async () => {
          startupState.events.push('stdio connected');
        }),
      },
    };
  }),
}));

vi.mock('./server/express.js', () => ({
  startExpressServer: vi.fn(() => {
    startupState.events.push('http opened');
    return startupState.expressPromise;
  }),
}));

vi.mock('./sessionStore/init.js', () => ({
  initializeSessionStore: vi.fn(() => {
    startupState.events.push('session store init');
  }),
  connectSessionStore: vi.fn(() => {
    startupState.events.push('session store connected');
    return startupState.connectPromise;
  }),
  disconnectSessionStore: vi.fn(async () => undefined),
}));

import { getTableauServerInfo } from './getTableauServerInfo.js';
import { log } from './logging/logger.js';
import { WebMcpServer } from './server.web.js';
import { startExpressServer } from './server/express.js';

function deferred<T>(): {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe('default entrypoint startup', () => {
  let processOnceSpy: { mockRestore(): void };
  let processExitSpy: { mockRestore(): void };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    startupState.transport = 'http';
    startupState.connectPromise = Promise.resolve();
    startupState.serverInfoPromise = Promise.resolve({});
    startupState.expressPromise = Promise.resolve({
      url: 'http://localhost:3927/tableau-mcp',
    });
    startupState.events = [];
    processOnceSpy = vi
      .spyOn(process, 'once')
      .mockImplementation((() => process) as typeof process.once);
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    processOnceSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it('opens HTTP after store connection and before server-info readiness', async () => {
    const serverInfo = deferred<object>();
    startupState.serverInfoPromise = serverInfo.promise;

    await import('./index.js');
    await vi.waitFor(() => expect(startExpressServer).toHaveBeenCalledOnce());

    expect(startupState.events).toEqual([
      'feature gate',
      'session store init',
      'session store connected',
      'server info',
      'http opened',
    ]);
    expect(log).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('server available at') }),
    );

    serverInfo.resolve({});
    await vi.waitFor(() =>
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('server available at') }),
      ),
    );
  });

  it('handles server-info failure while HTTP startup is still pending', async () => {
    const serverInfo = deferred<object>();
    const express = deferred<{ url: string }>();
    startupState.serverInfoPromise = serverInfo.promise;
    startupState.expressPromise = express.promise;

    await import('./index.js');
    await vi.waitFor(() => expect(startExpressServer).toHaveBeenCalledOnce());

    serverInfo.reject(new Error('server info failed'));
    await vi.waitFor(() => expect(processExitSpy).toHaveBeenCalledWith(1));

    express.resolve({ url: 'http://localhost:3927/tableau-mcp' });
    await vi.waitFor(() =>
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('server available at') }),
      ),
    );
  });

  it('waits for server info before connecting stdio', async () => {
    const serverInfo = deferred<object>();
    startupState.transport = 'stdio';
    startupState.serverInfoPromise = serverInfo.promise;

    await import('./index.js');
    await vi.waitFor(() => expect(getTableauServerInfo).toHaveBeenCalledOnce());

    expect(WebMcpServer).not.toHaveBeenCalled();
    expect(startupState.events).not.toContain('stdio connected');

    serverInfo.resolve({});
    await vi.waitFor(() => expect(startupState.events).toContain('stdio connected'));
    expect(startExpressServer).not.toHaveBeenCalled();
  });
});
