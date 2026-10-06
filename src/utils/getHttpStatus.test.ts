import { AxiosError } from 'axios';

import { AdminOnlyError } from '../errors/mcpToolError.js';
import { TableauRestError } from '../sdks/tableau/tableauRestError.js';
import { getHttpStatus } from './getHttpStatus.js';

describe('getHttpStatus', () => {
  it('extracts the response status through nested wrappers', () => {
    const upstream = new AxiosError('Forbidden');
    upstream.response = { status: 403 } as AxiosError['response'];
    expect(
      getHttpStatus(new Error('Outer', { cause: new Error('Inner', { cause: upstream }) })),
    ).toBe('403');
  });

  it('preserves Axios-compatible errors that are not Error instances', () => {
    const error = { isAxiosError: true, response: { status: 404 } } as unknown as Error;
    expect(getHttpStatus(error)).toBe('404');
  });

  it('preserves curated and Tableau envelope statuses', () => {
    expect(getHttpStatus(new AdminOnlyError('Admin required'))).toBe('403');
    expect(getHttpStatus(new TableauRestError({ code: '404000' }))).toBe('404');
  });

  it('keeps the outer response status when its cause has a different status', () => {
    const outer = new AxiosError('Upstream unavailable');
    outer.response = { status: 502 } as AxiosError['response'];
    outer.cause = new AdminOnlyError('Admin required');
    expect(getHttpStatus(outer)).toBe('502');
  });

  it('stops at cyclic or non-error causes', () => {
    const cyclic = new Error('Cyclic');
    cyclic.cause = cyclic;
    expect(getHttpStatus(cyclic)).toBe('');
    expect(getHttpStatus(new Error('Plain', { cause: 'unknown' }))).toBe('');
  });
});
