import { z } from 'zod';

import { pulseMetricDefinitionSchema } from '../../../../src/sdks/tableau/types/pulse.js';
import { getTableauMcpPulseDefinition } from '../../../testEnv.js';
import { expect, test } from './base.js';

test.describe('list-pulse-metric-definitions-from-definition-ids', () => {
  test('list pulse metric definitions from definition ids', async ({ client }) => {
    const definition = getTableauMcpPulseDefinition();

    const pulseMetricDefinitions = await client.callTool(
      'list-pulse-metric-definitions-from-definition-ids',
      {
        schema: z.array(pulseMetricDefinitionSchema),
        toolArgs: {
          metricDefinitionIds: [definition.id],
        },
      },
    );

    expect(pulseMetricDefinitions.length).toBeGreaterThan(0);
    const pulseMetricDefinition = pulseMetricDefinitions.find(
      (d) => d.metadata.id === definition.id,
    );

    expect(pulseMetricDefinition).toBeDefined();
  });
});
