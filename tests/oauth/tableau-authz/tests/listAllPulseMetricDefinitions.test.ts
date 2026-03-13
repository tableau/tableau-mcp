import z from 'zod';

import { pulseMetricDefinitionSchema } from '../../../../src/sdks/tableau/types/pulse';
import { expect, test } from './base';
import { getTableauMcpPulseDefinition } from './testEnv';

test.describe('list-all-pulse-metric-definitions', () => {
  test('list all pulse metric definitions', async ({ client }) => {
    const definition = getTableauMcpPulseDefinition();

    const pulseMetricDefinitions = await client.callTool('list-all-pulse-metric-definitions', {
      schema: z.array(pulseMetricDefinitionSchema),
    });

    expect(pulseMetricDefinitions.length).toBeGreaterThan(0);
    const pulseMetricDefinition = pulseMetricDefinitions.find(
      (d) => d.metadata.id === definition.id,
    );

    expect(pulseMetricDefinition).toBeDefined();
  });
});
