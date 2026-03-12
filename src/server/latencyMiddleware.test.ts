import { EventEmitter } from 'events';

import { TelemetryProvider } from '../telemetry/types.js';
import { latencyMiddleware } from './latencyMiddleware.js';
import { AuthenticatedRequest } from './oauth/types.js';

function createMockProvider(): TelemetryProvider {
  return {
    initialize: vi.fn(),
    recordMetric: vi.fn(),
    recordHistogram: vi.fn(),
  };
}

function createMockReqRes(overrides: {
  method?: string;
  path?: string;
  body?: unknown;
  auth?: AuthenticatedRequest['auth'];
  statusCode?: number;
}): {
  req: AuthenticatedRequest;
  res: EventEmitter & { statusCode: number; route?: { path: string } };
} {
  const req = {
    method: overrides.method ?? 'POST',
    path: overrides.path ?? '/tableau-mcp',
    body: overrides.body,
    auth: overrides.auth,
  } as AuthenticatedRequest;

  const res = Object.assign(new EventEmitter(), {
    statusCode: overrides.statusCode ?? 200,
  });

  return { req, res };
}

describe('latencyMiddleware', () => {
  it('should record http.server.request.duration on response finish', () => {
    const provider = createMockProvider();
    const middleware = latencyMiddleware(() => provider);

    const { req, res } = createMockReqRes({ method: 'POST', statusCode: 200 });
    const next = vi.fn();

    middleware(req, res as any, next);
    expect(next).toHaveBeenCalled();

    res.emit('finish');

    expect(provider.recordHistogram).toHaveBeenCalledWith(
      'http.server.request.duration',
      expect.any(Number),
      expect.objectContaining({
        'http.request.method': 'POST',
        'http.response.status_code': 200,
      }),
    );
  });

  it('should include tool_name when request body contains a tool call', () => {
    const provider = createMockProvider();
    const middleware = latencyMiddleware(() => provider);

    const { req, res } = createMockReqRes({
      body: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'get-datasource-metadata', arguments: {} },
      },
    });
    const next = vi.fn();

    middleware(req, res as any, next);
    res.emit('finish');

    expect(provider.recordHistogram).toHaveBeenCalledWith(
      'http.server.request.duration',
      expect.any(Number),
      expect.objectContaining({
        tool_name: 'get-datasource-metadata',
      }),
    );
  });

  it('should set tool_name to undefined when body has no tool call', () => {
    const provider = createMockProvider();
    const middleware = latencyMiddleware(() => provider);

    const { req, res } = createMockReqRes({
      body: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0' },
        },
      },
    });
    const next = vi.fn();

    middleware(req, res as any, next);
    res.emit('finish');

    expect(provider.recordHistogram).toHaveBeenCalledWith(
      'http.server.request.duration',
      expect.any(Number),
      expect.objectContaining({
        tool_name: undefined,
      }),
    );
  });

  it('should include auth attributes when req.auth is present', () => {
    const provider = createMockProvider();
    const middleware = latencyMiddleware(() => provider);

    const { req, res } = createMockReqRes({
      auth: {
        token: 'test',
        clientId: 'test',
        scopes: [],
        extra: {
          server: 'https://my-server.com',
          siteId: 'site-123',
          userId: 'user-456',
        },
      },
    });
    const next = vi.fn();

    middleware(req, res as any, next);
    res.emit('finish');

    expect(provider.recordHistogram).toHaveBeenCalledWith(
      'http.server.request.duration',
      expect.any(Number),
      expect.objectContaining({
        server: 'https://my-server.com',
        site_id: 'site-123',
        user_id: 'user-456',
      }),
    );
  });

  it('should record a non-negative duration', () => {
    const provider = createMockProvider();
    const middleware = latencyMiddleware(() => provider);

    const { req, res } = createMockReqRes({});
    const next = vi.fn();

    middleware(req, res as any, next);
    res.emit('finish');

    const durationMs = (provider.recordHistogram as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(durationMs).toBeGreaterThanOrEqual(0);
  });
});
