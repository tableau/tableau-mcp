import invariant from '../src/utils/invariant.js';

export type Datasource = { id: string };
export type Workbook = { id: string; defaultViewId: string };

type EnvironmentData = {
  servers: {
    [url: string]: {
      sites: {
        [name: string]: {
          datasources: {
            [name: string]: Datasource;
          };
          workbooks: {
            [name: string]: Workbook;
          };
        };
      };
    };
  };
};

const environmentData: EnvironmentData = {
  servers: {
    'https://10ax.online.tableau.com': {
      sites: {
        'mcp-test': {
          datasources: {
            'Superstore Datasource': { id: '2d935df8-fe7e-4fd8-bb14-35eb4ba31d45' },
          },
          workbooks: {
            Superstore: {
              id: '222ea993-9391-4910-a167-56b3d19b4e3b',
              defaultViewId: '9460abfe-a6b2-49d1-b998-39e1ebcc55ce',
            },
          },
        },
      },
    },
  },
};

export function getDatasource(
  server: string,
  siteName: string,
  datasourceName: string,
): Datasource {
  const datasource = environmentData.servers[server]?.sites[siteName]?.datasources[datasourceName];
  invariant(datasource, `Datasource not found. Input: ${{ server, siteName, datasourceName }}`);

  return datasource;
}

export function getWorkbook(server: string, siteName: string, workbookName: string): Workbook {
  const workbook = environmentData.servers[server]?.sites[siteName]?.workbooks[workbookName];
  invariant(workbook, `Workbook not found. Input: ${{ server, siteName, workbookName }}`);

  return workbook;
}
