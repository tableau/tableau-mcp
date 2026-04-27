import z from 'zod';

import { pulseMetricSchema } from '../../../src/sdks/tableau/types/pulse.js';
import invariant from '../../../src/utils/invariant.js';
import { getPulseDefinition } from '../../constants.js';
import { getDefaultEnv, resetEnv, setEnv } from '../../testEnv.js';
import { McpClient } from '../mcpClient.js';

describe('list-pulse-metrics-from-metric-definition-id', () => {
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

    const metrics = await client.callTool('list-pulse-metrics-from-metric-definition-id', {
      schema: z.array(pulseMetricSchema),
      toolArgs: {
        pulseMetricDefinitionID: tableauMcpDefinition.id,
      },
    });

    expect(metrics.length).toBeGreaterThan(0);
    const metric = metrics.find((metric) => metric.id === tableauMcpDefinition.metrics[0].id);
    invariant(metric, 'Metric not found');
    expect(metric.definition_id).toBe(tableauMcpDefinition.id);
  });
});
