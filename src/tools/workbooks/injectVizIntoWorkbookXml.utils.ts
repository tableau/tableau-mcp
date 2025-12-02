import { z } from 'zod';

export const aggEnum = z.enum(['SUM', 'AVG', 'MIN', 'MAX', 'COUNT', 'COUNTD']);
export type Aggregation = z.infer<typeof aggEnum>;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toDerivation(aggregation?: Aggregation): string {
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

function toAggToken(aggregation?: Aggregation): string {
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

export function getDatasourceInfo(xml: string): { connectionName: string; caption: string } {
  const nameMatch = findFirstMatch(/<datasource[^>]*\bname='([^']+)'/i, xml);
  const captionMatch = findFirstMatch(/<datasource[^>]*\bcaption='([^']*)'/i, xml);
  return {
    connectionName: nameMatch?.[1] ?? '',
    caption: captionMatch?.[1] ?? '',
  };
}

export function buildViewBlock({
  connectionName,
  datasourceCaption,
  columns,
  rows,
}: {
  connectionName: string;
  datasourceCaption: string;
  columns: string[];
  rows: Array<{ field: string; aggregation?: Aggregation }>;
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

export function buildShelfToken(
  connectionName: string,
  field: string,
  kind: 'dimension' | 'measure',
  aggregation?: Aggregation,
): string {
  if (kind === 'dimension') {
    return `[${connectionName}].[none:${field}:nk]`;
  }
  return `[${connectionName}].[${toAggToken(aggregation)}:${field}:qk]`;
}

export function replaceWorksheetContents({
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
