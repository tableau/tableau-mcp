import z from 'zod';

import { pulseMetricDefinitionSchema } from '../../../src/sdks/tableau/types/pulse.js';
import { getPulseDefinition } from '../../constants.js';
import { getDefaultEnv, resetEnv, setEnv } from '../../testEnv.js';
import { callTool } from '../client.js';

describe('list-pulse-metric-definitions-from-definition-ids', () => {
  beforeAll(setEnv);
  afterAll(resetEnv);

  it('should list all pulse metrics from a metric definition id', async () => {
    const env = getDefaultEnv();
    const tableauMcpDefinition = getPulseDefinition(env.SERVER, env.SITE_NAME, 'Tableau MCP');

    const definitions = await callTool('list-pulse-metric-definitions-from-definition-ids', {
      env,
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
