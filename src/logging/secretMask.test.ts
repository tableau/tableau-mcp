import { RequestInterceptorConfig, ResponseInterceptorConfig } from '../sdks/interceptors.js';
import { WebMcpServer } from '../server.web.js';
import { setNotificationLevel } from './notification.js';
import { maskRequest, maskResponse } from './secretMask.js';

describe('secretMask', () => {
  beforeEach(() => {
    setNotificationLevel(new WebMcpServer().mcpServer, 'debug', { silent: true });
  });

  it('should mask secrets in requests', () => {
    const maskedRequest = maskRequest({
      method: 'POST',
      baseUrl: 'https://example.com',
      url: '/api/v1/users',
      headers: {
        'X-Tableau-Auth': "Secret, secret, I've got a secret",
      },
      data: {
        credentials: {
          username: 'sponge',
          password: 'bob',
        },
      },
    });

    expect(maskedRequest).toEqual({
      method: 'POST',
      baseUrl: 'https://example.com',
      url: '/api/v1/users',
      headers: { 'X-Tableau-Auth': '<redacted>' },
      data: { credentials: '<redacted>' },
    });
  });

  it('should mask secrets in datasource connections', () => {
    const maskedRequest = maskRequest({
      method: 'POST',
      baseUrl: 'https://example.com',
      url: '/api/v1/users',
      headers: {},
      data: {
        datasource: {
          connections: [
            {
              connectionLuid: 'ds1-connection-luid1',
              connectionUsername: 'username1',
              connectionPassword: 'password1',
            },
            {
              connectionLuid: 'ds1-connection-luid2',
              connectionUsername: 'username2',
              connectionPassword: 'password2',
            },
          ],
        },
      },
    });

    expect(maskedRequest).toEqual({
      method: 'POST',
      baseUrl: 'https://example.com',
      url: '/api/v1/users',
      headers: {},
      data: {
        datasource: {
          connections: [
            {
              connectionLuid: 'ds1-connection-luid1',
              connectionUsername: '<redacted>',
              connectionPassword: '<redacted>',
            },
            {
              connectionLuid: 'ds1-connection-luid2',
              connectionUsername: '<redacted>',
              connectionPassword: '<redacted>',
            },
          ],
        },
      },
    });
  });

  it('should mask secrets in responses', () => {
    const maskedResponse = maskResponse({
      status: 200,
      baseUrl: 'https://example.com',
      params: {},
      url: '/api/v1/users',
      headers: { 'Some-Header': 'hamburgers' },
      data: {
        credentials: 'Hello, world!',
        data: 'Hello, world!',
      },
    });

    expect(maskedResponse).toEqual({
      status: 200,
      baseUrl: 'https://example.com',
      url: '/api/v1/users',
      params: {},
      headers: { 'Some-Header': 'hamburgers' },
      data: {
        credentials: '<redacted>',
        data: 'Hello, world!',
      },
    });
  });

  it('masks semantic statements recursively in Knowledge requests and responses', () => {
    const request = maskRequest({
      method: 'POST',
      baseUrl: 'https://example.com/api/v1/knowledge',
      url: '/graphs/graph-1/semantic-statements',
      headers: {},
      data: { statements: [{ statement: 'Revenue excludes refunds.' }] },
    });
    const response = maskResponse({
      status: 200,
      baseUrl: 'https://example.com/api/v1/knowledge',
      params: {},
      url: '/graphs/graph-1/semantic-statements/search',
      headers: {},
      data: {
        result: {
          properties: { statements: [{ id: 'stmt:1', statement: 'Revenue excludes refunds.' }] },
        },
      },
    });

    expect(request.data).toEqual({ statements: '<redacted>' });
    expect(response.data).toEqual({
      result: { properties: { statements: '<redacted>' } },
    });
  });

  it('masks semantic statements nested in Knowledge error responses', () => {
    const response = maskResponse({
      status: 400,
      baseUrl: 'https://example.com/api/v1/knowledge',
      params: {},
      url: '/graphs/graph-1/semantic-statements/context-1',
      headers: {},
      data: {
        error: {
          details: { semantic_context: { statements: [{ statement: 'Sensitive rule.' }] } },
        },
      },
    });

    expect(response.data).toEqual({
      error: { details: { semantic_context: { statements: '<redacted>' } } },
    });
  });

  it.each(['/graphs/graph-1/nodes/search', '/graphs/graph-1/nodes/resolve'])(
    'masks candidate statements in Knowledge response %s',
    (url) => {
      const response = maskResponse({
        status: 200,
        baseUrl: 'https://example.com/api/v1/knowledge',
        params: {},
        url,
        headers: {},
        data: {
          result: { candidates: [{ statements: [{ statement: 'Sensitive rule.' }] }] },
        },
      });

      expect(response.data).toEqual({
        result: { candidates: [{ statements: '<redacted>' }] },
      });
    },
  );

  it('leaves unrelated statements fields untouched', () => {
    const data = { statements: [{ statement: 'Not a Knowledge semantic statement.' }] };

    expect(
      maskRequest({
        method: 'POST',
        baseUrl: 'https://example.com/api/v1',
        url: '/unrelated/statements',
        headers: {},
        data,
      }).data,
    ).toEqual(data);
  });

  it('should not include headers and data in the request if the log level is not debug', () => {
    setNotificationLevel(new WebMcpServer().mcpServer, 'info', { silent: true });

    const maskedRequest = maskRequest({
      method: 'POST',
      baseUrl: 'https://example.com',
      url: '/api/v1/users',
      headers: { 'X-Tableau-Auth': "Secret, secret, I've got a secret" },
      data: {
        credentials: {
          username: 'sponge',
          password: 'bob',
        },
      },
    });

    expect(maskedRequest).toEqual({
      method: 'POST',
      baseUrl: 'https://example.com',
      url: '/api/v1/users',
    });
  });

  it('should not include headers and data in the response if the log level is not debug', () => {
    setNotificationLevel(new WebMcpServer().mcpServer, 'info', { silent: true });

    const maskedResponse = maskResponse({
      status: 200,
      baseUrl: 'https://example.com',
      params: {},
      url: '/api/v1/users',
      headers: { 'Some-Header': 'hamburgers' },
      data: {
        credentials: 'Hello, world!',
        data: 'Hello, world!',
      },
    });

    expect(maskedResponse).toEqual({
      status: 200,
      baseUrl: 'https://example.com',
      url: '/api/v1/users',
      params: {},
    });
  });

  it('should not mask when request config cannot be cloned', () => {
    const request: RequestInterceptorConfig = {
      method: 'POST',
      baseUrl: 'https://example.com',
      url: '/api/v1/users',
      headers: {
        'X-Tableau-Auth': "Secret, secret, I've got a secret",
      },
      // Functions can't be cloned by the structured clone algorithm.
      data: () => {},
    };

    const maskedRequest = maskRequest(request);
    expect(maskedRequest).toEqual(request);
  });

  it('should not mask when response config cannot be cloned', () => {
    const response: ResponseInterceptorConfig = {
      status: 200,
      baseUrl: 'https://example.com',
      params: {},
      url: '/api/v1/users',
      headers: { 'Some-Header': 'hamburgers' },
      // Functions can't be cloned by the structured clone algorithm.
      data: () => {},
    };

    const maskedResponse = maskResponse(response);
    expect(maskedResponse).toEqual(response);
  });

  it('should mask user_id in params in requests', () => {
    const maskedRequest = maskRequest({
      method: 'POST',
      baseUrl: 'https://example.com',
      url: '/api/v1/users',
      headers: {},
      params: {
        user_id: 'secret-user-id',
        other_param: 'not-secret',
      },
      data: {},
    });

    expect(maskedRequest).toEqual({
      method: 'POST',
      baseUrl: 'https://example.com',
      url: '/api/v1/users',
      headers: {},
      params: {
        user_id: '<redacted>',
        other_param: 'not-secret',
      },
      data: {},
    });
  });

  it('should not include params in the request if the log level is not debug', () => {
    setNotificationLevel(new WebMcpServer().mcpServer, 'info', { silent: true });

    const maskedRequest = maskRequest({
      method: 'POST',
      baseUrl: 'https://example.com',
      url: '/api/v1/users',
      headers: {},
      params: {
        user_id: 'secret-user-id',
        other_param: 'not-secret',
      },
      data: {},
    });

    expect(maskedRequest).toEqual({
      method: 'POST',
      baseUrl: 'https://example.com',
      url: '/api/v1/users',
    });
  });
});
