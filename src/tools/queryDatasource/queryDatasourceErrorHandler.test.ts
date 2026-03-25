import { handleQueryDatasourceError } from './queryDatasourceErrorHandler.js';

describe('handleQueryDatasourceError', () => {
  it('should enrich a known error code with condition and details', () => {
    const result = handleQueryDatasourceError('tableau-error', 'Some error', 400, '400803');

    expect(result.type).toBe('tableau-error');
    expect(result.message).toBe('Some error');
    expect(result.statusCode).toBe(400);
    expect(result.internalError).toBe('Validation failed');
    expect(result.internalErrorDetails).toBe(
      "The incoming request isn't valid per the validation rules.",
    );
  });

  it('should return an error without condition or details for an unknown error code', () => {
    const result = handleQueryDatasourceError('tableau-error', 'Unknown error', 500, '999999');

    expect(result.type).toBe('tableau-error');
    expect(result.message).toBe('Unknown error');
    expect(result.statusCode).toBe(500);
    expect(result.internalError).toBeUndefined();
    expect(result.internalErrorDetails).toBeUndefined();
  });

  it('should return an error without condition or details when error code is undefined', () => {
    const result = handleQueryDatasourceError('tableau-error', 'No error code', 500, undefined);

    expect(result.type).toBe('tableau-error');
    expect(result.message).toBe('No error code');
    expect(result.internalError).toBeUndefined();
    expect(result.internalErrorDetails).toBeUndefined();
  });
});
