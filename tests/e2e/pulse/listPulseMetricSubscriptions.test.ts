import z from 'zod';

import { pulseMetricSubscriptionSchema } from '../../../src/sdks/tableau/types/pulse.js';
import { getTableauMcpPulseDefinition, setEnv } from '../../testEnv.js';
import { callTool } from '../client.js';

describe('list-pulse-metric-subscriptions', () => {
  beforeAll(setEnv);

  it('should list all pulse metric subscriptions', async () => {
    const tableauMcpDefinition = getTableauMcpPulseDefinition();

    const subscriptions = await callTool('list-pulse-metric-subscriptions', {
      schema: z.array(pulseMetricSubscriptionSchema),
    });

    expect(subscriptions.length).toBeGreaterThan(0);
    const subscription = subscriptions.find(
      (s) => s.metric_id === tableauMcpDefinition.metrics[0].id,
    );
    expect(subscription).toBeDefined();
  });
});
