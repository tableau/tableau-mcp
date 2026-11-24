export function qualifyDatasourceColumn(datasourceInternalName: string, column: string): string {
  return `[${datasourceInternalName}].[${stripBrackets(column)}]`;
}

function stripBrackets(value: string): string {
  return value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
}
