import {
  RequestInterceptorConfig,
  ResponseInterceptorConfig,
} from '../sdks/tableau/interceptors.js';
import { defaultLogLevel, setLogLevel } from './log.js';
import { maskRequest, maskResponse } from './secretMask.js';

describe('secretMask', () => {
  beforeEach(() => {
    setLogLevel(defaultLogLevel, { silent: true });
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
      headers: { 'Some-Header': 'hamburgers' },
      data: {
        credentials: '<redacted>',
        data: 'Hello, world!',
      },
    });
  });

  it('should not include headers and data in the request if the log level is not debug', () => {
    setLogLevel('info', { silent: true });

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
    setLogLevel('info', { silent: true });

    const maskedResponse = maskResponse({
      status: 200,
      baseUrl: 'https://example.com',
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
      url: '/api/v1/users',
      headers: { 'Some-Header': 'hamburgers' },
      // Functions can't be cloned by the structured clone algorithm.
      data: () => {},
    };

    const maskedResponse = maskResponse(response);
    expect(maskedResponse).toEqual(response);
  });
});
