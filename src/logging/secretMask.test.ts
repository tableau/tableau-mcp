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

  it('should remove multipart upload bodies and redact upload sessions in request paths', () => {
    const maskedRequest = maskRequest({
      method: 'PUT',
      baseUrl: 'https://example.com/api/3.26',
      url: '/sites/site-id/fileUploads/secret-upload-session-id',
      headers: {
        'X-Tableau-Auth': 'secret-token',
        'Content-Type': 'multipart/mixed; boundary=boundary',
      },
      params: { sequenceID: '0' },
      data: Buffer.from('<workbook>secret workbook bytes</workbook>'),
    });

    expect(maskedRequest).toEqual({
      method: 'PUT',
      baseUrl: 'https://example.com/api/3.26',
      url: '/sites/site-id/fileUploads/<redacted>',
      headers: {
        'X-Tableau-Auth': '<redacted>',
        'Content-Type': 'multipart/mixed; boundary=boundary',
      },
      params: { sequenceID: '0' },
    });
  });

  it('should redact upload session validation query parameters', () => {
    const maskedRequest = maskRequest({
      method: 'POST',
      baseUrl: 'https://example.com/api/3.26',
      url: '/sites/site-id/workbooks/validate',
      headers: {},
      params: {
        uploadSessionId: 'secret-upload-session-id',
      },
    });

    expect(maskedRequest.params).toEqual({ uploadSessionId: '<redacted>' });
  });

  it('should redact upload IDs recursively from debug response bodies', () => {
    const maskedResponse = maskResponse({
      status: 200,
      baseUrl: 'https://example.com/api/3.26',
      params: {},
      url: '/sites/site-id/fileUploads/secret-upload-session-id',
      headers: {},
      data: {
        fileUpload: { uploadSessionId: 'secret-upload-session-id' },
        validation: { uploadId: 'secret-upload-id', errors: [] },
      },
    });

    expect(maskedResponse.url).toBe('/sites/site-id/fileUploads/<redacted>');
    expect(maskedResponse.data).toEqual({
      fileUpload: { uploadSessionId: '<redacted>' },
      validation: { uploadId: '<redacted>', errors: [] },
    });
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
