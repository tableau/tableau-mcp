import z from 'zod';

import { pulseMetricSubscriptionSchema } from '../../../../src/sdks/tableau/types/pulse';
import { getOAuthClient } from '../oauthClient';
import { connectOAuthClient, expect, test } from './base';
import { getTableauMcpPulseDefinition } from './testEnv';

// Skip until we can reliably get the user id from the bearer token
test.describe.skip('list-pulse-metric-subscriptions', () => {
  const client = getOAuthClient();

  test.afterEach(async () => {
    await client.close();
  });

  test.afterAll(async () => {
    await client.resetConsent();
    await client.revokeToken();
  });

  test('list pulse metric subscriptions', async ({ page, env }) => {
    await connectOAuthClient({ client, page, env });

    const definition = getTableauMcpPulseDefinition();

    const pulseMetricSubscriptions = await client.callTool('list-pulse-metric-subscriptions', {
      schema: z.array(pulseMetricSubscriptionSchema),
      toolArgs: {
        metricIds: [definition.metrics[0].id],
      },
    });

    expect(pulseMetricSubscriptions.length).toBeGreaterThan(0);
    const pulseMetricSubscription = pulseMetricSubscriptions.find(
      (s) => s.metric_id === definition.metrics[0].id,
    );

    expect(pulseMetricSubscription).toBeDefined();
  });
});
