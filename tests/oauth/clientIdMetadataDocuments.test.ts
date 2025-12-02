import express from 'express';
import http from 'http';
import request from 'supertest';
import { MockedFunction, vi } from 'vitest';

import { getConfig, ONE_DAY_IN_MS } from '../../src/config.js';
import { serverName } from '../../src/server.js';
import { startExpressServer } from '../../src/server/express.js';
import { clientMetadataCache } from '../../src/server/oauth/clientMetadataCache.js';
import { axios } from '../../src/utils/axios.js';
import { resetEnv, setEnv } from './testEnv.js';

const constants = vi.hoisted(() => ({
  FAKE_CLIENT_METADATA_URL: 'https://www.fakemcpclient.com/.well-known/oauth/client-metadata.json',
}));

const mocks = vi.hoisted(() => ({
  MOCK_AXIOS_GET_RESPONSE: {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'max-age=3600',
    },
    data: {
      client_id: constants.FAKE_CLIENT_METADATA_URL,
      client_name: 'Fake MCP Client',
      client_uri: 'https://www.fakemcpclient.com',
      redirect_uris: [
        'fakemcpclient://oauth/callback',
        'fakemcpclient://authkit/callback',
        'http://127.0.0.1:6274/oauth/callback',
        'http://127.0.0.1:6274/callback',
        'http://127.0.0.1:6274/oauth/callback/debug',
      ],
      grant_types: [
        'authorization_code',
        'refresh_token',
        'urn:ietf:params:oauth:grant-type:device_code',
      ],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      application_type: 'native',
    },
  },
  dnsResolver: vi.fn(),
}));

vi.mock('axios', () => {
  return {
    default: {
      get: vi.fn(),
      create: vi.fn().mockReturnThis(),
    },
  };
});

const mockAxios = {
  get: axios.get as MockedFunction<typeof axios.get>,
};

vi.mock('../../src/server/oauth/dnsResolver.js', () => ({
  getDnsResolver: mocks.dnsResolver,
}));

