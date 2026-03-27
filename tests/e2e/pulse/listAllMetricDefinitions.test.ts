import z from 'zod';

import { pulseMetricDefinitionSchema } from '../../../src/sdks/tableau/types/pulse.js';
import { getTableauMcpPulseDefinition, setEnv } from '../../testEnv.js';
import { callTool } from '../client.js';

describe('list-all-pulse-metric-definitions', () => {
  beforeAll(setEnv);

  it('should list all pulse metric definitions', async () => {
    const tableauMcpDefinition = getTableauMcpPulseDefinition();

    const definitions = await callTool('list-all-pulse-metric-definitions', {
      schema: z.array(pulseMetricDefinitionSchema),
    });

    expect(definitions.length).toBeGreaterThan(0);
    const definition = definitions.find((d) => d.metadata.id === tableauMcpDefinition.id);
    expect(definition).toBeDefined();
  });
});
