import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SetLevelRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import pkg from '../package.json' with { type: 'json' };
import { getConfig } from './config.js';
import { setLogLevel } from './logging/log.js';
import { useRestApi } from './restApiInstance.js';
import { Connection } from './sdks/tableau/types/connection.js';
import { Tool } from './tools/tool.js';
import { toolNames } from './tools/toolName.js';
import { toolFactories } from './tools/tools.js';
import { paginate } from './utils/paginate.js';

export const serverName = pkg.name;
export const serverVersion = pkg.version;

export class Server extends McpServer {
  private _isConnected = false;
  readonly name: string;
  readonly version: string;

  constructor() {
    const { provideDatasourceResources, auth } = getConfig();

    // The queryWorkbookConnections REST API method does not support scoped JWTs; it will 401 when auth is direct-trust.
    // If we add additional resources that do not rely on this API, we can remove this check and conditionally register
    // the top-datasources resource instead.
    const supportsResources = provideDatasourceResources && auth !== 'direct-trust';

    super(
      {
        name: serverName,
        version: serverVersion,
      },
      {
        capabilities: {
          logging: {},
          tools: {},
          ...(supportsResources ? { resources: { listChanged: true } } : {}),
        },
      },
    );

    this.name = serverName;
    this.version = serverVersion;
  }

  registerTools = (): void => {
    for (const {
      name,
      description,
      paramsSchema,
      annotations,
      callback,
    } of this._getToolsToRegister()) {
      this.tool(name, description, paramsSchema, annotations, callback);
    }
  };

  registerResources = async (): Promise<void> => {
    const config = getConfig();
    if (!config.provideDatasourceResources) {
      return;
    }

    const datasources = await useRestApi({
      config,
      requestId: 'list-resource: datasources',
      server: this,
      jwtScopes: ['tableau:content:read'],
      callback: async (restApi) => {
        const pageConfig = {
          pageSize: 100,
          limit: config.maxResultLimit ? Math.min(config.maxResultLimit, 100) : 100,
        };

        const views = await paginate({
          pageConfig,
          getDataFn: async (pageConfig) => {
            const { pagination, views: data } = await restApi.viewsMethods.queryViewsForSite({
              siteId: restApi.siteId,
              filter: '',
              includeUsageStatistics: true,
              pageSize: pageConfig.pageSize,
              pageNumber: pageConfig.pageNumber,
            });

            return { pagination, data };
          },
        });

        const top100Views = views
          .sort((v1, v2) => (v2.usage?.totalViewCount ?? 0) - (v1.usage?.totalViewCount ?? 0))
          .slice(0, 100);

        const top10Workbooks = new Set<string>();
        for (const view of top100Views) {
          if (view.workbook?.id) {
            top10Workbooks.add(view.workbook.id);
            if (top10Workbooks.size === 10) {
              break;
            }
          }
        }

        const workbookConnections = (
          await Promise.all(
            [...top10Workbooks].map((workbookId) =>
              restApi.workbooksMethods.queryWorkbookConnections({
                workbookId,
                siteId: restApi.siteId,
              }),
            ),
          )
        ).flat();

        const datasources: Set<NonNullable<Connection['datasource']>> = new Set();
        for (const { datasource } of workbookConnections) {
          if (datasource) {
            datasources.add(datasource);
          }
        }

        return [...datasources];
      },
    });

    for (const ds of datasources) {
      this.resource(
        `Data Source: ${ds.id}`,
        `file:///tableaumcp/datasources/${ds.id}.json`,
        { title: ds.name },
        (uri) => ({
          contents: [
            {
              text: JSON.stringify({
                datasource: {
                  name: ds.name,
                  id: ds.id,
                },
              }),
              title: ds.name,
              mimeType: 'application/json',
              uri: uri.href,
            },
          ],
        }),
      );
    }
  };

  registerRequestHandlers = (): void => {
    this.server.setRequestHandler(SetLevelRequestSchema, async (request) => {
      setLogLevel(this, request.params.level);
      return {};
    });
  };

  private _getToolsToRegister = (): Array<Tool<any>> => {
    const { includeTools, excludeTools } = getConfig();

    const tools = toolFactories.map((tool) => tool(this));
    const toolsToRegister = tools.filter((tool) => {
      if (includeTools.length > 0) {
        return includeTools.includes(tool.name);
      }

      if (excludeTools.length > 0) {
        return !excludeTools.includes(tool.name);
      }

      return true;
    });

    if (toolsToRegister.length === 0) {
      throw new Error(`
          No tools to register.
          Tools available = [${toolNames.join(', ')}].
          EXCLUDE_TOOLS = [${excludeTools.join(', ')}].
          INCLUDE_TOOLS = [${includeTools.join(', ')}]
        `);
    }

    return toolsToRegister;
  };
}

export const exportedForTesting = {
  Server,
};
