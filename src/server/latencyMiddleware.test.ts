import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { EventEmitter } from 'events';

import * as telemetryInit from '../telemetry/init.js';
import { TelemetryProvider } from '../telemetry/types.js';
import { latencyMiddleware } from './latencyMiddleware.js';
import { AuthenticatedRequest } from './oauth/types.js';

const validAuth: AuthInfo = {
  token: 'test',
  clientId: 'test',
  scopes: [],
  extra: {
    type: 'X-Tableau-Auth',
    username: 'user@example.com',
    server: 'https://my-server.com',
    siteId: 'site-123',
    userId: 'user-456',
  },
};

describe('latencyMiddleware', () => {
  const metricName = 'http_server_1agg1_request_duration';
  const provider: TelemetryProvider = {
    initialize: vi.fn(),
    recordMetric: vi.fn(),
    recordHistogram: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(telemetryInit, 'getTelemetryProvider').mockReturnValue(provider);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should record duration for tool call requests', () => {
    const middleware = latencyMiddleware();
    const req = {
      method: 'POST',
      path: '/tableau-mcp',
      auth: validAuth,
      body: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'list-datasources', arguments: {} },
      },
    };
    const res = Object.assign(new EventEmitter(), { statusCode: 200 });
    const next = vi.fn();

    middleware(req as AuthenticatedRequest, res as any, next);
    res.emit('finish');

    expect(next).toHaveBeenCalled();
    expect(provider.recordHistogram).toHaveBeenCalledWith(
      metricName,
      expect.any(Number),
      expect.objectContaining({
        'http.request.method': 'POST',
        'http.response.status_code': 200,
        site_id: 'site-123',
      }),
    );
  });

  it('should not record duration for non-tool-call requests', () => {
    const middleware = latencyMiddleware();
    const req = {
      method: 'POST',
      path: '/tableau-mcp',
      auth: validAuth,
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
    };
    const res = Object.assign(new EventEmitter(), { statusCode: 200 });
    const next = vi.fn();

    middleware(req as AuthenticatedRequest, res as any, next);
    res.emit('finish');

    expect(next).toHaveBeenCalled();
    expect(provider.recordHistogram).not.toHaveBeenCalled();
  });

  it('should include tool_name when request body contains a tool call', () => {
    const middleware = latencyMiddleware();
    const req = {
      method: 'POST',
      path: '/tableau-mcp',
      auth: validAuth,
      body: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'get-datasource-metadata', arguments: {} },
      },
    };
    const res = Object.assign(new EventEmitter(), { statusCode: 200 });
    const next = vi.fn();

    middleware(req as AuthenticatedRequest, res as any, next);
    res.emit('finish');

    expect(provider.recordHistogram).toHaveBeenCalledWith(
      metricName,
      expect.any(Number),
      expect.objectContaining({
        tool_name: 'get-datasource-metadata',
        site_id: 'site-123',
      }),
    );
  });

  it('should record a non-negative duration', () => {
    const middleware = latencyMiddleware();
    const req = {
      method: 'POST',
      path: '/tableau-mcp',
      auth: validAuth,
      body: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'list-datasources', arguments: {} },
      },
    };
    const res = Object.assign(new EventEmitter(), { statusCode: 200 });
    const next = vi.fn();

    middleware(req as AuthenticatedRequest, res as any, next);
    res.emit('finish');

    const durationMs = (provider.recordHistogram as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should resolve the telemetry provider at request time, not at middleware creation time', () => {
    const lateProvider: TelemetryProvider = {
      initialize: vi.fn(),
      recordMetric: vi.fn(),
      recordHistogram: vi.fn(),
    };

    const middleware = latencyMiddleware();

    // Swap the provider after middleware is created
    vi.spyOn(telemetryInit, 'getTelemetryProvider').mockReturnValue(lateProvider);

    const req = {
      method: 'POST',
      path: '/tableau-mcp',
      auth: validAuth,
      body: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'list-datasources', arguments: {} },
      },
    };
    const res = Object.assign(new EventEmitter(), { statusCode: 200 });

    middleware(req as AuthenticatedRequest, res as any, vi.fn());
    res.emit('finish');

    expect(lateProvider.recordHistogram).toHaveBeenCalled();
    expect(provider.recordHistogram).not.toHaveBeenCalled();
  });
});
