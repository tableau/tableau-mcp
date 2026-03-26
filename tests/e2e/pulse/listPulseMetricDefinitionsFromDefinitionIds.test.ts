import dotenv from 'dotenv';
import z from 'zod';

import { pulseMetricDefinitionSchema } from '../../../src/sdks/tableau/types/pulse.js';
import { getTableauMcpPulseDefinition } from '../../testEnv.js';
import { callTool } from '../client.js';

describe('list-pulse-metric-definitions-from-definition-ids', () => {
  beforeAll(() => {
    dotenv.config();
  });

  it('should list all pulse metrics from a metric definition id', async () => {
    const tableauMcpDefinition = getTableauMcpPulseDefinition();

    const definitions = await callTool('list-pulse-metric-definitions-from-definition-ids', {
      schema: z.array(pulseMetricDefinitionSchema),
      toolArgs: {
        metricDefinitionIds: [tableauMcpDefinition.id],
        view: 'DEFINITION_VIEW_BASIC',
      },
    });

    expect(definitions.length).toBeGreaterThan(0);
    const definition = definitions.find((d) => d.metadata.id === tableauMcpDefinition.id);
    expect(definition).toBeDefined();
  });
});
