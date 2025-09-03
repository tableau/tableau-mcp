import invariant from '../src/utils/invariant.js';

type EnvironmentData = {
  servers: {
    [url: string]: {
      sites: {
        [name: string]: {
          datasources: {
            [name: string]: { id: string };
          };
        };
      };
    };
  };
};

const environmentData: EnvironmentData = {
  servers: {
    'https://10ax.online.tableau.com/': {
      sites: {
        'mcp-test': {
          datasources: {
            'Superstore Datasource': { id: '2d935df8-fe7e-4fd8-bb14-35eb4ba31d45' },
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
): { id: string } {
  invariant(environmentData.servers[server], `Server ${server} not found`);
  invariant(environmentData.servers[server].sites[siteName], `Site ${siteName} not found`);
  invariant(
    environmentData.servers[server].sites[siteName].datasources[datasourceName],
    `Datasource ${datasourceName} not found`,
  );

  return environmentData.servers[server].sites[siteName].datasources[datasourceName];
}
