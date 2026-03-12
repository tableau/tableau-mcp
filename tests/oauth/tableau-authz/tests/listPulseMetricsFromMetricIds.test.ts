import z from 'zod';

import { pulseMetricSchema } from '../../../../src/sdks/tableau/types/pulse';
import { getOAuthClient } from '../oauthClient';
import { connectOAuthClient, expect, test } from './base';
import { getTableauMcpPulseDefinition } from './testEnv';

test.describe('list-pulse-metrics-from-metric-ids', () => {
  const client = getOAuthClient();

  test.afterEach(async () => {
    await client.close();
  });

  test.afterAll(async () => {
    await client.resetConsent();
    await client.revokeToken();
  });

  test('list pulse metrics from metric definition id', async ({ page, env }) => {
    await connectOAuthClient({ client, page, env });

    const definition = getTableauMcpPulseDefinition();

    const pulseMetrics = await client.callTool('list-pulse-metrics-from-metric-ids', {
      schema: z.array(pulseMetricSchema),
      toolArgs: {
        metricIds: [definition.metrics[0].id],
      },
    });

    expect(pulseMetrics.length).toBeGreaterThan(0);
    const pulseMetric = pulseMetrics.find((m) => m.id === definition.metrics[0].id);

    expect(pulseMetric).toBeDefined();
  });
});
