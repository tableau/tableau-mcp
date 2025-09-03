import z from 'zod';

import { pulseMetricSubscriptionSchema } from '../../src/sdks/tableau/types/pulse.js';
import { deleteConfigJsons, writeConfigJson } from '../configJson.js';
import { getPulseDefinition } from '../constants.js';
import { callTool } from '../startInspector.js';
import { getDefaultEnv, resetEnv, setEnv } from '../testEnv.js';

describe('list-pulse-metric-subscriptions', () => {
  beforeAll(() => deleteConfigJsons('list-pulse-metric-subscriptions'));
  afterEach(() => deleteConfigJsons('list-pulse-metric-subscriptions'));

  beforeAll(setEnv);
  afterAll(resetEnv);

  it('should list all pulse metric subscriptions', { timeout: 10_000 }, async () => {
    const env = getDefaultEnv();
    const tableauMcpDefinition = getPulseDefinition(env.SERVER, env.SITE_NAME, 'Tableau MCP');

    const { filename: configJson } = writeConfigJson({
      describe: 'list-pulse-metric-subscriptions',
      env,
    });

    const subscriptions = await callTool('list-pulse-metric-subscriptions', {
      configJson,
      schema: z.array(pulseMetricSubscriptionSchema),
    });

    expect(subscriptions.length).toBeGreaterThan(0);
    const subscription = subscriptions.find(
      (s) => s.metric_id === tableauMcpDefinition.metrics[0].id,
    );
    expect(subscription).toBeDefined();
  });
});
