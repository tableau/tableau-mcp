import z from 'zod';

import { pulseMetricDefinitionSchema } from '../../../../src/sdks/tableau/types/pulse';
import { getOAuthClient } from '../oauthClient';
import { connectOAuthClient, expect, test } from './base';
import { getTableauMcpPulseDefinition } from './testEnv';

test.describe('list-all-pulse-metric-definitions', () => {
  const client = getOAuthClient();

  test.afterEach(async () => {
    await client.close();
  });

  test.afterAll(async () => {
    await client.resetConsent();
    await client.revokeToken();
  });

  test('list all pulse metric definitions', async ({ page, env }) => {
    await connectOAuthClient({ client, page, env });

    const definition = getTableauMcpPulseDefinition();

    const pulseMetricDefinitions = await client.callTool('list-all-pulse-metric-definitions', {
      schema: z.array(pulseMetricDefinitionSchema),
    });

    expect(pulseMetricDefinitions.length).toBeGreaterThan(0);
    const pulseMetricDefinition = pulseMetricDefinitions.find(
      (d) => d.metadata.id === definition.id,
    );

    expect(pulseMetricDefinition).toBeDefined();
  });
});
