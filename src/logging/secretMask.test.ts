import { maskRequest, maskResponse } from './secretMask.js';

describe('secretMask', () => {
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
});
