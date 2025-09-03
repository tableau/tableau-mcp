import z from 'zod';

import { pulseMetricDefinitionSchema } from '../../src/sdks/tableau/types/pulse.js';
import { deleteConfigJsons, writeConfigJson } from '../configJson.js';
import { getPulseDefinition } from '../constants.js';
import { callTool } from '../startInspector.js';
import { getDefaultEnv, resetEnv, setEnv } from '../testEnv.js';

describe('list-pulse-metric-definitions-from-definition-ids', () => {
  beforeAll(() => deleteConfigJsons('list-pulse-metric-definitions-from-definition-ids'));
  afterEach(() => deleteConfigJsons('list-pulse-metric-definitions-from-definition-ids'));

  beforeAll(setEnv);
  afterAll(resetEnv);

  it('should list all pulse metrics from a metric definition id', async ({ skip }) => {
    skip(
      'Tool arguments in JSON format not supported yet: https://github.com/modelcontextprotocol/inspector/pull/647',
    );

    const env = getDefaultEnv();
    const tableauMcpDefinition = getPulseDefinition(env.SERVER, env.SITE_NAME, 'Tableau MCP');
    const tableauMcpMetric = tableauMcpDefinition.metrics[0];

    const { filename: configJson } = writeConfigJson({
      describe: 'list-pulse-metric-definitions-from-definition-ids',
      env,
    });

    const definitions = await callTool('list-pulse-metric-definitions-from-definition-ids', {
      configJson,
      schema: z.array(pulseMetricDefinitionSchema),
      toolArgs: {
        metricDefinitionIds: [tableauMcpMetric.id],
        view: 'DEFINITION_VIEW_BASIC',
      },
    });

    expect(definitions.length).toBeGreaterThan(0);
    const definition = definitions.find((d) => d.metadata.id === tableauMcpDefinition.id);
    expect(definition).toBeDefined();
  });
});
