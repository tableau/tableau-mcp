import { validateDatasourceLuid } from './validateDatasourceLuid.js';

const errorMessage = 'datasourceLuid must be a non-empty string.';

describe('validateDatasourceLuid', () => {
  it('does not throw when datasourceLuid is a non-empty string', () => {
    expect(() =>
      validateDatasourceLuid({ datasourceLuid: '71db762b-6201-466b-93da-57cc0aec8ed9' }),
    ).not.toThrow();
  });

  it('throws an error when datasourceLuid is an empty string', () => {
    expect(() => validateDatasourceLuid({ datasourceLuid: '' })).toThrow(errorMessage);
  });

  it('throws an error when datasourceLuid is undefined', () => {
    // @ts-expect-error Testing missing property
    expect(() => validateDatasourceLuid({})).toThrow(errorMessage);
  });
});
