import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../config.js';
import { useRestApi } from '../restApiInstance.js';
import { Datasource, Query, TableauError } from '../sdks/tableau/apis/vizqlDataServiceApi.js';
import { Server } from '../server.js';
import { Tool } from './tool.js';
import { getDatasourceCredentials } from './queryDatasource/datasourceCredentials.js';
import { handleQueryDatasourceError } from './queryDatasource/queryDatasourceErrorHandler.js';

// Hardcoded datasource LUID
const HARDCODED_DATASOURCE_LUID = '71db762b-6201-466b-93da-57cc0aec8ed9';

type Datasource = z.infer<typeof Datasource>;

const paramsSchema = {
    id: z.string().describe('ID of the resource to fetch'),
};

export const getFetchTool = (server: Server): Tool<typeof paramsSchema> => {
    const fetchTool = new Tool({
        server,
        name: 'fetch',
        description: 'Retrieves detailed content for a specific resource identified by the given ID.',
        paramsSchema,
        annotations: {
            title: 'Fetch',
            readOnlyHint: true,
            openWorldHint: false,
        },
        callback: async ({ id }, { requestId }): Promise<CallToolResult> => {
            const config = getConfig();
            return await fetchTool.logAndExecute({
                requestId,
                args: { id },
                callback: async () => {
                    // Parse the field ID to create a simple query
                    const fieldName = id.replace('field_', '').replace(/\d+$/, '');

                    // Create a basic query structure
                    const query: z.infer<typeof Query> = {
                        fields: [
                            {
                                fieldCaption: fieldName || 'Category', // Fallback to a common field
                            },
                        ],
                    };

                    const datasource: Datasource = { datasourceLuid: HARDCODED_DATASOURCE_LUID };
                    const options = {
                        returnFormat: 'OBJECTS',
                        debug: true,
                        disaggregate: false,
                    } as const;

                    const credentials = getDatasourceCredentials(HARDCODED_DATASOURCE_LUID);
                    if (credentials) {
                        datasource.connections = credentials;
                    }

                    const queryRequest = {
                        datasource,
                        query,
                        options,
                    };

                    const result = await useRestApi(
                        config.server,
                        config.authConfig,
                        requestId,
                        server,
                        async (restApi) => {
                            return await restApi.vizqlDataServiceMethods.queryDatasource(queryRequest);
                        },
                    );

                    // Format response for ChatGPT's expected format
                    let text = 'No data available';
                    if (result.ok && result.val.data && Array.isArray(result.val.data)) {
                        text = `Data retrieved for field ${fieldName}:\n\n`;
                        text += JSON.stringify(result.val.data.slice(0, 10), null, 2); // Limit to first 10 rows
                        if (result.val.data.length > 10) {
                            text += `\n\n... and ${result.val.data.length - 10} more rows`;
                        }
                    }

                    return new Ok({
                        id,
                        title: `Data for ${fieldName}`,
                        text,
                    });
                },
                getErrorText: (error: z.infer<typeof TableauError>) => {
                    return JSON.stringify({ requestId, ...handleQueryDatasourceError(error) });
                },
            });
        },
    });

    return fetchTool;
}; 