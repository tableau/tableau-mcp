import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { EventEmitter } from 'events';

import { TelemetryProvider } from '../telemetry/types.js';
import { latencyMiddleware } from './latencyMiddleware.js';
import { AuthenticatedRequest } from './oauth/types.js';

describe('latencyMiddleware', () => {
  const metricName = 'apm_http_server_request_duration';
  const provider: TelemetryProvider = {
    initialize: vi.fn(),
    recordMetric: vi.fn(),
    recordHistogram: vi.fn(),
  };

  it('should record duration on response finish', () => {
    const middleware = latencyMiddleware(provider);
    const req = { method: 'POST', path: '/tableau-mcp' };
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
      }),
    );
  });

  it('should include tool_name when request body contains a tool call', () => {
    const middleware = latencyMiddleware(provider);
    const req = {
      method: 'POST',
      path: '/tableau-mcp',
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
      }),
    );
  });

  it('should include auth attributes when req.auth is present', () => {
    const middleware = latencyMiddleware(provider);
    const auth: AuthInfo = {
      token: 'test',
      clientId: 'test',
      scopes: [],
      extra: {
        server: 'https://my-server.com',
        siteId: 'site-123',
      },
    };
    const req = { method: 'POST', path: '/tableau-mcp', auth };
    const res = Object.assign(new EventEmitter(), { statusCode: 200 });
    const next = vi.fn();

    middleware(req as AuthenticatedRequest, res as any, next);
    res.emit('finish');

    expect(provider.recordHistogram).toHaveBeenCalledWith(
      metricName,
      expect.any(Number),
      expect.objectContaining({
        server: 'https://my-server.com',
        site_id: 'site-123',
      }),
    );
  });

  it('should record a non-negative duration', () => {
    const middleware = latencyMiddleware(provider);
    const req = { method: 'GET', path: '/tableau-mcp' };
    const res = Object.assign(new EventEmitter(), { statusCode: 200 });
    const next = vi.fn();

    middleware(req as any, res as any, next);
    res.emit('finish');

    const durationMs = (provider.recordHistogram as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(durationMs).toBeGreaterThanOrEqual(0);
  });
});
