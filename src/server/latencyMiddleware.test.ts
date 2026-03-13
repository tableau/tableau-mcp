import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { EventEmitter } from 'events';

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
  });

  it('should record duration on response finish', () => {
    const middleware = latencyMiddleware(provider);
    const req = { method: 'POST', path: '/tableau-mcp', auth: validAuth };
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

  it('should include tool_name when request body contains a tool call', () => {
    const middleware = latencyMiddleware(provider);
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
    const middleware = latencyMiddleware(provider);
    const req = { method: 'GET', path: '/tableau-mcp', auth: validAuth };
    const res = Object.assign(new EventEmitter(), { statusCode: 200 });
    const next = vi.fn();

    middleware(req as AuthenticatedRequest, res as any, next);
    res.emit('finish');

    const durationMs = (provider.recordHistogram as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(durationMs).toBeGreaterThanOrEqual(0);
  });
});
