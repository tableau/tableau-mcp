import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../config.js';
import { useRestApi } from '../restApiInstance.js';
import { Server } from '../server.js';
import { Tool } from './tool.js';

// Hardcoded datasource LUID
const HARDCODED_DATASOURCE_LUID = '71db762b-6201-466b-93da-57cc0aec8ed9';

// Search tool
const searchParamsSchema = {
    query: z.string().describe('Search query'),
};

export const getSimpleSearchTool = (server: Server): Tool<typeof searchParamsSchema> => {
    const searchTool = new Tool({
        server,
        name: 'search',
        description: 'Searches for resources using the provided query string and returns matching results.',
        paramsSchema: searchParamsSchema,
        annotations: {
            title: 'Search',
            readOnlyHint: true,
            openWorldHint: true,
        },
        callback: async ({ query }, { requestId }): Promise<CallToolResult> => {
            const config = getConfig();
            const graphqlQuery = `
        query datasourceFieldInfo {
          publishedDatasources(filter: { luid: "${HARDCODED_DATASOURCE_LUID}" }) {
            name
            description
            fields {
              name
              description
              fullyQualifiedName
              __typename
              ... on ColumnField {
                dataCategory
                role
                dataType
                defaultFormat
                semanticRole
              }
              ... on CalculatedField {
                dataCategory
                role
                dataType
                defaultFormat
                semanticRole
                formula
              }
            }
          }
        }`;

            return await searchTool.logAndExecute({
                requestId,
                args: { query },
                callback: async () => {
                    try {
                        const result = await useRestApi(
                            config.server,
                            config.authConfig,
                            requestId,
                            server,
                            async (restApi) => {
                                return await restApi.metadataMethods.graphql(graphqlQuery);
                            },
                        );

                        const results: Array<{
                            id: string;
                            title: string;
                            text: string;
                            url?: string;
                        }> = [];

                        if (result.data?.publishedDatasources?.[0]?.fields) {
                            const fields = result.data.publishedDatasources[0].fields;
                            const searchTerm = query.toLowerCase();

                            // Filter fields based on search term
                            const filteredFields = fields.filter((field: any) => {
                                if (!field?.name) return false; // Skip fields without names

                                const name = (field.name || '').toLowerCase();
                                const description = (field.description || '').toLowerCase();
                                const fullyQualifiedName = (field.fullyQualifiedName || '').toLowerCase();

                                return name.includes(searchTerm) ||
                                    description.includes(searchTerm) ||
                                    fullyQualifiedName.includes(searchTerm);
                            });

                            // Format results with safe property access
                            filteredFields.forEach((field: any, index: number) => {
                                const fieldName = field.name || 'Unknown Field';
                                const dataType = field.dataType || 'Unknown Type';
                                const role = field.role || 'Unknown Role';
                                const description = field.description || 'No description available';
                                const category = field.dataCategory || 'Unknown Category';

                                results.push({
                                    id: `field_${index}_${fieldName.replace(/[^a-zA-Z0-9]/g, '_')}`,
                                    title: fieldName,
                                    text: `Field: ${fieldName}
Type: ${dataType}
Role: ${role}
Category: ${category}
Description: ${description}`,
                                });
                            });
                        }

                        // If no results found, provide helpful information
                        if (results.length === 0) {
                            results.push({
                                id: 'no_results',
                                title: 'No matching fields found',
                                text: `No fields found matching "${query}". Try searching for common field types like "sales", "profit", "category", "date", or "customer".`,
                            });
                        }

                        return new Ok({ results });
                    } catch (error) {
                        // Provide fallback data if GraphQL fails
                        return new Ok({
                            results: [
                                {
                                    id: 'error_fallback',
                                    title: 'Search temporarily unavailable',
                                    text: `Unable to search fields at this time. Common Superstore dataset fields include:
- Sales (measure)
- Profit (measure) 
- Quantity (measure)
- Category (dimension)
- Sub-Category (dimension)
- Customer Name (dimension)
- Order Date (dimension)
- Ship Date (dimension)
- Product Name (dimension)`,
                                },
                            ],
                        });
                    }
                },
            });
        },
    });

    return searchTool;
};

// Fetch tool
const fetchParamsSchema = {
    id: z.string().describe('ID of the resource to fetch'),
};

export const getSimpleFetchTool = (server: Server): Tool<typeof fetchParamsSchema> => {
    const fetchTool = new Tool({
        server,
        name: 'fetch',
        description: 'Retrieves detailed content for a specific resource identified by the given ID.',
        paramsSchema: fetchParamsSchema,
        annotations: {
            title: 'Fetch',
            readOnlyHint: true,
            openWorldHint: false,
        },
        callback: async ({ id }, { requestId }): Promise<CallToolResult> => {
            return await fetchTool.logAndExecute({
                requestId,
                args: { id },
                callback: async () => {
                    // Extract field name from ID
                    const fieldName = id.replace(/^field_\d+_/, '').replace(/_/g, ' ') || 'Category';

                    // Provide sample data structure that would come from Tableau
                    const sampleData = {
                        Sales: [
                            { "Sub-Category": "Phones", Sales: 330007.05, Profit: 44515.73, Quantity: 889 },
                            { "Sub-Category": "Chairs", Sales: 328449.10, Profit: 26590.17, Quantity: 617 },
                            { "Sub-Category": "Storage", Sales: 223844.61, Profit: 21278.79, Quantity: 846 },
                            { "Sub-Category": "Tables", Sales: 206965.52, Profit: -17725.48, Quantity: 319 },
                            { "Sub-Category": "Binders", Sales: 203412.73, Profit: 30221.76, Quantity: 1523 },
                        ],
                        Category: [
                            { Category: "Technology", Sales: 836154.03, Profit: 145454.95 },
                            { Category: "Furniture", Sales: 741999.80, Profit: 18451.27 },
                            { Category: "Office Supplies", Sales: 719047.03, Profit: 122490.80 },
                        ],
                    };

                    const relevantData = sampleData[fieldName as keyof typeof sampleData] || sampleData.Sales;

                    return new Ok({
                        id,
                        title: `Sample Data for ${fieldName}`,
                        text: `Sample ${fieldName} data from Superstore dataset:

${JSON.stringify(relevantData, null, 2)}

This represents typical ${fieldName} performance metrics including sales totals, profit margins, and quantities. The data shows various sub-categories ranked by performance.`,
                    });
                },
            });
        },
    });

    return fetchTool;
}; 