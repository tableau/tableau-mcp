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
    // Definition specification
    ['400901', 'Missing measure field'],
    ['400902', 'Missing time dimension field'],
    ['400914', 'Invalid measure aggregation'],
    ['400987', 'Missing basic specification'],
    // Measurement period / comparison
    ['400945', 'No measurement period present'],
    ['400946', 'No granularity specified'],
    ['400947', 'No range specified'],
    ['400948', 'No comparison config present'],
    // Constraints
    ['400969', 'is_running_total cannot be true'],
    ['400972', 'Invalid input metric'],
    // Auth
    ['401003', 'Datasource authentication failed'],
    ['403901', 'User lacks permissions on this datasource'],
    ['403905', 'define metrics'],
    // Not found
    ['404900', 'Core metric (definition) not found'],
    ['404939', 'Datasource is inaccessible'],
    // Conflict
    ['409902', 'same specification already exists'],
    // Rate limiting
    ['429956', 'already attempted in the past 24 hours'],
    // Timeout
    ['408901', 'Request timed out'],
    // Server errors
    ['500900', 'retryable'],
  ])('provides guidance for error code %s', (code, expectedFragment) => {
    const result = formatPulseInsightsApiError(400, { code, message: '0x00000000' });
    expect(result.message).toContain(expectedFragment);
  });
});
