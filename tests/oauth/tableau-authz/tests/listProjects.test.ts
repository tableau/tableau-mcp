import { z } from 'zod';

import { projectSchema } from '../../../../src/sdks/tableau/types/project.js';
import { expect, test } from './base.js';

test.describe('list-projects', () => {
  test('list projects', async ({ client }) => {
    const projects = await client.callTool('list-projects', {
      schema: z.array(projectSchema),
      toolArgs: {},
    });

    expect(projects.length).toBeGreaterThan(0);
  });

  test('list projects with filter', async ({ client }) => {
    const projects = await client.callTool('list-projects', {
      schema: z.array(projectSchema),
      toolArgs: { filter: 'name:eq:Samples' },
    });

    expect(projects.length).toBeGreaterThan(0);
    const samples = projects.find((project) => project.name === 'Samples');
    expect(samples).toMatchObject({
      name: 'Samples',
    });
  });
});
