import { Workbook } from '../../sdks/tableau/types/workbook.js';
import { mockView, mockView2 } from '../views/mockView.js';

export const mockWorkbook = {
  id: '96a43833-27db-40b6-aa80-751efc776b9a',
  name: 'Superstore',
  contentUrl: 'Superstore',
  project: { name: 'Samples', id: 'ae5e9374-2a58-40ab-93e4-a2fd1b07cf7d' },
  showTabs: true,
  defaultViewId: mockView.id,
  views: {
    view: [mockView],
  },
  tags: {
    tag: [
      {
        label: 'tag-1',
      },
    ],
  },
} satisfies Workbook;

export const mockWorkbook2 = {
  id: '34b086f1-6f57-4150-ab1d-331d07d11de5',
  name: 'Finance',
  contentUrl: 'Finance',
  project: { name: 'Finance', id: '4862efd9-3c24-4053-ae1f-18caf18b6ffe' },
  showTabs: true,
  defaultViewId: mockView2.id,
  views: {
    view: [mockView2],
  },
  tags: {
    tag: [
      {
        label: 'tag-2',
      },
    ],
  },
} satisfies Workbook;
