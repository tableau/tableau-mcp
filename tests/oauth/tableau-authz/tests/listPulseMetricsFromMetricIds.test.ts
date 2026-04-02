import { z } from 'zod';

import { pulseMetricSchema } from '../../../../src/sdks/tableau/types/pulse.js';
import { getTableauMcpPulseDefinition } from '../../../testEnv.js';
import { expect, test } from './base.js';

test.describe('list-pulse-metrics-from-metric-ids', () => {
  test('list pulse metrics from metric definition id', async ({ client }) => {
    const definition = getTableauMcpPulseDefinition();

    const pulseMetrics = await client.callTool('list-pulse-metrics-from-metric-ids', {
      schema: z.array(pulseMetricSchema),
      toolArgs: {
        metricIds: [definition.metrics[0].id],
      },
    });

    expect(pulseMetrics.length).toBeGreaterThan(0);
    const pulseMetric = pulseMetrics.find((m) => m.id === definition.metrics[0].id);

    expect(pulseMetric).toBeDefined();
  });
});
