import { AxiosError, AxiosHeaders } from 'axios';

import { isInsufficientScopeError } from './isInsufficientScopeError.js';

function responseError(status: number, data: unknown, challenge?: string): AxiosError {
  const error = new AxiosError('Request failed');
  error.response = {
    status,
    data,
    headers: challenge ? { 'www-authenticate': challenge } : {},
    statusText: 'Forbidden',
    config: { headers: new AxiosHeaders() },
  };
  return error;
}

describe('isInsufficientScopeError', () => {
  it('recognizes an explicit JSON scope error through a wrapped cause', () => {
    const cause = responseError(403, { error: 'insufficient_scope' });
    expect(isInsufficientScopeError(new Error('Wrapped request', { cause }))).toBe(true);
  });

  it.each([
    'Bearer error="insufficient_scope", scope="tableau:packages:read"',
    'Bearer realm="Tableau, API", error="insufficient_scope"',
    'bearer error=insufficient_scope',
  ])('recognizes the Bearer challenge %s', (challenge) => {
    expect(isInsufficientScopeError(responseError(403, undefined, challenge))).toBe(true);
  });

  it.each([
    [401, { error: 'insufficient_scope' }, undefined],
    [403, { error: { code: '403000', summary: 'Forbidden' } }, undefined],
    [403, { error_description: 'insufficient_scope' }, undefined],
    [403, undefined, 'Bearer error="invalid_token"'],
    [403, undefined, 'Basic error="insufficient_scope"'],
    [403, undefined, 'Bearer error_description="Please report error=insufficient_scope"'],
    [403, undefined, 'Bearer realm="test, error=insufficient_scope"'],
  ])(
    'does not infer a scope failure from status or descriptive text (%s, %j, %s)',
    (status, data, challenge) => {
      expect(isInsufficientScopeError(responseError(status, data, challenge))).toBe(false);
    },
  );

  it('handles cyclic causes without looping', () => {
    const error = new Error('insufficient_scope');
    error.cause = error;
    expect(isInsufficientScopeError(error)).toBe(false);
  });
});
