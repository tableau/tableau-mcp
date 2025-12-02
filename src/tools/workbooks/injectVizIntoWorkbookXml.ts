import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { Server } from '../../server.js';
import { Tool } from '../tool.js';
import {
  aggEnum,
  buildShelfToken,
  buildViewBlock,
  getDatasourceInfo,
  replaceWorksheetContents,
} from './injectVizIntoWorkbookXml.utils.js';

export const paramsSchema = {
  workbookXml: z.string().trim().nonempty(),
  // Optional: target a specific worksheet; if omitted, uses the first worksheet
  worksheetName: z.string().trim().nonempty().optional(),
  // Optional: target a specific datasource connection name; if omitted, uses the first datasource's name
  datasourceConnectionName: z.string().trim().nonempty().optional(),
  // Optional: caption override for the datasource reference inside <view><datasources>
  datasourceCaption: z.string().trim().nonempty().optional(),
  // Columns shelf: typically dimensions
  columns: z.array(z.string().trim().nonempty()).min(1),
  // Rows shelf: typically measures with an aggregation
  rows: z
    .array(
      z.object({
        field: z.string().trim().nonempty(),
        aggregation: aggEnum.optional(),
      }),
    )
    .min(1),
} as const;

export const getInjectVizIntoWorkbookXmlTool = (server: Server): Tool<typeof paramsSchema> => {
  const injectTool = new Tool({
    server,
    name: 'inject-viz-into-workbook-xml',
    description:
      "Takes a TWB XML workbook string and injects a basic visualization by wiring columns (dimensions) and rows (measures) into the first or named worksheet. It adds <datasources> and <datasource-dependencies> into the sheet's <view>, and sets <rows>/<cols> shelves.",
    paramsSchema,
    annotations: {
      title: 'Inject Viz Into Workbook XML',
      readOnlyHint: false,
      openWorldHint: false,
    },
    callback: async (
      { workbookXml, worksheetName, datasourceConnectionName, datasourceCaption, columns, rows },
      { requestId, authInfo },
    ): Promise<CallToolResult> => {
      return await injectTool.logAndExecute<string>({
        requestId,
        authInfo,
        args: {
          workbookXml,
          worksheetName,
          datasourceConnectionName,
          datasourceCaption,
          columns,
          rows,
        },
        callback: async () => {
          const baseDs = getDatasourceInfo(workbookXml);
          const connectionName = datasourceConnectionName?.trim() || baseDs.connectionName;
          const caption = datasourceCaption?.trim() || baseDs.caption || connectionName;

          const viewBlock = buildViewBlock({
            connectionName,
            datasourceCaption: caption,
            columns,
            rows,
          });

          const colsTokens = columns
            .map((c) => buildShelfToken(connectionName, c, 'dimension'))
            .join(' / ');
          const rowsTokens = rows
            .map((r) => buildShelfToken(connectionName, r.field, 'measure', r.aggregation))
            .join(' / ');

          const updatedXml = replaceWorksheetContents({
            xml: workbookXml,
            worksheetName,
            newViewBlock: viewBlock,
            newRows: rowsTokens,
            newCols: colsTokens,
          });

          return new Ok(updatedXml);
        },
        constrainSuccessResult: (xml) => {
          return {
            type: 'success',
            result: xml,
          };
        },
      });
    },
  });

  return injectTool;
};
