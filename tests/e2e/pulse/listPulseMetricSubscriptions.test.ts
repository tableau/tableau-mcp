import z from 'zod';

import { pulseMetricSubscriptionSchema } from '../../../src/sdks/tableau/types/pulse.js';
import { getPulseDefinition } from '../../constants.js';
import { getDefaultEnv, resetEnv, setEnv } from '../../testEnv.js';
import { McpClient } from '../mcpClient.js';

describe('list-pulse-metric-subscriptions', () => {
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

  it('should list all pulse metric subscriptions', async () => {
    const env = getDefaultEnv();
    const tableauMcpDefinition = getPulseDefinition(env.SERVER, env.SITE_NAME, 'Tableau MCP');

    const subscriptions = await client.callTool('list-pulse-metric-subscriptions', {
      schema: z.array(pulseMetricSubscriptionSchema),
    });

    expect(subscriptions.length).toBeGreaterThan(0);
    const subscription = subscriptions.find(
      (s) => s.metric_id === tableauMcpDefinition.metrics[0].id,
    );
    expect(subscription).toBeDefined();
  });
});
