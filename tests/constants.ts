import invariant from '../src/utils/invariant.js';

export type Datasource = { id: string };
export type Workbook = { id: string; defaultView: { id: string; customViewId: string } };

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
              defaultView: {
                id: '9460abfe-a6b2-49d1-b998-39e1ebcc55ce',
                customViewId: '1db3a121-51ac-4435-b533-3053e698dfc8',
              },
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
    'https://test-dataplane1.tableau.sfdc-ckzqgc.svc.sfdcfc.net': {
      sites: {
        andytdp1: {
          datasources: {
            'Superstore Datasource': { id: 'f39b2742-e156-49da-85e0-ac1c73547d6d' },
          },
          workbooks: {
            Superstore: {
              id: 'c1beaa20-0b98-43d8-a5de-0bff82bf6a8f',
              defaultView: {
                id: '6e341026-2d87-4a80-b238-86dafa75c2f6',
                customViewId: '33052443-3d7e-458b-a725-52b0e5ee6ef0',
              },
            },
          },
          pulse: {
            definitions: {
              'Tableau MCP': {
                id: 'f353e870-26c4-40bb-9c65-70b2855364c8',
                metrics: [{ id: 'b2b1a35e-d065-4692-87b8-5d6f8acddab1' }],
              },
            },
          },
        },
      },
    },
    'https://test-dataplane7.tableau.sfdc-ckzqgc.svc.sfdcfc.net': {
      sites: {
        'mcp-test-vnext': {
          datasources: {
            'Superstore Datasource': { id: '39974b17-887b-479e-930f-9bc4136e85fa' },
          },
          workbooks: {
            Superstore: {
              id: '44bb9110-456f-4b26-a82f-4d9d9271f1af',
              defaultView: {
                id: 'f19c1ed1-7294-45e8-818e-dbc6814bb19c',
                customViewId: 'e55e08c2-72d1-4627-be48-614d02f17bd8',
              },
            },
          },
          pulse: {
            definitions: {},
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
