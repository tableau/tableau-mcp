import { BoundedContext } from '../../config.js';
import { PulseMetric } from '../../sdks/tableau/types/pulse.js';
import { ConstrainedResult } from '../tool.js';

export function constrainPulseMetrics({
  metrics,
  boundedContext,
}: {
  boundedContext: BoundedContext;
  metrics: Array<PulseMetric>;
}): ConstrainedResult<Array<PulseMetric>> {
  if (metrics.length === 0) {
    return {
      type: 'empty',
      message:
        'No Pulse Metrics were found. Either none exist or you do not have permission to view them.',
    };
  }

  const { datasourceIds } = boundedContext;

  if (datasourceIds) {
    metrics = metrics.filter((metric) => datasourceIds.has(metric.datasource_luid));
  }

  if (metrics.length === 0) {
    return {
      type: 'empty',
      message: [
        'The set of allowed Pulse Metrics that can be queried is limited by the server configuration.',
        'While Pulse Metrics were found, they were all filtered out by the server configuration.',
      ].join(' '),
    };
  }

  return {
    type: 'success',
    result: metrics,
  };
}
