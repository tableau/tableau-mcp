import { DataSource } from '../../sdks/tableau/types/dataSource.js';

const datasources = [
  {
    id: '2d935df8-fe7e-4fd8-bb14-35eb4ba31d45',
    name: 'Superstore Datasource',
    project: {
      id: 'cbec32db-a4a2-4308-b5f0-4fc67322f359',
      name: 'Samples',
    },
  },
  {
    id: 'ba1da5d9-e92b-4ff2-ad91-4238265d877c',
    name: 'Finance Datasource',
    project: {
      name: 'Finance',
      id: '4862efd9-3c24-4053-ae1f-18caf18b6ffe',
    },
  },
  {
    id: 'a6fc3c9f-4f40-4906-8db0-ac70c5fb5a11',
    name: 'Sales Datasource',
    project: {
      name: 'Finance',
      id: '4862efd9-3c24-4053-ae1f-18caf18b6ffe',
    },
  },
] satisfies Array<DataSource>;

export const mockDatasources = {
  pagination: {
    pageNumber: 1,
    pageSize: 10,
    totalAvailable: datasources.length,
  },
  datasources,
};
