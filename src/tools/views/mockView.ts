import { View } from '../../sdks/tableau/types/view.js';

export const mockView = {
  id: '4d18c547-bbb1-4187-ae5a-7f78b35adf2d',
  name: 'Overview',
  createdAt: '2024-06-10T23:23:23Z',
  updatedAt: '2024-06-10T23:23:23Z',
  project: {
    id: 'ae5e9374-2a58-40ab-93e4-a2fd1b07cf7d',
  },
  workbook: {
    id: '96a43833-27db-40b6-aa80-751efc776b9a',
  },
  tags: {
    tag: [
      {
        label: 'tag-1',
      },
    ],
  },
} satisfies View;

export const mockView2 = {
  id: '4d18c547-bbb1-4187-ae5a-7f78b35adf2f',
  name: 'Finance',
  createdAt: '2024-06-10T23:23:23Z',
  updatedAt: '2024-06-10T23:23:23Z',
  project: {
    id: '4862efd9-3c24-4053-ae1f-18caf18b6ffe',
  },
  workbook: {
    id: '96a43833-27db-40b6-aa80-751efc776b9b',
  },
  tags: {
    tag: [
      {
        label: 'tag-2',
      },
    ],
  },
} satisfies View;
