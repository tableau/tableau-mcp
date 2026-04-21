import { z } from 'zod';

import { customViewSchema } from '../../../../src/sdks/tableau/types/customView.js';
import invariant from '../../../../src/utils/invariant.js';
import { expect, test } from './base.js';
import { getSuperstoreWorkbook } from './testEnv.js';

test.describe('list-custom-views', () => {
  test('list custom views', async ({ client }) => {
    const superstore = getSuperstoreWorkbook();

    const customViews = await client.callTool('list-custom-views', {
      schema: z.array(customViewSchema),
      toolArgs: {
        workbookId: superstore.id,
      },
    });

    expect(customViews.length).toBeGreaterThan(0);
    const customView = customViews.find(
      (customView) => customView.id === superstore.defaultView.customViewId,
    );
    invariant(customView, 'Custom view for Superstore workbook not found');

    expect(customView).toMatchObject({
      id: superstore.defaultView.customViewId,
      workbook: {
        id: superstore.id,
      },
      view: {
        id: superstore.defaultView.id,
      },
    });
  });
});
