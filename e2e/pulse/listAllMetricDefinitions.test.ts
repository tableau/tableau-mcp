import z from 'zod';

import { pulseMetricDefinitionSchema } from '../../src/sdks/tableau/types/pulse.js';
import { deleteConfigJsons, writeConfigJson } from '../configJson.js';
import { getPulseDefinition } from '../constants.js';
import { callTool } from '../startInspector.js';
import { getDefaultEnv, resetEnv, setEnv } from '../testEnv.js';

describe('list-all-pulse-metric-definitions', () => {
  beforeAll(() => deleteConfigJsons('list-all-pulse-metric-definitions'));
  afterEach(() => deleteConfigJsons('list-all-pulse-metric-definitions'));

  beforeAll(setEnv);
  afterAll(resetEnv);

  it('should list all pulse metric definitions', { timeout: 10_000 }, async () => {
    const env = getDefaultEnv();
    const tableauMcpDefinition = getPulseDefinition(env.SERVER, env.SITE_NAME, 'Tableau MCP');

    const { filename: configJson } = writeConfigJson({
      describe: 'list-all-pulse-metric-definitions',
      env,
    });

    const definitions = await callTool('list-all-pulse-metric-definitions', {
      configJson,
      schema: z.array(pulseMetricDefinitionSchema),
    });

    expect(definitions.length).toBeGreaterThan(0);
    const definition = definitions.find((d) => d.metadata.id === tableauMcpDefinition.id);
    expect(definition).toBeDefined();
  });
});
