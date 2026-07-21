/**
 * Field builder utilities for constructing column references from user-friendly names
 */

import { normalizeArray, parseXML } from './parser.js';
import {
  AggregationType,
  type FieldReference,
  type ParsedColumn,
  ParsedColumnInstance,
  ParsedDatasourceDependencies,
} from './types.js';

function inferRoleFromType(localType: string | undefined): string {
  if (!localType) return 'dimension';
  switch (localType) {
    case 'integer':
    case 'real':
      return 'measure';
    default:
      return 'dimension';
  }
}

function inferFieldTypeFromType(localType: string | undefined): string {
  if (!localType) return 'nominal';
  switch (localType) {
    case 'integer':
    case 'real':
    case 'date':
    case 'datetime':
      return 'quantitative';
    default:
      return 'nominal';
  }
}

/**
 * Find a field in the workbook's first datasource
 * @param workbookXml - Full workbook XML
 * @param fieldName - User-friendly field name (e.g., "Profit", "sum of Profit", "Category")
 * @param aggregation - Optional aggregation type (if not provided, will parse from fieldName or use defaults)
 * @returns FieldReference object or null if not found
 */
export function findField(
  workbookXml: string,
  fieldName: string,
  aggregation?: AggregationType,
): FieldReference | null {
  const workbook = parseXML(workbookXml);

  // Find first datasource in first worksheet
  const worksheets = normalizeArray(workbook.workbook?.worksheets?.worksheet);
  if (worksheets.length === 0) {
    return null;
  }

  const firstWorksheet = worksheets[0];
  const datasources = normalizeArray(firstWorksheet.table?.view?.datasources?.datasource);
  if (datasources.length === 0) {
    return null;
  }

  const datasourceName = datasources[0]['@_name'];
  if (!datasourceName) {
    return null;
  }

  // Find datasource-dependencies for this datasource
  const dependencies = normalizeArray(firstWorksheet.table?.view?.['datasource-dependencies']);
  const datasourceDeps = dependencies.find(
    (dep: ParsedDatasourceDependencies) => dep['@_datasource'] === datasourceName,
  );

  if (!datasourceDeps) {
    return null;
  }

  // Parse aggregation from fieldName if not provided
  let parsedAggregation = aggregation;
  let cleanFieldName = fieldName.trim();

  if (!parsedAggregation) {
    // Try to parse aggregation from fieldName (e.g., "sum of Profit", "avg of Sales")
    const lowerName = cleanFieldName.toLowerCase();
    if (lowerName.startsWith('sum of ')) {
      parsedAggregation = AggregationType.Sum;
      cleanFieldName = cleanFieldName.substring(7).trim();
    } else if (lowerName.startsWith('avg of ') || lowerName.startsWith('average of ')) {
      parsedAggregation = AggregationType.Avg;
      cleanFieldName = lowerName.startsWith('avg of ')
        ? cleanFieldName.substring(7).trim()
        : cleanFieldName.substring(11).trim();
    } else if (lowerName.startsWith('min of ')) {
      parsedAggregation = AggregationType.Min;
      cleanFieldName = cleanFieldName.substring(7).trim();
    } else if (lowerName.startsWith('max of ')) {
      parsedAggregation = AggregationType.Max;
      cleanFieldName = cleanFieldName.substring(7).trim();
    } else if (lowerName.startsWith('count of ')) {
      parsedAggregation = AggregationType.Count;
      cleanFieldName = cleanFieldName.substring(9).trim();
    } else if (lowerName.startsWith('count distinct of ')) {
      parsedAggregation = AggregationType.CountDistinct;
      cleanFieldName = cleanFieldName.substring(18).trim();
    }
  }

  // Strip brackets from field name for matching
  const searchName = cleanFieldName.replace(/^\[|\]$/g, '');

  // Search columns (case-sensitive)
  const columns = normalizeArray(datasourceDeps.column);
  let matchedColumn: ParsedColumn | null = null;

  for (const column of columns) {
    const columnName = column['@_name']?.replace(/^\[|\]$/g, '') || '';

    // Match by name (case-sensitive)
    if (columnName === searchName) {
      matchedColumn = column;
      break;
    }

    // Also check caption for calculated fields
    if (column['@_caption'] && column['@_caption'] === searchName) {
      matchedColumn = column;
      break;
    }
  }

  if (!matchedColumn) {
    return null;
  }

  // Determine default aggregation if not specified
  const role = matchedColumn['@_role'];
  if (!parsedAggregation) {
    if (role === 'dimension') {
      parsedAggregation = AggregationType.None;
    } else if (role === 'measure') {
      parsedAggregation = AggregationType.Sum;
    } else {
      parsedAggregation = AggregationType.None;
    }
  }

  // Find matching column-instance
  const columnInstances = normalizeArray(datasourceDeps['column-instance']);
  let matchedInstance: ParsedColumnInstance | null = null;

  for (const instance of columnInstances) {
    if (
      instance['@_column'] === matchedColumn['@_name'] &&
      instance['@_derivation'] === (parsedAggregation as string)
    ) {
      matchedInstance = instance;
      break;
    }
  }

  // If no exact match, try to find one with the right column (might need to create)
  if (!matchedInstance) {
    // For calculated fields (User derivation), we might not find a match
    // In that case, we'll need to construct the column-instance name
    if (parsedAggregation === AggregationType.User) {
      // This is a calculated field - we'd need the actual instance name
      // For now, return what we can
      return {
        datasource: datasourceName,
        columnName: matchedColumn['@_name'],
        columnInstanceName: '', // Will need to be constructed
        derivation: parsedAggregation,
        type: matchedColumn['@_type'],
        role: role,
        datatype: matchedColumn['@_datatype'],
        caption: matchedColumn['@_caption'],
      };
    }

    // Try to find any instance with this column
    for (const instance of columnInstances) {
      if (instance['@_column'] === matchedColumn['@_name']) {
        matchedInstance = instance;
        break;
      }
    }
  }

  if (!matchedInstance) {
    // Construct column-instance name based on pattern
    const columnName = matchedColumn['@_name'].replace(/^\[|\]$/g, '');
    const typeSuffix = matchedColumn['@_type'] === 'quantitative' ? 'qk' : 'nk';
    let prefix = 'none';

    if (parsedAggregation === AggregationType.Sum) prefix = 'sum';
    else if (parsedAggregation === AggregationType.Avg) prefix = 'avg';
    else if (parsedAggregation === AggregationType.Min) prefix = 'min';
    else if (parsedAggregation === AggregationType.Max) prefix = 'max';
    else if (parsedAggregation === AggregationType.Count) prefix = 'count';
    else if (parsedAggregation === AggregationType.CountDistinct) prefix = 'countdistinct';
    else if (parsedAggregation === AggregationType.User) prefix = 'usr';

    const constructedName = `[${prefix}:${columnName}:${typeSuffix}]`;

    return {
      datasource: datasourceName,
      columnName: matchedColumn['@_name'],
      columnInstanceName: constructedName,
      derivation: parsedAggregation,
      type: matchedColumn['@_type'],
      role: role,
      datatype: matchedColumn['@_datatype'],
      caption: matchedColumn['@_caption'],
    };
  }

  return {
    datasource: datasourceName,
    columnName: matchedColumn['@_name'],
    columnInstanceName: matchedInstance['@_name'],
    derivation: parsedAggregation,
    type: matchedColumn['@_type'],
    role: role,
    datatype: matchedColumn['@_datatype'],
    caption: matchedColumn['@_caption'],
  };
}

