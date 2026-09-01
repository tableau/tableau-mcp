import { getTelemetryProvider } from '../../telemetry/init.js';
import { axios } from '../../utils/axios.js';
import { getClientFromMetadataDoc, getOAuthRedirectUrl } from './authorize.js';

vi.mock('../../telemetry/init.js', () => ({
  getTelemetryProvider: vi.fn(),
}));

vi.mock('ssrfcheck', () => ({
  isSSRFSafeURL: vi.fn().mockReturnValue(true),
}));

vi.mock('../../utils/axios.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/axios.js')>();
  return {
    ...actual,
    axios: { create: vi.fn() },
  };
});

describe('getOAuthRedirectUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the initial URL unchanged when the site is locked, without starting a span', async () => {
    const mockProvider = {
      initialize: vi.fn(),
      recordMetric: vi.fn(),
      recordHistogram: vi.fn(),
      startSpan: vi.fn(),
    };
    vi.mocked(getTelemetryProvider).mockReturnValue(mockProvider);

    const initialUrl = new URL('https://my-tableau-server.com/oauth2/v1/auth');
    const result = await getOAuthRedirectUrl(initialUrl, { lockSite: true });

    expect(result).toBe(initialUrl);
    expect(mockProvider.startSpan).not.toHaveBeenCalled();
  });

  it('starts and ends a span around the redirect-follow fetch on success', async () => {
    const mockSpan = { end: vi.fn() };
    const mockProvider = {
      initialize: vi.fn(),
      recordMetric: vi.fn(),
      recordHistogram: vi.fn(),
      startSpan: vi.fn().mockReturnValue(mockSpan),
    };
    vi.mocked(getTelemetryProvider).mockReturnValue(mockProvider);

    const mockFetch = vi.fn().mockResolvedValue(
      new Response('', {
        status: 302,
        headers: { location: '#/signin' },
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    const initialUrl = new URL('https://my-tableau-server.com/oauth2/v1/auth');
    const result = await getOAuthRedirectUrl(initialUrl, { lockSite: false });

    expect(mockProvider.startSpan).toHaveBeenCalledWith('tableau.oauth.site_picker_redirect');
    expect(result.hash).toBe('#/site');
    expect(mockSpan.end).toHaveBeenCalledWith(undefined);
  });

  it('ends the span with the error and falls back to the initial URL when the fetch fails', async () => {
    const mockSpan = { end: vi.fn() };
    const mockProvider = {
      initialize: vi.fn(),
      recordMetric: vi.fn(),
      recordHistogram: vi.fn(),
      startSpan: vi.fn().mockReturnValue(mockSpan),
    };
    vi.mocked(getTelemetryProvider).mockReturnValue(mockProvider);

    const fetchError = new Error('network error');
    const mockFetch = vi.fn().mockRejectedValue(fetchError);
    vi.stubGlobal('fetch', mockFetch);

    const initialUrl = new URL('https://my-tableau-server.com/oauth2/v1/auth');
    const result = await getOAuthRedirectUrl(initialUrl, { lockSite: false });

    expect(result).toBe(initialUrl);
    expect(mockSpan.end).toHaveBeenCalledWith(fetchError);
  });
});

describe('getClientFromMetadataDoc', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts and ends a span around the client metadata fetch on success', async () => {
    const mockSpan = { end: vi.fn() };
    const mockProvider = {
      initialize: vi.fn(),
      recordMetric: vi.fn(),
      recordHistogram: vi.fn(),
      startSpan: vi.fn().mockReturnValue(mockSpan),
    };
    vi.mocked(getTelemetryProvider).mockReturnValue(mockProvider);

    const clientMetadataUrl = new URL('https://127.0.0.1/cimd/client.json');
    const responseBody = {
      client_id: clientMetadataUrl.toString(),
      redirect_uris: ['https://client.example.com/callback'],
    };
    const mockGet = vi.fn().mockResolvedValue({
      headers: { 'content-type': 'application/json' },
      data: responseBody,
    });
    vi.mocked(axios.create).mockReturnValue({ get: mockGet } as any);

    const result = await getClientFromMetadataDoc(clientMetadataUrl);

    expect(mockProvider.startSpan).toHaveBeenCalledWith('tableau.oauth.client_metadata_fetch', {
      url: clientMetadataUrl.toString(),
    });
    expect(mockSpan.end).toHaveBeenCalledWith(undefined);
    expect(result.isOk()).toBe(true);
  });

  it('ends the span with the error when the client metadata fetch fails', async () => {
    const mockSpan = { end: vi.fn() };
    const mockProvider = {
      initialize: vi.fn(),
      recordMetric: vi.fn(),
      recordHistogram: vi.fn(),
      startSpan: vi.fn().mockReturnValue(mockSpan),
    };
    vi.mocked(getTelemetryProvider).mockReturnValue(mockProvider);

    const clientMetadataUrl = new URL('https://127.0.0.1/cimd/client-error.json');
    const fetchError = { isAxiosError: true, response: { status: 400 }, message: 'Bad Request' };
    const mockGet = vi.fn().mockRejectedValue(fetchError);
    vi.mocked(axios.create).mockReturnValue({ get: mockGet } as any);

    const result = await getClientFromMetadataDoc(clientMetadataUrl);

    expect(result.isErr()).toBe(true);
    expect(mockSpan.end).toHaveBeenCalledWith(fetchError);
  });
});
