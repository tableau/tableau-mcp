import type { CustomView } from '../../sdks/tableau/types/customView.js';
import { mockWorkbook } from '../workbooks/mockWorkbook.js';
import { mockView } from './mockView.js';

export const mockCustomView = {
  id: 'f69e71d6-8a91-4f46-bea7-dc7d2e124ab7',
  name: 'my-custom-view',
  view: mockView,
  workbook: mockWorkbook,
} satisfies CustomView;
