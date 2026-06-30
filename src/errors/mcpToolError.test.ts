import { PulseInsightsApiError } from './mcpToolError.js';

describe('PulseInsightsApiError', () => {
  it('includes known error code guidance when the code is in the lookup map', () => {
    const error = new PulseInsightsApiError(400, {
      code: '400945',
      message: '0x30c0672c',
    });

    expect(error.type).toBe('pulse-insights-api-error');
    expect(error.statusCode).toBe(400);
    expect(error.getErrorText()).toContain('Pulse Insights API returned HTTP 400.');
    expect(error.getErrorText()).toContain('Error code: 400945.');
    expect(error.getErrorText()).toContain(
      'No measurement period present. Set metric_specification.measurement_period with both granularity and range.',
    );
    expect(error.getErrorText()).not.toContain('TabCode');
  });

  it('falls back to TabCode when the error code is not in the lookup map', () => {
    const error = new PulseInsightsApiError(400, {
      code: '499999',
      message: '0xdeadbeef',
    });

    expect(error.getErrorText()).toContain('Pulse Insights API returned HTTP 400.');
    expect(error.getErrorText()).toContain('Error code: 499999.');
    expect(error.getErrorText()).toContain('TabCode: 0xdeadbeef.');
  });

  it('handles response data with no code or message fields', () => {
    const error = new PulseInsightsApiError(500, { unexpected: 'shape' });

    expect(error.getErrorText()).toBe('Pulse Insights API returned HTTP 500.');
    expect(error.internalErrorDetails).toBe('{"unexpected":"shape"}');
  });

  it('handles null response data', () => {
    const error = new PulseInsightsApiError(400, null);

    expect(error.getErrorText()).toBe('Pulse Insights API returned HTTP 400.');
  });

  it('handles non-object response data', () => {
    const error = new PulseInsightsApiError(502, 'Bad Gateway');

    expect(error.getErrorText()).toBe('Pulse Insights API returned HTTP 502.');
    expect(error.internalErrorDetails).toBe('Bad Gateway');
  });

  it('stores the error code as internalError', () => {
    const error = new PulseInsightsApiError(400, {
      code: '400712',
      message: '0xe1fb1869',
    });

    expect(error.internalError).toBe('400712');
    expect(error.internalStatusCode).toBe(400);
  });

  it('preserves full response data in internalErrorDetails', () => {
    const responseData = { code: '400946', message: '0xd7b6c7cb', extra: 'field' };
    const error = new PulseInsightsApiError(400, responseData);

    expect(error.internalErrorDetails).toBe(JSON.stringify(responseData));
  });

  it.each([
    ['400712', 'Missing measure or measure field name'],
    ['400713', 'Unknown or missing measure aggregation'],
    ['400714', 'Missing time dimension or time dimension field name'],
    ['400946', 'No granularity specified'],
    ['400947', 'No range specified'],
    ['400972', 'Time dimension must be absent when both range and comparison are unspecified'],
  ])('provides guidance for error code %s', (code, expectedFragment) => {
    const error = new PulseInsightsApiError(400, { code, message: '0x00000000' });
    expect(error.getErrorText()).toContain(expectedFragment);
  });
});
