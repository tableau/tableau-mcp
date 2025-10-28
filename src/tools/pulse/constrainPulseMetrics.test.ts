import invariant from '../../utils/invariant.js';
import { constrainPulseMetrics } from './constrainPulseMetrics.js';
import { mockPulseMetricDefinitions } from './mockPulseMetricDefinitions.js';

describe('constrainPulseMetrics', () => {
  const mockPulseMetrics = mockPulseMetricDefinitions.flatMap((definition) => definition.metrics);

  it('should return empty result when no metrics are found', () => {
    const result = constrainPulseMetrics({
      metrics: [],
      boundedContext: { projectIds: null, datasourceIds: null, workbookIds: null },
    });

    invariant(result.type === 'empty');
    expect(result.message).toBe(
      'No Pulse Metrics were found. Either none exist or you do not have permission to view them.',
    );
  });

  it('should return empty results when all metrics were filtered out by the bounded context', () => {
    const result = constrainPulseMetrics({
      metrics: mockPulseMetrics,
      boundedContext: { projectIds: null, datasourceIds: new Set(['123']), workbookIds: null },
    });

    invariant(result.type === 'empty');
    expect(result.message).toBe(
      [
        'The set of allowed Pulse Metrics that can be queried is limited by the server configuration.',
        'While Pulse Metrics were found, they were all filtered out by the server configuration.',
      ].join(' '),
    );
  });

  it('should return success result when no metrics were filtered out by the bounded context', () => {
    const result = constrainPulseMetrics({
      metrics: mockPulseMetrics,
      boundedContext: { projectIds: null, datasourceIds: null, workbookIds: null },
    });

    invariant(result.type === 'success');
    expect(result.result).toBe(mockPulseMetrics);
  });

  it('should return success result when some metrics were filtered out by the bounded context', () => {
    const result = constrainPulseMetrics({
      metrics: mockPulseMetrics,
      boundedContext: {
        projectIds: null,
        datasourceIds: new Set([mockPulseMetrics[0].datasource_luid]),
        workbookIds: null,
      },
    });

    invariant(result.type === 'success');
    expect(result.result).toEqual(
      mockPulseMetrics.filter(
        (metric) => metric.datasource_luid === mockPulseMetrics[0].datasource_luid,
      ),
    );
  });
});
