import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DirectTelemetryForwarder } from './telemetryForwarder.js';

describe('DirectTelemetryForwarder', () => {
  const endpoint = 'https://qa.telemetry.tableausoftware.com';
  let originalFetch: typeof fetch;
  let captured: Request[];

  beforeEach(() => {
    captured = [];
    originalFetch = globalThis.fetch;

    globalThis.fetch = vi.fn((req: Request) => {
      captured.push(req);
      return Promise.resolve(new Response('', { status: 200 }));
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('throws error when endpoint is empty', () => {
    expect(() => new DirectTelemetryForwarder('')).toThrowError(
      'Endpoint URL is required for DirectTelemetryForwarder',
    );
  });

  it('sends telemetry with PUT method by default', async () => {
    const eventType = 'test_event';
    const serviceName = 'test_service';
    const properties = { action: 'click', count: 42 };

    const forwarder = new DirectTelemetryForwarder(endpoint);
    forwarder.send(eventType, serviceName, properties);

    expect(captured.length).toBe(1);
    const req = captured[0];

    expect(req.method).toBe('PUT');
    expect(req.url).toContain(endpoint);
    expect(req.credentials).toBe('omit');
    expect(req.headers.get('Content-Type')).toBe('application/json');
    expect(req.headers.get('Accept')).toBe('application/json');

    const body = await req.clone().json();

    expect(body).toEqual([
      expect.objectContaining({
        type: eventType,
        service_name: serviceName,
        properties,
        pod: expect.any(String),
        host_name: expect.any(String),
        host_timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3} \+0000$/),
      }),
    ]);
  });

  it('can override HTTP method to POST', async () => {
    const forwarder = new DirectTelemetryForwarder(endpoint, { httpMethod: 'POST' });
    forwarder.send('event', 'service', { foo: 'bar' });

    expect(captured.length).toBe(1);
    expect(captured[0].method).toBe('POST');
  });

  it('can override pod and hostName', async () => {
    const customPod = 'my-custom-pod';
    const customHostName = 'my-custom-host';

    const forwarder = new DirectTelemetryForwarder(endpoint, {
      pod: customPod,
      hostName: customHostName,
    });
    forwarder.send('event', 'service', { foo: 'bar' });

    expect(captured.length).toBe(1);
    const body = await captured[0].clone().json();

    expect(body[0].pod).toBe(customPod);
    expect(body[0].host_name).toBe(customHostName);
  });
});
