import z from 'zod';

import { pulseMetricSchema } from '../../src/sdks/tableau/types/pulse.js';
import invariant from '../../src/utils/invariant.js';
import { deleteConfigJsons, writeConfigJson } from '../configJson.js';
import { getPulseDefinition } from '../constants.js';
import { callTool } from '../startInspector.js';
import { getDefaultEnv, resetEnv, setEnv } from '../testEnv.js';

describe('list-pulse-metrics-from-metric-definition-id', () => {
  beforeAll(() => deleteConfigJsons('list-pulse-metrics-from-metric-definition-id'));
  afterEach(() => deleteConfigJsons('list-pulse-metrics-from-metric-definition-id'));

  beforeAll(setEnv);
  afterAll(resetEnv);

  it('should list all pulse metrics from a metric definition id', async () => {
    const env = getDefaultEnv();
    const tableauMcpDefinition = getPulseDefinition(env.SERVER, env.SITE_NAME, 'Tableau MCP');

    const { filename: configJson } = writeConfigJson({
      describe: 'list-pulse-metrics-from-metric-definition-id',
      env,
    });

    const metrics = await callTool('list-pulse-metrics-from-metric-definition-id', {
      configJson,
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
