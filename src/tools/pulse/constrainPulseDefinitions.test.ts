import invariant from '../../utils/invariant.js';
import { mockDatasources } from '../listDatasources/mockDatasources.js';
import { constrainPulseDefinitions } from './constrainPulseDefinitions.js';
import { mockPulseMetricDefinitions } from './mockPulseMetricDefinitions.js';

describe('constrainPulseDefinitions', () => {
  it('should return empty result when no definitions are found', () => {
    const result = constrainPulseDefinitions({
      definitions: [],
      boundedContext: { projectIds: null, datasourceIds: null, workbookIds: null },
    });

    invariant(result.type === 'empty');
    expect(result.message).toBe(
      'No Pulse Metric Definitions were found. Either none exist or you do not have permission to view them.',
    );
  });

  it('should return empty results when all definitions were filtered out by the bounded context', () => {
    const result = constrainPulseDefinitions({
      definitions: mockPulseMetricDefinitions,
      boundedContext: { projectIds: null, datasourceIds: new Set(['123']), workbookIds: null },
    });

    invariant(result.type === 'empty');
    expect(result.message).toBe(
      [
        'The set of allowed Pulse Metric Definitions that can be queried is limited by the server configuration.',
        'While Pulse Metric Definitions were found, they were all filtered out by the server configuration.',
      ].join(' '),
    );
  });

  it('should return success result when no definitions were filtered out by the bounded context', () => {
    const result = constrainPulseDefinitions({
      definitions: mockPulseMetricDefinitions,
      boundedContext: { projectIds: null, datasourceIds: null, workbookIds: null },
    });

    invariant(result.type === 'success');
    expect(result.result).toBe(mockPulseMetricDefinitions);
  });

  it('should return success result when some definitions were filtered out by the bounded context', () => {
    const result = constrainPulseDefinitions({
      definitions: mockPulseMetricDefinitions,
      boundedContext: {
        projectIds: null,
        datasourceIds: new Set([mockDatasources.datasources[0].id]),
        workbookIds: null,
      },
    });

    invariant(result.type === 'success');
    expect(result.result).toEqual([mockPulseMetricDefinitions[0]]);
  });
});
