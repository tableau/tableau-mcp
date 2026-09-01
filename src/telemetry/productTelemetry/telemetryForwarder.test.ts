import { getTelemetryProvider } from '../init.js';
import {
  exportedForTesting,
  getProductTelemetry,
  TableauTelemetryJsonEvent,
} from './telemetryForwarder.js';

vi.mock('../init.js', () => ({
  getTelemetryProvider: vi.fn(),
}));

describe('DirectTelemetryForwarder', () => {
  const endpoint = 'https://qa.telemetry.tableausoftware.com';
  const podName = 'https://test-server.example.com';

  const mockFetch = vi.fn();

  beforeEach(() => {
    exportedForTesting.resetProductTelemetry();
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
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('throws error when endpoint is empty', () => {
    expect(() => getProductTelemetry('', true, podName)).toThrowError(
      'Endpoint URL is required for DirectTelemetryForwarder',
    );
  });

  it('sends telemetry with PUT method by default', async () => {
    const properties = { action: 'click', count: 42 };

    const forwarder = getProductTelemetry(endpoint, true, podName);
    forwarder.send('tool_call', properties);

    expect(mockFetch).toHaveBeenCalledTimes(1);

    const request = mockFetch.mock.calls[0][0] as Request;
    expect(request.method).toBe('PUT');
    expect(request.url).toContain(endpoint);
    expect(request.headers.get('Content-Type')).toBe('application/json');
    expect(request.headers.get('Accept')).toBe('application/json');

    const body = (await request.clone().json()) as TableauTelemetryJsonEvent[];

    expect(body).toHaveLength(1);
    expect(body[0]).toEqual(
      expect.objectContaining({
        type: 'tool_call',
        service_name: 'tableau-mcp',
        properties,
        pod: podName,
        host_name: expect.any(String),
        host_timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/),
      }),
    );
  });

  it('uses provided podName for pod field', async () => {
    const forwarder = getProductTelemetry(endpoint, true, podName);
    forwarder.send('tool_call', { foo: 'bar' });

    expect(mockFetch).toHaveBeenCalledTimes(1);

    const request = mockFetch.mock.calls[0][0] as Request;
    const body = (await request.clone().json()) as TableauTelemetryJsonEvent[];

    expect(body[0].pod).toBe(podName);
    // host_name comes from os.hostname()
    expect(body[0].host_name).toBeDefined();
  });

  it('uses default service_name', async () => {
    const forwarder = getProductTelemetry(endpoint, true, podName);
    forwarder.send('tool_call', { foo: 'bar' });

    expect(mockFetch).toHaveBeenCalledTimes(1);

    const request = mockFetch.mock.calls[0][0] as Request;
    const body = (await request.clone().json()) as TableauTelemetryJsonEvent[];

    expect(body[0].service_name).toBe('tableau-mcp');
  });

  it('does not send telemetry when enabled is false', () => {
    const forwarder = getProductTelemetry(endpoint, false, podName);
    forwarder.send('tool_call', { foo: 'bar' });

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
