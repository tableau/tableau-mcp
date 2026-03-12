import z from 'zod';

import { pulseMetricDefinitionSchema } from '../../../../src/sdks/tableau/types/pulse';
import { getOAuthClient } from '../oauthClient';
import { connectOAuthClient, expect, test } from './base';
import { getTableauMcpPulseDefinition } from './testEnv';

test.describe('list-pulse-metric-definitions-from-definition-ids', () => {
  const client = getOAuthClient();

  test.afterEach(async () => {
    await client.close();
  });

  test.afterAll(async () => {
    await client.resetConsent();
    await client.revokeToken();
  });

  test('list pulse metric definitions from definition ids', async ({ page, env }) => {
    await connectOAuthClient({ client, page, env });

    const definition = getTableauMcpPulseDefinition();

    const pulseMetricDefinitions = await client.callTool(
      'list-pulse-metric-definitions-from-definition-ids',
      {
        schema: z.array(pulseMetricDefinitionSchema),
        toolArgs: {
          metricDefinitionIds: [definition.id],
        },
      },
    );

    expect(pulseMetricDefinitions.length).toBeGreaterThan(0);
    const pulseMetricDefinition = pulseMetricDefinitions.find(
      (d) => d.metadata.id === definition.id,
    );

    expect(pulseMetricDefinition).toBeDefined();
  });
});
