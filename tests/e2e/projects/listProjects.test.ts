import z from 'zod';

import { projectSchema } from '../../../src/sdks/tableau/types/project.js';
import { resetEnv, setEnv } from '../../testEnv.js';
import { McpClient } from '../mcpClient.js';

describe('list-projects', () => {
  let client: McpClient;

  beforeAll(setEnv);
  afterAll(resetEnv);

  beforeAll(async () => {
    client = new McpClient();
    await client.connect();
  });

  afterAll(async () => {
    await client.close();
  });

  it('should list projects', async () => {
    const projects = await client.callTool('list-projects', {
      schema: z.array(projectSchema),
    });

    expect(projects.length).greaterThan(0);
  });

  it('should list projects with filter', async () => {
    const projects = await client.callTool('list-projects', {
      schema: z.array(projectSchema),
      toolArgs: { filter: 'name:eq:Samples' },
    });

    expect(projects.length).greaterThan(0);
    const samples = projects.find((project) => project.name === 'Samples');
    expect(samples).toBeDefined();
    expect(samples).toMatchObject({
      name: 'Samples',
    });
  });
});