describe('clientIdMetadataDocuments', () => {
  let _server: http.Server | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeAll(setEnv);
  afterAll(resetEnv);

  beforeEach(() => {
    vi.clearAllMocks();
    clientMetadataCache.clear();
    _server = undefined;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      if (_server) {
        _server.close(() => {
          resolve();
        });
      } else {
        resolve();
      }
    });
  });

  async function startServer(): Promise<{ app: express.Application }> {
    const { app, server } = await startExpressServer({
      basePath: serverName,
      config: getConfig(),
      logLevel: 'info',
    });

    _server = server;
    return { app };
  }

  it('should redirect to Tableau OAuth with valid CIMD URL', async () => {
    const { app } = await startServer();

    mocks.dnsResolver.mockReturnValue({ resolve4: () => ['1.2.3.4'] });
    mockAxios.get.mockResolvedValue(mocks.MOCK_AXIOS_GET_RESPONSE);

    const response = await request(app).get('/oauth/authorize').query({
      response_type: 'code',
      client_id: constants.FAKE_CLIENT_METADATA_URL,
      redirect_uri: 'http://127.0.0.1:6274/oauth/callback/debug',
      code_challenge: 'fake-code-challenge',
      code_challenge_method: 'S256',
      state: 'fake-state',
      resource: 'http://127.0.0.1:3927/tableau-mcp',
    });

    expect(mockAxios.get).toHaveBeenCalledWith(
      'https://1.2.3.4/.well-known/oauth/client-metadata.json',
      expect.any(Object),
    );

    expect(response.status).toBe(302);
    const location = new URL(response.headers['location']);
    expect(location.hostname).toBe('10ax.online.tableau.com');
    expect(location.pathname).toBe('/oauth2/v1/auth');
    expect(location.searchParams.get('client_id')).toEqual(expect.any(String));
    expect(location.searchParams.get('code_challenge')).toEqual(expect.any(String));
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('response_type')).toBe('code');
    expect(location.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:3927/Callback');
    expect(location.searchParams.get('state')).toEqual(expect.any(String));
    expect(location.searchParams.get('device_id')).toEqual(expect.any(String));
    expect(location.searchParams.get('target_site')).toBe('mcp-test');
    expect(location.searchParams.get('device_name')).toBe('tableau-mcp (Unknown agent)');
    expect(location.searchParams.get('client_type')).toBe('tableau-mcp');
  });

  it('should cache CIMD URL responses', async () => {
    const { app } = await startServer();

    expect(clientMetadataCache.get(constants.FAKE_CLIENT_METADATA_URL)).toBeUndefined();
    mockAxios.get.mockResolvedValue(mocks.MOCK_AXIOS_GET_RESPONSE);

    mocks.dnsResolver.mockReturnValue({ resolve4: () => ['1.2.3.4'] });

    const response = await request(app).get('/oauth/authorize').query({
      response_type: 'code',
      client_id: constants.FAKE_CLIENT_METADATA_URL,
      redirect_uri: 'http://127.0.0.1:6274/oauth/callback/debug',
      code_challenge: 'fake-code-challenge',
      code_challenge_method: 'S256',
      state: 'fake-state',
      resource: 'http://127.0.0.1:3927/tableau-mcp',
    });

    expect(response.status).toBe(302);
    expect(clientMetadataCache.get(constants.FAKE_CLIENT_METADATA_URL)).toBeDefined();
    vi.advanceTimersByTime(3600000 - 1);
    expect(clientMetadataCache.get(constants.FAKE_CLIENT_METADATA_URL)).toBeDefined();
    vi.advanceTimersByTime(1);
    expect(clientMetadataCache.get(constants.FAKE_CLIENT_METADATA_URL)).toBeUndefined();
  });

  it('should support CIMD URLs with IPV6 addresses', async () => {
    const { app } = await startServer();

    mocks.dnsResolver.mockReturnValue({
      resolve4: () => [],
      resolve6: () => ['[FEDC:BA98:7654:3210:FEDC:BA98:7654:3210]'],
    });
    mockAxios.get.mockResolvedValue(mocks.MOCK_AXIOS_GET_RESPONSE);

    const response = await request(app).get('/oauth/authorize').query({
      response_type: 'code',
      client_id: constants.FAKE_CLIENT_METADATA_URL,
      redirect_uri: 'http://127.0.0.1:6274/oauth/callback/debug',
      code_challenge: 'fake-code-challenge',
      code_challenge_method: 'S256',
      state: 'fake-state',
      resource: 'http://127.0.0.1:3927/tableau-mcp',
    });

    expect(mockAxios.get).toHaveBeenCalledWith(
      'https://[fedc:ba98:7654:3210:fedc:ba98:7654:3210]/.well-known/oauth/client-metadata.json',
      expect.any(Object),
    );

    expect(response.status).toBe(302);
  });

  it('should cache CIMD URL responses respecting the cache-control header', async () => {
    const { app } = await startServer();

    expect(clientMetadataCache.get(constants.FAKE_CLIENT_METADATA_URL)).toBeUndefined();

    mockAxios.get.mockResolvedValue({
      ...mocks.MOCK_AXIOS_GET_RESPONSE,
      headers: { ...mocks.MOCK_AXIOS_GET_RESPONSE.headers, 'cache-control': 'max-age=4800' },
    });

    mocks.dnsResolver.mockReturnValue({ resolve4: () => ['1.2.3.4'] });

    const response = await request(app).get('/oauth/authorize').query({
      response_type: 'code',
      client_id: constants.FAKE_CLIENT_METADATA_URL,
      redirect_uri: 'http://127.0.0.1:6274/oauth/callback/debug',
      code_challenge: 'fake-code-challenge',
      code_challenge_method: 'S256',
      state: 'fake-state',
      resource: 'http://127.0.0.1:3927/tableau-mcp',
    });

    expect(response.status).toBe(302);
    expect(clientMetadataCache.get(constants.FAKE_CLIENT_METADATA_URL)).toBeDefined();
    vi.advanceTimersByTime(4800000 - 1);
    expect(clientMetadataCache.get(constants.FAKE_CLIENT_METADATA_URL)).toBeDefined();
    vi.advanceTimersByTime(1);
    expect(clientMetadataCache.get(constants.FAKE_CLIENT_METADATA_URL)).toBeUndefined();
  });

  it('should limit the cache duration to one day', async () => {
    const { app } = await startServer();

    expect(clientMetadataCache.get(constants.FAKE_CLIENT_METADATA_URL)).toBeUndefined();

    mockAxios.get.mockResolvedValue({
      ...mocks.MOCK_AXIOS_GET_RESPONSE,
      headers: {
        ...mocks.MOCK_AXIOS_GET_RESPONSE.headers,
        'cache-control': `max-age=${ONE_DAY_IN_MS / 1000}`,
      },
    });

    mocks.dnsResolver.mockReturnValue({ resolve4: () => ['1.2.3.4'] });

    const response = await request(app).get('/oauth/authorize').query({
      response_type: 'code',
      client_id: constants.FAKE_CLIENT_METADATA_URL,
      redirect_uri: 'http://127.0.0.1:6274/oauth/callback/debug',
      code_challenge: 'fake-code-challenge',
      code_challenge_method: 'S256',
      state: 'fake-state',
      resource: 'http://127.0.0.1:3927/tableau-mcp',
    });

    expect(response.status).toBe(302);
    expect(clientMetadataCache.get(constants.FAKE_CLIENT_METADATA_URL)).toBeDefined();
    vi.advanceTimersByTime(ONE_DAY_IN_MS - 1);
    expect(clientMetadataCache.get(constants.FAKE_CLIENT_METADATA_URL)).toBeDefined();
    vi.advanceTimersByTime(1);
    expect(clientMetadataCache.get(constants.FAKE_CLIENT_METADATA_URL)).toBeUndefined();
  });

  it('should reject authorize requests if IP address cannot be resolved', async () => {
    const { app } = await startServer();

    mocks.dnsResolver.mockReturnValue({ resolve4: () => [], resolve6: () => [] });
    const response = await request(app).get('/oauth/authorize').query({
      response_type: 'code',
      client_id: constants.FAKE_CLIENT_METADATA_URL,
      redirect_uri: 'http://127.0.0.1:6274/oauth/callback/debug',
      code_challenge: 'fake-code-challenge',
      code_challenge_method: 'S256',
      state: 'fake-state',
      resource: 'http://127.0.0.1:3927/tableau-mcp',
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'invalid_request',
      error_description: 'Client URL is not valid',
    });
  });

  it('should reject authorize requests with non-https CIMD URL', async () => {
    const { app } = await startServer();

    const metadataUrl = new URL(constants.FAKE_CLIENT_METADATA_URL);
    metadataUrl.protocol = 'http:';

    mocks.dnsResolver.mockReturnValue({ resolve4: () => ['1.2.3.4'] });

    const response = await request(app).get('/oauth/authorize').query({
      response_type: 'code',
      client_id: metadataUrl.toString(),
      redirect_uri: 'http://127.0.0.1:6274/oauth/callback/debug',
      code_challenge: 'fake-code-challenge',
      code_challenge_method: 'S256',
      state: 'fake-state',
      resource: 'http://127.0.0.1:3927/tableau-mcp',
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'invalid_request',
      error_description: 'Client Metadata URL is not allowed',
    });
  });

  it('should reject authorize requests if the client ID does not match the CIMD URL', async () => {
    const { app } = await startServer();

    mockAxios.get.mockResolvedValue({
      ...mocks.MOCK_AXIOS_GET_RESPONSE,
      data: {
        ...mocks.MOCK_AXIOS_GET_RESPONSE.data,
        client_id: 'https://hacker.com/.well-known/oauth/client-metadata.json',
      },
    });

    mocks.dnsResolver.mockReturnValue({ resolve4: () => ['1.2.3.4'] });

    const response = await request(app).get('/oauth/authorize').query({
      response_type: 'code',
      client_id: constants.FAKE_CLIENT_METADATA_URL,
      redirect_uri: 'http://127.0.0.1:6274/oauth/callback/debug',
      code_challenge: 'fake-code-challenge',
      code_challenge_method: 'S256',
      state: 'fake-state',
      resource: 'http://127.0.0.1:3927/tableau-mcp',
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'invalid_client_metadata',
      error_description: 'Client ID mismatch',
    });
  });

  it('should reject authorize requests if the response Content-Type header is not application/json', async () => {
    const { app } = await startServer();

    mockAxios.get.mockResolvedValue({
      ...mocks.MOCK_AXIOS_GET_RESPONSE,
      headers: { ...mocks.MOCK_AXIOS_GET_RESPONSE.headers, 'content-type': 'text/html' },
    });

    mocks.dnsResolver.mockReturnValue({ resolve4: () => ['1.2.3.4'] });

    const response = await request(app).get('/oauth/authorize').query({
      response_type: 'code',
      client_id: constants.FAKE_CLIENT_METADATA_URL,
      redirect_uri: 'http://127.0.0.1:6274/oauth/callback/debug',
      code_challenge: 'fake-code-challenge',
      code_challenge_method: 'S256',
      state: 'fake-state',
      resource: 'http://127.0.0.1:3927/tableau-mcp',
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'invalid_client_metadata',
      error_description: 'Client Metadata URL must return a JSON response',
    });
  });

  it('should reject authorize requests if the response body is not valid JSON', async () => {
    const { app } = await startServer();

    mockAxios.get.mockResolvedValue({
      ...mocks.MOCK_AXIOS_GET_RESPONSE,
      data: {
        foo: 'bar',
      },
    });

    mocks.dnsResolver.mockReturnValue({ resolve4: () => ['1.2.3.4'] });

    const response = await request(app).get('/oauth/authorize').query({
      response_type: 'code',
      client_id: constants.FAKE_CLIENT_METADATA_URL,
      redirect_uri: 'http://127.0.0.1:6274/oauth/callback/debug',
      code_challenge: 'fake-code-challenge',
      code_challenge_method: 'S256',
      state: 'fake-state',
      resource: 'http://127.0.0.1:3927/tableau-mcp',
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'invalid_client_metadata',
      error_description:
        'Client metadata is invalid: Validation error: Required at "client_id"; Required at "redirect_uris"',
    });
  });

  it('should reject authorize requests if the CIMD request fails', async () => {
    const { app } = await startServer();

    mockAxios.get.mockRejectedValue(new Error('Failed to fetch client metadata'));
    mocks.dnsResolver.mockReturnValue({ resolve4: () => ['1.2.3.4'] });

    const response = await request(app).get('/oauth/authorize').query({
      response_type: 'code',
      client_id: constants.FAKE_CLIENT_METADATA_URL,
      redirect_uri: 'http://127.0.0.1:6274/oauth/callback/debug',
      code_challenge: 'fake-code-challenge',
      code_challenge_method: 'S256',
      state: 'fake-state',
      resource: 'http://127.0.0.1:3927/tableau-mcp',
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'invalid_request',
      error_description: 'Unable to fetch client metadata',
    });
  });
});
