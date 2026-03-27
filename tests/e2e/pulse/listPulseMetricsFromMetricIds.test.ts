import z from 'zod';

import { pulseMetricSchema } from '../../../src/sdks/tableau/types/pulse.js';
import invariant from '../../../src/utils/invariant.js';
import { getTableauMcpPulseDefinition, setEnv } from '../../testEnv.js';
import { callTool } from '../client.js';

describe('list-pulse-metrics-from-metric-ids', () => {
  beforeAll(setEnv);

  it('should list all pulse metrics from a list of metric ids', async () => {
    const tableauMcpDefinition = getTableauMcpPulseDefinition();

    const metrics = await callTool('list-pulse-metrics-from-metric-ids', {
      schema: z.array(pulseMetricSchema),
      toolArgs: {
        metricIds: [tableauMcpDefinition.metrics[0].id],
      },
    });

    expect(metrics.length).toBeGreaterThan(0);
    const metric = metrics.find((metric) => metric.id === tableauMcpDefinition.metrics[0].id);
    invariant(metric, 'Metric not found');
    expect(metric.definition_id).toBe(tableauMcpDefinition.id);
  });
});
