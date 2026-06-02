import { Flow } from '../../../../sdks/tableau/types/flow.js';

const flows = [
  {
    id: 'd00700fe-28a0-4ece-a7af-5543ddf38a82',
    name: 'Sales Cleanup',
    description: 'Cleans up the daily sales feed',
    webpageUrl: 'http://tpqawin01/#/flows/3',
    fileType: 'tflx',
    createdAt: '2024-11-06T04:57:55Z',
    updatedAt: '2024-11-06T21:31:00Z',
    project: {
      id: '6f8a2966-e173-11e8-ae74-ffd84c19d7f3',
      name: 'Default',
      description: 'The default project that was automatically created by Tableau.',
    },
    owner: {
      id: '711e59cf-d1c0-446e-be48-3673ae067f7b',
      name: 'jane.doe@example.com',
      fullName: 'Jane Doe',
      email: 'jane.doe@example.com',
      siteRole: 'Creator',
    },
    tags: {
      tag: [{ label: 'tag-1' }],
    },
  },
  {
    id: 'c1e82fe3-e7cf-4bd5-afd3-799b1e8aac27',
    name: 'Finance Aggregation',
    description: '',
    webpageUrl: 'http://tpqawin01/#/flows/26',
    fileType: 'tflx',
    createdAt: '2024-11-06T18:19:54Z',
    updatedAt: '2024-11-06T18:19:54Z',
    project: {
      id: '4862efd9-3c24-4053-ae1f-18caf18b6ffe',
      name: 'Finance',
    },
    owner: {
      id: '711e59cf-d1c0-446e-be48-3673ae067f7b',
    },
    tags: {
      tag: [{ label: 'tag-2' }],
    },
  },
] satisfies Array<Flow>;

export const mockFlows = {
  pagination: {
    pageNumber: 1,
    pageSize: 10,
    totalAvailable: flows.length,
  },
  flows,
};
