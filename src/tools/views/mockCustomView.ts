import type { CustomView } from '../../sdks/tableau/types/customView.js';

import { mockView } from './mockView.js';

/** Custom view whose underlying sheet is {@link mockView}. */
export const mockCustomView = {
  id: 'f69e71d6-8a91-4f46-bea7-dc7d2e124ab7',
  name: 'eng360-niraj',
  view: {
    id: mockView.id,
    name: mockView.name,
  },
  workbook: {
    id: mockView.workbook!.id,
    name: 'Mock Workbook',
  },
} satisfies CustomView;
