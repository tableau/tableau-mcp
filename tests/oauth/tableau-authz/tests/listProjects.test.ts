import { z } from 'zod';

import { projectSchema } from '../../../../src/sdks/tableau/types/project.js';
import { expect, test } from './base.js';

test.describe('list-projects', () => {
  test('list projects', async ({ client }) => {
    const { data: projects } = await client.callTool('list-projects', {
      schema: z.object({ data: z.array(projectSchema), totalAvailable: z.number() }),
      toolArgs: {},
    });

    expect(projects.length).toBeGreaterThan(0);
  });

  test('list projects with filter', async ({ client }) => {
    const { data: projects } = await client.callTool('list-projects', {
      schema: z.object({ data: z.array(projectSchema), totalAvailable: z.number() }),
      toolArgs: { filter: 'name:eq:Samples' },
    });

    expect(projects.length).toBeGreaterThan(0);
    const samples = projects.find((project) => project.name === 'Samples');
    expect(samples).toMatchObject({
      name: 'Samples',
    });
  });
});
