import { randomUUID } from 'crypto';

import { PulseMetricDefinition } from '../../sdks/tableau/types/pulse.js';
import {
  createValidPulseMetric,
  createValidPulseMetricDefinition,
} from '../../sdks/tableau/types/pulse.test.js';
import { mockDatasources } from '../listDatasources/mockDatasources.js';

export const mockPulseMetricDefinitions: Array<PulseMetricDefinition> =
  mockDatasources.datasources.map((datasource, index) =>
    createValidPulseMetricDefinition({
      metadata: {
        name: `Pulse Metric ${index + 1}`,
        id: randomUUID(),
        description: `Pulse Metric ${index + 1} Description`,
        schema_version: '1.0',
        metric_version: 1,
        definition_version: 1,
      },
      specification: {
        datasource: {
          id: datasource.id,
        },
        basic_specification: {
          measure: { field: 'sales', aggregation: 'SUM' },
          time_dimension: { field: 'order_date' },
          filters: [],
        },
        is_running_total: false,
      },
      metrics: [1, 2].map((i) =>
        createValidPulseMetric({
          id: randomUUID(),
          datasource_luid: datasource.id,
          is_default: i === 1,
          is_followed: i === 2,
        }),
      ),
    }),
  );
