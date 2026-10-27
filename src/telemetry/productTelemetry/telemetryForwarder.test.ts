import os from 'os';

import { log } from '../../logging/logger.js';
import { getTelemetryProvider } from '../init.js';
import { DEFAULT_PRODUCT_TELEMETRY_ENDPOINT } from './telemetryEndpoint.js';
import {
  exportedForTesting,
  getProductTelemetry,
  resolveTelemetryEnv,
  TableauTelemetryJsonEvent,
} from './telemetryForwarder.js';

vi.mock('../init.js', () => ({
  getTelemetryProvider: vi.fn(),
}));
vi.mock('../../logging/logger.js', () => ({ log: vi.fn() }));

describe('DirectTelemetryForwarder', () => {
  const endpoint = 'https://qa.telemetry.tableausoftware.com';
  const server = 'https://test-server.example.com';

  const mockFetch = vi.fn();

  beforeEach(() => {
    exportedForTesting.resetProductTelemetry();
    vi.unstubAllEnvs();
    vi.stubEnv('PRODUCT_TELEMETRY_ENABLED', 'true');
    vi.stubEnv('PRODUCT_TELEMETRY_ENDPOINT', endpoint);
    vi.stubEnv('SERVER', server);
    mockFetch.mockImplementation(() => {
      return Promise.resolve(new Response('', { status: 200 }));
    });
    vi.stubGlobal('fetch', mockFetch);
    vi.mocked(getTelemetryProvider).mockReturnValue({
      initialize: vi.fn(),
      recordMetric: vi.fn(),
      recordHistogram: vi.fn(),
      startSpan: vi.fn().mockReturnValue({ end: vi.fn() }),
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  async function sentEvent(callIndex = 0): Promise<TableauTelemetryJsonEvent> {
    const request = mockFetch.mock.calls[callIndex][0] as Request;
    const body = (await request.clone().json()) as TableauTelemetryJsonEvent[];
    return body[0];
  }

  describe('resolveTelemetryEnv', () => {
    it('reads endpoint, enabled, pod, and is_hyperforce from env', () => {
      vi.stubEnv('PRODUCT_TELEMETRY_ENABLED', 'true');
      vi.stubEnv('IS_HYPERFORCE', 'true');
      expect(resolveTelemetryEnv()).toEqual({
        endpoint,
        enabled: true,
        pod: server,
        isHyperforce: true,
      });
    });

    it('defaults the endpoint and enables telemetry when env is unset', () => {
      vi.stubEnv('PRODUCT_TELEMETRY_ENABLED', '');
      vi.stubEnv('PRODUCT_TELEMETRY_ENDPOINT', '');
      vi.stubEnv('SERVER', '');
      expect(resolveTelemetryEnv()).toEqual({
        endpoint: DEFAULT_PRODUCT_TELEMETRY_ENDPOINT,
        enabled: true,
        pod: '',
        isHyperforce: false,
      });
    });

    it('disables telemetry only when PRODUCT_TELEMETRY_ENABLED is exactly "false"', () => {
      vi.stubEnv('PRODUCT_TELEMETRY_ENABLED', 'false');
      expect(resolveTelemetryEnv().enabled).toBe(false);
    });

    it('coalesces the pod from SERVER (web) or TABLEAU_POD_NAME (desktop)', () => {
      vi.stubEnv('SERVER', '');
      vi.stubEnv('TABLEAU_POD_NAME', 'desktop-pod');
      expect(resolveTelemetryEnv().pod).toBe('desktop-pod');

      vi.stubEnv('SERVER', server);
      // SERVER wins when both are set; a process only ever populates one.
      expect(resolveTelemetryEnv().pod).toBe(server);
    });
  });

  it('throws error when endpoint is empty', () => {
    expect(
      () =>
        new exportedForTesting.DirectTelemetryForwarder({
          endpoint: '',
          enabled: true,
          pod: server,
          isHyperforce: false,
        }),
    ).toThrowError('Endpoint URL is required for DirectTelemetryForwarder');
  });

  it('sends telemetry with PUT method by default', async () => {
    const forwarder = getProductTelemetry();
    forwarder.send('tool_call', { action: 'click', count: 42 });

    expect(mockFetch).toHaveBeenCalledTimes(1);

    const request = mockFetch.mock.calls[0][0] as Request;
    expect(request.method).toBe('PUT');
    expect(request.url).toContain(endpoint);
    expect(request.headers.get('Content-Type')).toBe('application/json');
    expect(request.headers.get('Accept')).toBe('application/json');

    const event = await sentEvent();
    expect(event).toEqual(
      expect.objectContaining({
        type: 'tool_call',
        service_name: 'tableau-mcp',
        // podname + is_hyperforce are stamped by the forwarder from resolved env.
        properties: { action: 'click', count: 42, podname: server, is_hyperforce: false },
        pod: server,
        host_name: expect.any(String),
        host_timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/),
      }),
    );
  });

  it('stamps every event with the resolved pod and is_hyperforce', async () => {
    vi.stubEnv('IS_HYPERFORCE', 'true');
    const forwarder = getProductTelemetry();
    forwarder.send('tool_call', { foo: 'bar' });

    const event = await sentEvent();
    expect(event.pod).toBe(server);
    expect(event.properties.podname).toBe(server);
    expect(event.properties.is_hyperforce).toBe(true);
    expect(event.host_name).toBeDefined();
  });

  it('stamps host_name with os.hostname() by default (web)', async () => {
    vi.spyOn(os, 'hostname').mockReturnValue('sentinel-host');
    getProductTelemetry().send('tool_call', { foo: 'bar' });

    expect((await sentEvent()).host_name).toBe('sentinel-host');
  });

  it('omits host_name and never reads os.hostname() when includeHostName is false (desktop)', async () => {
    const hostnameSpy = vi.spyOn(os, 'hostname').mockReturnValue('sentinel-host');
    getProductTelemetry().send('tool_call', { foo: 'bar' }, { includeHostName: false });

    const request = mockFetch.mock.calls[0][0] as Request;
    expect(await request.clone().text()).not.toContain('sentinel-host');
    expect(hostnameSpy).not.toHaveBeenCalled();

    const event = await sentEvent();
    expect(event).not.toHaveProperty('host_name');
    expect(event).toEqual({
      type: 'tool_call',
      service_name: 'tableau-mcp',
      pod: server,
      properties: { foo: 'bar', podname: server, is_hyperforce: false },
      host_timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/),
    });
  });

  it('uses default service_name', async () => {
    getProductTelemetry().send('tool_call', { foo: 'bar' });
    expect((await sentEvent()).service_name).toBe('tableau-mcp');
  });

  it('does not send telemetry when enabled is false', () => {
    vi.stubEnv('PRODUCT_TELEMETRY_ENABLED', 'false');
    getProductTelemetry().send('tool_call', { foo: 'bar' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('reuses the one shared forwarder', () => {
    expect(getProductTelemetry()).toBe(getProductTelemetry());
  });

  // The combined build registers both web and desktop tools in one process, but a deployment only
  // populates one variant's env. The first tool to fire freezes the singleton from resolved env —
  // which reads the same process env regardless of which tool it is — so when a web deployment is
  // set up (SERVER + web endpoint, no TABLEAU_POD_NAME), a desktop tool calling first still yields
  // the web pod, and the later web tool reuses it. No per-tool config leaks in.
  it('builds the shared forwarder from env, so a desktop-first call still reports the web pod', async () => {
    // Web deployment env (set in beforeEach): SERVER=server, no TABLEAU_POD_NAME.
    const desktopFirst = getProductTelemetry(); // simulates a desktop tool firing first
    const webSecond = getProductTelemetry(); // a web tool firing after

    expect(webSecond).toBe(desktopFirst);

    desktopFirst.send('tool_call', { from: 'desktop' });
    webSecond.send('tool_call', { from: 'web' });

    expect((await sentEvent(0)).pod).toBe(server);
    expect((await sentEvent(1)).pod).toBe(server);
  });

  it('does not throw when the endpoint is invalid', () => {
    const forwarder = new exportedForTesting.DirectTelemetryForwarder({
      endpoint: 'not-a-valid-url',
      enabled: true,
      pod: server,
      isHyperforce: false,
    });

    expect(() => forwarder.send('tool_call', { foo: 'bar' })).not.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('treats an endpoint with credentials as invalid, since Request rejects it', () => {
    vi.mocked(log).mockClear();
    const forwarder = new exportedForTesting.DirectTelemetryForwarder({
      endpoint: 'https://user:pass@telemetry.example.com',
      enabled: true,
      pod: server,
      isHyperforce: false,
    });

    forwarder.send('tool_call', { n: 1 });
    forwarder.send('tool_call', { n: 2 });

    expect(log).toHaveBeenCalledTimes(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('logs a bad endpoint once, not on every send', () => {
    vi.mocked(log).mockClear();
    const forwarder = new exportedForTesting.DirectTelemetryForwarder({
      endpoint: 'not-a-valid-url',
      enabled: true,
      pod: server,
      isHyperforce: false,
    });

    forwarder.send('tool_call', { n: 1 });
    forwarder.send('tool_call', { n: 2 });
    forwarder.send('tool_call', { n: 3 });

    expect(log).toHaveBeenCalledTimes(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('starts and ends a span around the outbound telemetry fetch on success', async () => {
    const mockSpan = { end: vi.fn() };
    const mockProvider = {
      initialize: vi.fn(),
      recordMetric: vi.fn(),
      recordHistogram: vi.fn(),
      startSpan: vi.fn().mockReturnValue(mockSpan),
    };
    vi.mocked(getTelemetryProvider).mockReturnValue(mockProvider);

    const forwarder = getProductTelemetry(endpoint, true, podName);
    forwarder.send('tool_call', { foo: 'bar' });

    // sendTelemetryRequest is fire-and-forget from send()'s perspective; flush microtasks.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockProvider.startSpan).toHaveBeenCalledWith(
      'tableau.telemetry.forward',
      expect.objectContaining({ url: expect.stringContaining(endpoint) }),
    );
    expect(mockSpan.end).toHaveBeenCalledWith(undefined);
  });

  it('ends the span with the error when the outbound telemetry fetch throws', async () => {
    const mockSpan = { end: vi.fn() };
    const mockProvider = {
      initialize: vi.fn(),
      recordMetric: vi.fn(),
      recordHistogram: vi.fn(),
      startSpan: vi.fn().mockReturnValue(mockSpan),
    };
    vi.mocked(getTelemetryProvider).mockReturnValue(mockProvider);

    const fetchError = new Error('network error');
    mockFetch.mockRejectedValueOnce(fetchError);

    const forwarder = getProductTelemetry(endpoint, true, podName);
    forwarder.send('tool_call', { foo: 'bar' });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockSpan.end).toHaveBeenCalledWith(fetchError);
  });
});
