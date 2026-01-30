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
  id: '957f9629-1947-4a70-b52d-dc1b3ff997f3',
  name: 'Finance',
  createdAt: '2024-06-10T23:23:23Z',
  updatedAt: '2024-06-10T23:23:23Z',
  project: {
    id: '4862efd9-3c24-4053-ae1f-18caf18b6ffe',
  },
  workbook: {
    id: '34b086f1-6f57-4150-ab1d-331d07d11de5',
  },
  tags: {
    tag: [
      {
        label: 'tag-2',
      },
    ],
  },
} satisfies View;
