import z from 'zod';

import { pulseMetricDefinitionSchema } from '../../../src/sdks/tableau/types/pulse.js';
import { getPulseDefinition } from '../../constants.js';
import { getDefaultEnv, resetEnv, setEnv } from '../../testEnv.js';
import { McpClient } from '../mcpClient.js';

describe('list-pulse-metric-definitions-from-definition-ids', () => {
  let client: McpClient;

  beforeAll(setEnv);
  afterAll(resetEnv);

  beforeAll(async () => {
    client = new McpClient();
    await client.connect();
  });

  afterAll(async () => {
    await client.close();
  });

  it('should list all pulse metrics from a metric definition id', async () => {
    const env = getDefaultEnv();
    const tableauMcpDefinition = getPulseDefinition(env.SERVER, env.SITE_NAME, 'Tableau MCP');

    const definitions = await client.callTool('list-pulse-metric-definitions-from-definition-ids', {
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
