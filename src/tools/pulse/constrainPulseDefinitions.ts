import { BoundedContext } from '../../config.js';
import { PulseMetricDefinition } from '../../sdks/tableau/types/pulse.js';
import { ConstrainedResult } from '../tool.js';

export function constrainPulseDefinitions({
  boundedContext,
  definitions,
}: {
  boundedContext: BoundedContext;
  definitions: Array<PulseMetricDefinition>;
}): ConstrainedResult<Array<PulseMetricDefinition>> {
  if (definitions.length === 0) {
    return {
      type: 'empty',
      message:
        'No Pulse Metric Definitions were found. Either none exist or you do not have permission to view them.',
    };
  }

  const { datasourceIds } = boundedContext;

  if (datasourceIds) {
    definitions = definitions.filter((definition) =>
      datasourceIds.has(definition.specification.datasource.id),
    );
  }

  if (definitions.length === 0) {
    return {
      type: 'empty',
      message: [
        'The set of allowed Pulse Metric Definitions that can be queried is limited by the server configuration.',
        'While Pulse Metric Definitions were found, they were all filtered out by the server configuration.',
      ].join(' '),
    };
  }

  return {
    type: 'success',
    result: definitions,
  };
}
