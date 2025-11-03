import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { Server } from '../../server.js';
import { Tool } from '../tool.js';

const aggEnum = z.enum(['SUM', 'AVG', 'MIN', 'MAX', 'COUNT', 'COUNTD']);

const paramsSchema = {
  workbookXml: z.string().min(1),
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

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toDerivation(aggregation?: z.infer<typeof aggEnum>): string {
  switch (aggregation) {
    case 'AVG':
      return 'Avg';
    case 'MIN':
      return 'Min';
    case 'MAX':
      return 'Max';
    case 'COUNT':
      return 'Count';
    case 'COUNTD':
      return 'Count Distinct';
    case 'SUM':
    default:
      return 'Sum';
  }
}

function toAggToken(aggregation?: z.infer<typeof aggEnum>): string {
  switch (aggregation) {
    case 'AVG':
      return 'avg';
    case 'MIN':
      return 'min';
    case 'MAX':
      return 'max';
    case 'COUNT':
      return 'count';
    case 'COUNTD':
      return 'countd';
    case 'SUM':
    default:
      return 'sum';
  }
}

function findFirstMatch(regex: RegExp, text: string): RegExpMatchArray | null {
  regex.lastIndex = 0;
  return text.match(regex);
}

function getDatasourceInfo(xml: string): { connectionName: string; caption: string } {
  const nameMatch = findFirstMatch(/<datasource[^>]*\bname='([^']+)'/i, xml);
  const captionMatch = findFirstMatch(/<datasource[^>]*\bcaption='([^']*)'/i, xml);
  return {
    connectionName: nameMatch?.[1] ?? '',
    caption: captionMatch?.[1] ?? '',
  };
}

function buildViewBlock({
  connectionName,
  datasourceCaption,
  columns,
  rows,
}: {
  connectionName: string;
  datasourceCaption: string;
  columns: string[];
  rows: Array<{ field: string; aggregation?: z.infer<typeof aggEnum> }>;
}): string {
  const dsTag = `<datasource caption='${escapeXml(datasourceCaption)}' name='${escapeXml(connectionName)}' />`;

  const columnInstances: string[] = [];
  for (const col of columns) {
    columnInstances.push(
      `<column-instance column='[${escapeXml(col)}]' derivation='None' name='[none:${escapeXml(
        col,
      )}:nk]' pivot='key' type='nominal' />`,
    );
  }
  for (const row of rows) {
    const derivation = toDerivation(row.aggregation);
    const aggToken = toAggToken(row.aggregation);
    columnInstances.push(
      `<column-instance column='[${escapeXml(row.field)}]' derivation='${derivation}' name='[${aggToken}:${escapeXml(
        row.field,
      )}:qk]' pivot='key' type='quantitative' />`,
    );
  }

  return [
    '<view>',
    '  <datasources>',
    `    ${dsTag}`,
    '  </datasources>',
    `  <datasource-dependencies datasource='${escapeXml(connectionName)}'>`,
    ...columnInstances.map((ci) => `    ${ci}`),
    '  </datasource-dependencies>',
    "  <aggregation value='true' />",
    '</view>',
  ].join('\n');
}

function buildShelfToken(
  connectionName: string,
  field: string,
  kind: 'dimension' | 'measure',
  aggregation?: z.infer<typeof aggEnum>,
): string {
  if (kind === 'dimension') {
    return `[${connectionName}].[none:${field}:nk]`;
  }
  return `[${connectionName}].[${toAggToken(aggregation)}:${field}:qk]`;
}

function replaceWorksheetContents({
  xml,
  worksheetName,
  newViewBlock,
  newRows,
  newCols,
}: {
  xml: string;
  worksheetName?: string;
  newViewBlock: string;
  newRows: string;
  newCols: string;
}): string {
  // Match the target worksheet block
  const worksheetRegex = worksheetName
    ? new RegExp(
        `(<worksheet\\s+name='${worksheetName.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}'>[\\s\\S]*?<\\/worksheet>)`,
        'i',
      )
    : /(<worksheet\s+name='[^']+'>([\s\S]*?)<\/worksheet>)/i;

  const match = xml.match(worksheetRegex);
  if (!match) {
    return xml; // no change if target worksheet not found
  }

  const worksheetBlock = match[0];

  // Replace <view> ... </view> inside the worksheet block
  const viewRegex = /<view>[\s\S]*?<\/view>/i;
  let updatedBlock = worksheetBlock.replace(viewRegex, newViewBlock);

  // Replace <rows .../ or <rows>...</rows>
  const rowsSelfClosing = /<rows\s*\/>/i;
  const rowsBlock = /<rows>[\s\S]*?<\/rows>/i;
  if (rowsSelfClosing.test(updatedBlock)) {
    updatedBlock = updatedBlock.replace(rowsSelfClosing, `<rows>${newRows}</rows>`);
  } else if (rowsBlock.test(updatedBlock)) {
    updatedBlock = updatedBlock.replace(rowsBlock, `<rows>${newRows}</rows>`);
  }

  // Replace <cols .../ or <cols>...</cols>
  const colsSelfClosing = /<cols\s*\/>/i;
  const colsBlock = /<cols>[\s\S]*?<\/cols>/i;
  if (colsSelfClosing.test(updatedBlock)) {
    updatedBlock = updatedBlock.replace(colsSelfClosing, `<cols>${newCols}</cols>`);
  } else if (colsBlock.test(updatedBlock)) {
    updatedBlock = updatedBlock.replace(colsBlock, `<cols>${newCols}</cols>`);
  }

  // Replace the worksheet block in the original XML
  return xml.replace(worksheetBlock, updatedBlock);
}

export const getInjectVizIntoWorkbookXmlTool = (server: Server): Tool<typeof paramsSchema> => {
  const injectTool = new Tool({
    server,
    name: 'inject-viz-into-workbook-xml',
    description: `Takes a TWB XML workbook string and injects a basic visualization by wiring columns (dimensions) and rows (measures) into the first or named worksheet. It adds <datasources> and <datasource-dependencies> into the sheet's <view>, and sets <rows>/<cols> shelves.`,
    paramsSchema,
    annotations: {
      title: 'Inject Viz Into Workbook XML',
      readOnlyHint: false,
      openWorldHint: false,
    },
    callback: async (
      { workbookXml, worksheetName, datasourceConnectionName, datasourceCaption, columns, rows },
      { requestId },
    ): Promise<CallToolResult> => {
      return await injectTool.logAndExecute<string>({
        requestId,
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
