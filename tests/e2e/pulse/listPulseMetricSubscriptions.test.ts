import z from 'zod';

import { pulseMetricSubscriptionSchema } from '../../../src/sdks/tableau/types/pulse.js';
import { getPulseDefinition } from '../../constants.js';
import { getDefaultEnv, resetEnv, setEnv } from '../../testEnv.js';
import { callTool } from '../client.js';

describe('list-pulse-metric-subscriptions', () => {
  beforeAll(setEnv);
  afterAll(resetEnv);

  it('should list all pulse metric subscriptions', async () => {
    const env = getDefaultEnv();
    const tableauMcpDefinition = getPulseDefinition(env.SERVER, env.SITE_NAME, 'Tableau MCP');

    const subscriptions = await callTool('list-pulse-metric-subscriptions', {
      env,
      schema: z.array(pulseMetricSubscriptionSchema),
    });

    expect(subscriptions.length).toBeGreaterThan(0);
    const subscription = subscriptions.find(
      (s) => s.metric_id === tableauMcpDefinition.metrics[0].id,
    );
    expect(subscription).toBeDefined();
  });
});