/**
 * Build a full column reference string from FieldReference
 * @param fieldRef - FieldReference object
 * @returns Column reference string in format: [Datasource Name].[column-instance-name]
 * Note: columnInstanceName should already include brackets (e.g., "[sum:Profit:qk]")
 */
export function buildColumnRef(fieldRef: FieldReference): string {
  // columnInstanceName already has brackets, so just concatenate
  return `[${fieldRef.datasource}].${fieldRef.columnInstanceName}`;
}

/**
 * Helper to find field and build column reference in one call
 * @param workbookXml - Full workbook XML
 * @param fieldName - User-friendly field name
 * @param aggregation - Optional aggregation type
 * @returns Column reference string or null if field not found
 */
export function findAndBuildColumnRef(
  workbookXml: string,
  fieldName: string,
  aggregation?: AggregationType,
): string | null {
  const fieldRef = findField(workbookXml, fieldName, aggregation);
  if (!fieldRef) {
    return null;
  }
  return buildColumnRef(fieldRef);
}

/**
 * List all available fields from the workbook's datasources
 * @param workbookXml - Full workbook XML
 * @returns Array of FieldReference objects with column_ref strings
 */
export function listAvailableFields(
  workbookXml: string,
): Array<FieldReference & { column_ref: string }> {
  const workbook = parseXML(workbookXml);

  // Look at workbook-level datasources
  const datasources = normalizeArray(workbook.workbook?.datasources?.datasource);
  if (datasources.length === 0) {
    return [];
  }

  const results: Array<FieldReference & { column_ref: string }> = [];

  // Process each datasource (skip Parameters)
  for (const datasource of datasources) {
    const datasourceName = datasource['@_name'];
    if (!datasourceName || datasourceName === 'Parameters') continue;

    // A PUBLISHED datasource carries a repository-location whose id is its
    // contentUrl (the input resolve-datasource-luid needs). Embedded/local
    // datasources have no repository-location, so this stays undefined.
    const contentUrl = datasource['repository-location']?.['@_id'];

    // Map to track all columns by name (to deduplicate)
    const columnMap = new Map<
      string,
      { column: any; source: 'top-level' | 'relation' | 'metadata-record' }
    >();

    // Build folder lookup: field name -> folder name
    const folderMap = new Map<string, string>();
    const foldersCommon = datasource['folders-common'];
    if (foldersCommon) {
      const folders = normalizeArray(foldersCommon.folder);
      for (const folder of folders) {
        const folderName = folder['@_name'];
        if (!folderName) continue;
        const folderItems = normalizeArray(folder['folder-item']);
        for (const item of folderItems) {
          if (item['@_type'] === 'field' && item['@_name']) {
            folderMap.set(item['@_name'], folderName);
          }
        }
      }
    }

    // 1. Get top-level columns from datasource (these have role, type metadata)
    const topLevelColumns = normalizeArray(datasource.column);
    for (const column of topLevelColumns) {
      const columnName = column['@_name'];
      if (columnName) {
        columnMap.set(columnName, { column, source: 'top-level' });
      }
    }

    // 2. Get columns from connection relations (raw table columns)
    if (datasource.connection) {
      const relations = normalizeArray(datasource.connection.relation);
      for (const relation of relations) {
        const nestedRelations = normalizeArray(relation.relation);
        const allRelations = nestedRelations.length > 0 ? nestedRelations : [relation];

        for (const rel of allRelations) {
          if (rel.columns && rel.columns.column) {
            const relationColumns = normalizeArray(rel.columns.column);
            for (const column of relationColumns) {
              const columnName = column['@_name'];
              if (columnName) {
                const bracketedName = columnName.startsWith('[') ? columnName : `[${columnName}]`;
                if (!columnMap.has(bracketedName)) {
                  columnMap.set(bracketedName, { column, source: 'relation' });
                }
              }
            }
          }
        }
      }

      // 3. Get columns from metadata-records (covers fields only defined at the connection level)
      const metadataRecords = datasource.connection['metadata-records'];
      if (metadataRecords) {
        const records = normalizeArray(metadataRecords['metadata-record']);
        for (const record of records) {
          if (record['@_class'] !== 'column') continue;
          const localName = record['local-name'];
          if (!localName) continue;
          const bracketedName = localName.startsWith('[') ? localName : `[${localName}]`;
          if (!columnMap.has(bracketedName)) {
            columnMap.set(bracketedName, {
              column: {
                '@_name': bracketedName,
                '@_datatype': record['local-type'],
                '@_role': inferRoleFromType(record['local-type']),
                '@_type': inferFieldTypeFromType(record['local-type']),
                '@_caption': record['remote-alias'] || record['remote-name'],
                _aggregation: record.aggregation,
              },
              source: 'metadata-record',
            });
          }
        }
      }
    }

    // 4. Process all columns
    for (const [columnName, { column, source }] of columnMap.entries()) {
      if (columnName.includes('__tableau_internal_')) continue;

      const cleanNameTest = columnName.replace(/^\[|\]$/g, '');
      if (cleanNameTest.includes('[') || cleanNameTest.includes(']')) continue;

      let role: string;
      let type: string;
      let datatype: string;
      let caption: string | undefined;
      let semanticRole: string | undefined;

      let isAggregated = false;
      let formula: string | undefined;

      if (source === 'top-level') {
        role = column['@_role'];
        type = column['@_type'];
        datatype = column['@_datatype'];
        caption = column['@_caption'];
        semanticRole = column['@_semantic-role'];

        if (column.calculation && column.calculation['@_formula']) {
          formula = column.calculation['@_formula'];
          const aggFunctions = [
            'SUM(',
            'AVG(',
            'MIN(',
            'MAX(',
            'COUNT(',
            'COUNTD(',
            'STDEV(',
            'STDEVP(',
            'VAR(',
            'VARP(',
            'MEDIAN(',
            'PERCENTILE(',
          ];
          isAggregated = aggFunctions.some((fn) => formula!.toUpperCase().includes(fn));
        }

        if (column['@_hidden'] === 'true') continue;
      } else if (source === 'metadata-record') {
        role = column['@_role'];
        type = column['@_type'];
        datatype = column['@_datatype'];
        caption = column['@_caption'];
        semanticRole = column['@_semantic-role'];
      } else {
        datatype = column['@_datatype'];
        caption = undefined;

        if (datatype === 'integer' || datatype === 'real') {
          role = 'measure';
          type = 'quantitative';
        } else if (datatype === 'date' || datatype === 'datetime') {
          role = 'dimension';
          type = 'quantitative';
        } else {
          role = 'dimension';
          type = 'nominal';
        }
      }

      // Determine default aggregation based on role
      // If field is already aggregated (calculated field with aggregation), use User
      const defaultAgg = isAggregated
        ? AggregationType.User
        : role === 'measure'
          ? AggregationType.Sum
          : AggregationType.None;

      // Construct column-instance name
      const cleanName = columnName.replace(/^\[|\]$/g, '');
      const typeSuffix = type === 'quantitative' ? 'qk' : type === 'ordinal' ? 'ok' : 'nk'; // nominal and other types
      const prefix = isAggregated ? 'usr' : defaultAgg === AggregationType.Sum ? 'sum' : 'none';
      const constructedInstance = `[${prefix}:${cleanName}:${typeSuffix}]`;

      const folder = folderMap.get(columnName);

      const fieldRef: FieldReference = {
        datasource: datasourceName,
        contentUrl: contentUrl,
        columnName: columnName,
        columnInstanceName: constructedInstance,
        derivation: defaultAgg,
        type: type,
        role: role,
        datatype: datatype,
        caption: caption,
        semanticRole: semanticRole,
        isAggregated: isAggregated,
        formula: formula,
        folder: folder,
      };

      results.push({
        ...fieldRef,
        column_ref: buildColumnRef(fieldRef),
      });
    }
  }

  return results;
}
