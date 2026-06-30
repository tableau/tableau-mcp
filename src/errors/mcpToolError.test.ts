import { PulseInsightsApiError } from './mcpToolError.js';
import { formatPulseInsightsApiError } from './pulseInsightsApiError.js';

describe('formatPulseInsightsApiError', () => {
  it('includes known error code guidance when the code is in the lookup map', () => {
    const result = formatPulseInsightsApiError(400, { code: '400945', message: '0x30c0672c' });

    expect(result.message).toContain('Pulse Insights API returned HTTP 400.');
    expect(result.message).toContain('Error code: 400945.');
    expect(result.message).toContain(
      'No measurement period present. Set metric_specification.measurement_period with both granularity and range.',
    );
    expect(result.message).not.toContain('TabCode');
    expect(result.errorCode).toBe('400945');
  });

  it('falls back to TabCode when the error code is not in the lookup map', () => {
    const result = formatPulseInsightsApiError(400, { code: '499999', message: '0xdeadbeef' });

    expect(result.message).toContain('Pulse Insights API returned HTTP 400.');
    expect(result.message).toContain('Error code: 499999.');
    expect(result.message).toContain('TabCode: 0xdeadbeef.');
  });

  it('handles response data with no code or message fields', () => {
    const result = formatPulseInsightsApiError(500, { unexpected: 'shape' });

    expect(result.message).toBe('Pulse Insights API returned HTTP 500.');
    expect(result.details).toBe('{"unexpected":"shape"}');
  });

  it('handles null response data', () => {
    const result = formatPulseInsightsApiError(400, null);

    expect(result.message).toBe('Pulse Insights API returned HTTP 400.');
  });

  it('handles non-object response data', () => {
    const result = formatPulseInsightsApiError(502, 'Bad Gateway');

    expect(result.message).toBe('Pulse Insights API returned HTTP 502.');
    expect(result.details).toBe('Bad Gateway');
  });

  it('preserves full response data in details', () => {
    const responseData = { code: '400946', message: '0xd7b6c7cb', extra: 'field' };
    const result = formatPulseInsightsApiError(400, responseData);

    expect(result.details).toBe(JSON.stringify(responseData));
  });

  it.each([
    ['400712', 'Missing measure or measure field name'],
    ['400713', 'Unknown or missing measure aggregation'],
    ['400714', 'Missing time dimension or time dimension field name'],
    ['400946', 'No granularity specified'],
    ['400947', 'No range specified'],
    ['400972', 'Time dimension must be absent when both range and comparison are unspecified'],
  ])('provides guidance for error code %s', (code, expectedFragment) => {
    const result = formatPulseInsightsApiError(400, { code, message: '0x00000000' });
    expect(result.message).toContain(expectedFragment);
  });
});

describe('PulseInsightsApiError', () => {
  it('stores fields passed to constructor', () => {
    const error = new PulseInsightsApiError('test message', 400, '400945', '{"code":"400945"}');

    expect(error.type).toBe('pulse-insights-api-error');
    expect(error.message).toBe('test message');
    expect(error.statusCode).toBe(400);
    expect(error.internalError).toBe('400945');
    expect(error.internalErrorDetails).toBe('{"code":"400945"}');
    expect(error.getErrorText()).toBe('test message');
  });
});
