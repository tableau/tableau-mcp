import { Workbook } from '../../sdks/tableau/types/workbook.js';
import { mockView, mockView2 } from '../views/mockView.js';

export const mockWorkbook = {
  id: '96a43833-27db-40b6-aa80-751efc776b9a',
  name: 'Superstore',
  contentUrl: 'Superstore',
  project: { name: 'Samples', id: 'ae5e9374-2a58-40ab-93e4-a2fd1b07cf7d' },
  showTabs: true,
  defaultViewId: '4d18c547-bbb1-4187-ae5a-7f78b35adf2d',
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
  id: '96a43833-27db-40b6-aa80-751efc776b9a',
  name: 'Finance',
  contentUrl: 'Finance',
  project: { name: 'Finance', id: '4862efd9-3c24-4053-ae1f-18caf18b6ffe' },
  showTabs: true,
  defaultViewId: '4d18c547-bbb1-4187-ae5a-7f78b35adf2e',
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
