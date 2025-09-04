import invariant from '../src/utils/invariant.js';

export type Datasource = { id: string };
export type Workbook = { id: string; defaultViewId: string };

export type PulseDefinition = { id: string; metrics: Array<PulseMetric> };
export type PulseMetric = { id: string };

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
          pulse: {
            definitions: {
              [name: string]: PulseDefinition;
            };
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
          pulse: {
            definitions: {
              'Tableau MCP': {
                id: '9ad098f4-49cf-4e8a-bec0-0ca803091dd0',
                metrics: [{ id: 'fd6c4aa0-f6d3-469e-b75b-d597435ae199' }],
              },
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
  invariant(
    datasource,
    `Datasource not found. Input: ${JSON.stringify({ server, siteName, datasourceName })}`,
  );

  return datasource;
}

export function getWorkbook(server: string, siteName: string, workbookName: string): Workbook {
  const workbook = environmentData.servers[server]?.sites[siteName]?.workbooks[workbookName];
  invariant(
    workbook,
    `Workbook not found. Input: ${JSON.stringify({ server, siteName, workbookName })}`,
  );

  return workbook;
}

export function getPulseDefinition(
  server: string,
  siteName: string,
  definitionName: string,
): PulseDefinition {
  const definition =
    environmentData.servers[server]?.sites[siteName]?.pulse.definitions[definitionName];
  invariant(
    definition,
    `Pulse definition not found. Input: ${JSON.stringify({ server, siteName, definitionName })}`,
  );

  return definition;
}
