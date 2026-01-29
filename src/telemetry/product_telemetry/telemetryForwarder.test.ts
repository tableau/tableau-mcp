import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DirectTelemetryForwarder, TableauTelemetryJsonEvent } from './telemetryForwarder.js';

describe('DirectTelemetryForwarder', () => {
  const endpoint = 'https://qa.telemetry.tableausoftware.com';

  const mockFetch = vi.fn();

  beforeEach(() => {
    mockFetch.mockImplementation(() => {
      return Promise.resolve(new Response('', { status: 200 }));
    });
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('throws error when endpoint is empty', () => {
    expect(() => new DirectTelemetryForwarder('')).toThrowError(
      'Endpoint URL is required for DirectTelemetryForwarder',
    );
  });

  it('sends telemetry with PUT method by default', async () => {
    const eventType = 'test_event';
    const properties = { action: 'click', count: 42 };

    const forwarder = new DirectTelemetryForwarder(endpoint);
    forwarder.send(eventType, properties);

    expect(mockFetch).toHaveBeenCalledTimes(1);

    const request = mockFetch.mock.calls[0][0] as Request;
    expect(request.method).toBe('PUT');
    expect(request.url).toContain(endpoint);
    expect(request.credentials).toBe('omit');
    expect(request.headers.get('Content-Type')).toBe('application/json');
    expect(request.headers.get('Accept')).toBe('application/json');

    const body = (await request.clone().json()) as TableauTelemetryJsonEvent[];

    expect(body).toHaveLength(1);
    expect(body[0]).toEqual(
      expect.objectContaining({
        type: eventType,
        service_name: 'tableau-mcp',
        properties,
        pod: expect.any(String),
        host_name: expect.any(String),
        host_timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3} \+0000$/),
      }),
    );
  });

  it('can override HTTP method to POST', async () => {
    const forwarder = new DirectTelemetryForwarder(endpoint, { httpMethod: 'POST' });
    forwarder.send('event', { foo: 'bar' });

    expect(mockFetch).toHaveBeenCalledTimes(1);

    const request = mockFetch.mock.calls[0][0] as Request;
    expect(request.method).toBe('POST');
  });

  it('uses default pod and host_name from environment', async () => {
    const forwarder = new DirectTelemetryForwarder(endpoint);
    forwarder.send('event', { foo: 'bar' });

    expect(mockFetch).toHaveBeenCalledTimes(1);

    const request = mockFetch.mock.calls[0][0] as Request;
    const body = (await request.clone().json()) as TableauTelemetryJsonEvent[];

    // pod comes from POD_NAME env var or defaults to 'External'
    expect(body[0].pod).toBeDefined();
    // host_name comes from os.hostname()
    expect(body[0].host_name).toBeDefined();
  });

  it('uses default service_name', async () => {
    const forwarder = new DirectTelemetryForwarder(endpoint);
    forwarder.send('event', { foo: 'bar' });

    expect(mockFetch).toHaveBeenCalledTimes(1);

    const request = mockFetch.mock.calls[0][0] as Request;
    const body = (await request.clone().json()) as TableauTelemetryJsonEvent[];

    expect(body[0].service_name).toBe('tableau-mcp');
  });
});
