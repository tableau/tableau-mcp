import z from 'zod';

import { viewSchema } from '../../../../src/sdks/tableau/types/view';
import { expect, test } from './base';

// Skip until Content Exploration issues are resolved
test.describe.skip('list-views', () => {
  test('list views', async ({ client }) => {
    const views = await client.callTool('list-views', {
      schema: z.array(viewSchema),
      toolArgs: {},
    });

    expect(views.length).toBeGreaterThan(0);
    const view = views.find((view) => view.name === 'Overview');

    expect(view).toBeDefined();
  });
});
