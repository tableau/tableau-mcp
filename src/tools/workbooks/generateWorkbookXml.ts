import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { Server } from '../../server.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { Tool } from '../tool.js';
import { buildWorkbookXml } from './buildWorkbookXml.js';

const paramsSchema = {
  datasourceRepositoryURL: z.string().trim().nonempty(),
  publishedDatasourceId: z.string().trim().nonempty(),
  // Optional overrides; sensible defaults are derived from config and datasourceRepositoryURL
  datasourceCaption: z.string().trim().nonempty().optional(),
  revision: z.string().trim().nonempty().default('1.0').optional(),
  worksheetName: z.string().trim().nonempty().default('Sheet 1').optional(),
} as const;

export type GenerateWorkbookXmlError = {
  type: 'datasource-not-allowed';
  message: string;
};

export const getGenerateWorkbookXmlTool = (server: Server): Tool<typeof paramsSchema> => {
  const generateWorkbookXmlTool = new Tool({
    server,
    name: 'generate-workbook-xml',
    description: `
Generates a Tableau TWB (workbook) XML string that connects to a specified published datasource (Data Server). Use the output to save a .twb file.

**Parameters:**
- \`datasourceRepositoryURL\` (required): The location of the data source the workbook will connect to. used to construct the full datasource url e.g. \`t/tc25/datasources/test-datasource\` for a site named tc25.
- \`publishedDatasourceId\` (required): The published datasource's ID.
- \`datasourceCaption\` (optional): The caption of the data source in the workbook.  Defaults to \`datasourceRepositoryURL\`.
- \`revision\` (optional): The revision of the data source.  Defaults to \`1.0\`.
- \`worksheetName\` (optional): The name of the worksheet in the workbook.  Defaults to \`Sheet 1\`.
`,
    paramsSchema,
    annotations: {
      title: 'Generate Workbook XML',
      readOnlyHint: false,
      openWorldHint: false,
    },
    callback: async (
      { datasourceRepositoryURL, publishedDatasourceId, datasourceCaption, revision, worksheetName },
      { requestId, authInfo },
    ): Promise<CallToolResult> => {
      const config = getConfig();
      return await generateWorkbookXmlTool.logAndExecute<string, GenerateWorkbookXmlError>({
        requestId,
        authInfo,
        args: { datasourceRepositoryURL, publishedDatasourceId, datasourceCaption, revision, worksheetName },
        callback: async () => {
          const isDatasourceAllowedResult = await resourceAccessChecker.isDatasourceAllowed({
            datasourceLuid: publishedDatasourceId,
            restApiArgs: { config, requestId, server },
          });

          if (!isDatasourceAllowedResult.allowed) {
            return new Err({
              type: 'datasource-not-allowed',
              message: [
                'The set of allowed data sources that can be used to generate a workbook is limited by the server configuration.',
                `Generating a workbook using the datasource with LUID ${publishedDatasourceId} is not allowed.`,
              ].join(' '),
            });
          }

          const url = new URL(config.server);
          const channel = url.protocol === 'https:' ? 'https' : 'http';
          const defaultPort = channel === 'https' ? '443' : '80';
          const port = url.port && url.port !== '0' ? url.port : defaultPort;
          const siteName = config.siteName;

          const finalCaption = datasourceCaption?.trim() || datasourceRepositoryURL;
          const finalRevision = (revision ?? '1.0').trim();
          const finalWorksheetName = (worksheetName ?? 'Sheet 1').trim();

          const xml = buildWorkbookXml({
            siteName,
            hostname: url.hostname,
            port,
            channel,
            datasourceRepositoryURL: datasourceRepositoryURL,
            datasourceCaption: finalCaption,
            publishedDatasourceId,
            revision: finalRevision,
            worksheetName: finalWorksheetName,
          });

          return new Ok(xml);
        },
        constrainSuccessResult: (xml) => {
          return {
            type: 'success',
            result: xml,
          };
        },
        getErrorText: (error: GenerateWorkbookXmlError) => {
          switch (error.type) {
            case 'datasource-not-allowed':
              return error.message;
          }
        },
      });
    },
  });

  return generateWorkbookXmlTool;
};
