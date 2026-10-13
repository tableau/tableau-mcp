import {
  DEFAULT_PRODUCT_TELEMETRY_ENDPOINT,
  exportedForTesting,
  getProductTelemetry,
  resolveTelemetryEnv,
  TableauTelemetryJsonEvent,
} from './telemetryForwarder.js';

describe('DirectTelemetryForwarder', () => {
  const endpoint = 'https://qa.telemetry.tableausoftware.com';
  const server = 'https://test-server.example.com';

  const mockFetch = vi.fn();

  beforeEach(() => {
    exportedForTesting.resetProductTelemetry();
    vi.unstubAllEnvs();
    vi.stubEnv('PRODUCT_TELEMETRY_ENDPOINT', endpoint);
    vi.stubEnv('SERVER', server);
    mockFetch.mockImplementation(() => {
      return Promise.resolve(new Response('', { status: 200 }));
    });
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
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

  it('does not throw when request construction fails synchronously', () => {
    const forwarder = new exportedForTesting.DirectTelemetryForwarder({
      endpoint: 'not-a-valid-url',
      enabled: true,
      pod: server,
      isHyperforce: false,
    });

    expect(() => forwarder.send('tool_call', { foo: 'bar' })).not.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
