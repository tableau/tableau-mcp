import { createHash } from 'node:crypto';

import type { WorkbookInventory } from '../../../desktop/externalApi/types.js';

type TargetItem = { id: string; name: string };

const stableItems = (items: TargetItem[] | undefined): TargetItem[] =>
  (items ?? [])
    .map(({ id, name }) => ({ id, name }))
    .sort((left, right) => left.id.localeCompare(right.id) || left.name.localeCompare(right.name));

export const workbookTargetFingerprint = (workbook: WorkbookInventory): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        title: workbook.title,
        location: workbook.location ?? null,
        worksheets: stableItems(workbook.worksheets),
        dashboards: stableItems(workbook.dashboards),
        storyboards: stableItems(workbook.storyboards),
      }),
      'utf8',
    )
    .digest('hex');
