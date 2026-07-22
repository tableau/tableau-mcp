/**
 * Field management operations (CRUD for fields on encodings, rows, and cols)
 * Note: Ordering matters for all field operations
 */

import { parseColumnInstanceRef, parseDatasourceQualifiedColumnRef } from './field-resolver.js';
import { emitFieldRewrite } from './field-rewrite-listener.js';
import { normalizeArray, parseXML, serializeXML } from './parser.js';
import type { EncodingType, FieldInfo, ParsedEncoding, ParsedWorksheet } from './types.js';

/**
 * Tableau's Marks card labels the level-of-detail shelf "Detail", so an agent
 * naturally picks encoding_type="detail" — but Tableau persists LOD only as the
 * `<lod>` tag and SILENTLY STRIPS `<detail>` on apply (W-23447710 follow-up: a
 * lat/lon symbol map lost its Location pill this way and collapsed to a single
 * AVG-coordinate centroid — a blank map with a green apply). Normalize the alias
 * to the round-trip-stable tag so add/remove/move all address the same shelf.
 */
function canonicalEncodingType(encodingType: EncodingType): EncodingType {
  return encodingType === 'detail' ? 'lod' : encodingType;
}

/**
 * Helper to get worksheet from parsed XML
 */
function getWorksheet(parsed: any): ParsedWorksheet | null {
  // Handle full workbook XML: <workbook><worksheets><worksheet>...</worksheet></worksheets></workbook>
  if (parsed.workbook?.worksheets) {
    const worksheets = normalizeArray(parsed.workbook.worksheets.worksheet);
    return worksheets[0] || null;
  }
  // Handle workbook XML where root is workbook directly: <workbook><worksheet>...</worksheet></workbook>
  if (parsed.workbook?.worksheet) {
    const worksheets = normalizeArray(parsed.workbook.worksheet);
    return worksheets[0] || null;
  }
  // Handle worksheet-only XML: <worksheet>...</worksheet>
  if (parsed.worksheet) {
    // parsed.worksheet might be an array or a single object
    const worksheets = normalizeArray(parsed.worksheet);
    return worksheets[0] || null;
  }
  return null;
}

/**
 * Add a field to the encodings section of a worksheet
 * @param worksheetXml - The worksheet XML as a string (can be full workbook or just worksheet)
 * @param encodingType - Type of encoding (color, size, lod, etc.)
 * @param columnRef - Column reference (e.g., '[Sample - Superstore].[sum:Profit:qk]')
 * @param index - Optional position (0-based). If omitted, appends to end.
 * @param workbookXml - Optional workbook XML to look up datasource captions
 * @returns Modified worksheet XML
 */
export function addFieldToEncoding(
  worksheetXml: string,
  encodingType: EncodingType,
  columnRef: string,
  index?: number,
  workbookXml?: string,
): string {
  encodingType = canonicalEncodingType(encodingType);
  const parsed = parseXML(worksheetXml);
  const worksheet = getWorksheet(parsed);

  if (!worksheet) {
    throw new Error('No worksheet found in XML');
  }

  // Parse column reference to get datasource and column-instance
  const parsedRef = parseDatasourceQualifiedColumnRef(columnRef);
  if (!parsedRef) {
    throw new Error(
      `Invalid column reference format: ${columnRef}. Expected format: [Datasource Name].[column-instance-name]`,
    );
  }

  // Ensure column-instance exists in datasource-dependencies
  // This may return a corrected column-instance name (e.g., for calculated fields with aggregations)
  const correctedColumnInstanceName = ensureColumnInstanceInDependencies(
    worksheet,
    parsedRef.datasource,
    parsedRef.columnInstanceName,
    workbookXml,
  );

  // Build corrected column reference
  const correctedColumnRef = `[${parsedRef.datasource}].${correctedColumnInstanceName}`;

  // Ensure table structure exists
  if (!worksheet.table) {
    worksheet.table = {};
  }
  if (!worksheet.table.panes) {
    worksheet.table.panes = {};
  }

  // Get panes - normalizeArray may return the original array, so we need to ensure we have a mutable copy
  const panesArray = normalizeArray(worksheet.table.panes.pane);
  // Create a new array to ensure modifications are tracked
  const panes = panesArray.length > 0 ? [...panesArray] : [];

  if (panes.length === 0) {
    // Create a default pane if none exists
    panes.push({
      '@_selection-relaxation-option': 'selection-relaxation-allow',
      view: { breakdown: { '@_value': 'auto' } },
      mark: { '@_class': 'Automatic' },
    });
  }

  // Get first pane - this is a reference to the object in our new array
  const firstPane = panes[0];
  if (!firstPane.encodings) {
    firstPane.encodings = {};
  }

  // Get existing encodings
  const existingEncodings = normalizeArray(firstPane.encodings[encodingType]);

  // Check if encoding already exists (using corrected column ref)
  const alreadyExists = existingEncodings.some((enc) => enc['@_column'] === correctedColumnRef);

  if (alreadyExists) {
    throw new Error(`Encoding ${encodingType} with column ${correctedColumnRef} already exists`);
  }

  // Add new encoding at specified index or end (using corrected column ref)
  const newEncoding: ParsedEncoding = {
    '@_column': correctedColumnRef,
  };

  const updatedEncodings = [...existingEncodings];
  if (index !== undefined && index >= 0 && index <= updatedEncodings.length) {
    updatedEncodings.splice(index, 0, newEncoding);
  } else {
    updatedEncodings.push(newEncoding);
  }

  // Update encodings on the pane object - this modifies the object in our panes array
  firstPane.encodings[encodingType] =
    updatedEncodings.length === 1 ? updatedEncodings[0] : updatedEncodings;

  // If adding text encoding, automatically enable mark labels
  if (encodingType === 'text') {
    if (!firstPane.style) {
      firstPane.style = {};
    }

    // Ensure style-rule exists
    if (!firstPane.style['style-rule']) {
      firstPane.style['style-rule'] = [];
    }

    // Normalize to array
    const styleRules = Array.isArray(firstPane.style['style-rule'])
      ? firstPane.style['style-rule']
      : [firstPane.style['style-rule']];

    // Check if mark-labels-show rule already exists
    const hasLabelRule = styleRules.some(
      (rule: any) => rule['@_element'] === 'mark' && rule.format?.['@_attr'] === 'mark-labels-show',
    );

    // Add the rule if it doesn't exist
    if (!hasLabelRule) {
      styleRules.push({
        '@_element': 'mark',
        format: {
          '@_attr': 'mark-labels-show',
          '@_value': 'true',
        },
      });
    }

    // Update the style-rule back
    firstPane.style['style-rule'] = styleRules.length === 1 ? styleRules[0] : styleRules;
  }

  // CRITICAL: We need to ensure the pane object itself is updated in the array
  // Since panes is a new array but contains references to original objects,
  // we need to make sure the modified object is in the array we assign back
  panes[0] = firstPane;

  // CRITICAL: Update panes array back to worksheet structure
  // This must be done to ensure the changes are reflected in the parsed structure
  worksheet.table.panes.pane = panes.length === 1 ? panes[0] : panes;

  // Debug: Verify the encoding was added before serializing
  const verifyPanes = normalizeArray(worksheet.table.panes.pane);
  const verifyPane = verifyPanes[0];
  const verifyEncodings = normalizeArray(verifyPane?.encodings?.[encodingType]);
  const encodingAdded = verifyEncodings.some((enc: any) => enc['@_column'] === columnRef);

  if (!encodingAdded) {
    // Log detailed debug info
    console.error('Encoding verification failed:', {
      panesCount: verifyPanes.length,
      hasEncodings: !!verifyPane?.encodings,
      encodingType,
      verifyEncodingsCount: verifyEncodings.length,
      verifyEncodings: verifyEncodings,
      expectedColumnRef: columnRef,
    });
    throw new Error(
      `Failed to add encoding: encoding not found in structure after modification. Expected: ${columnRef}, Found: ${JSON.stringify(verifyEncodings)}`,
    );
  }

  return serializeXML(parsed);
}

/**
 * Remove a field from the encodings section
 * @param worksheetXml - The worksheet XML as a string
 * @param encodingType - Type of encoding to remove
 * @param columnRef - Column reference to remove
 * @returns Modified worksheet XML
 */
export function removeFieldFromEncoding(
  worksheetXml: string,
  encodingType: EncodingType,
  columnRef: string,
): string {
  encodingType = canonicalEncodingType(encodingType);
  const parsed = parseXML(worksheetXml);
  const worksheet = getWorksheet(parsed);

  if (!worksheet?.table?.panes) {
    throw new Error('No panes found in worksheet');
  }

  const panes = normalizeArray(worksheet.table.panes.pane);
  if (panes.length === 0) {
    throw new Error('No panes found');
  }

  const firstPane = panes[0];
  if (!firstPane.encodings?.[encodingType]) {
    throw new Error(`No ${encodingType} encodings found`);
  }

  const encodings = normalizeArray(firstPane.encodings[encodingType]);
  const filtered = encodings.filter((enc) => enc['@_column'] !== columnRef);

  if (filtered.length === encodings.length) {
    throw new Error(`Encoding ${encodingType} with column ${columnRef} not found`);
  }

  if (filtered.length === 0) {
    delete firstPane.encodings[encodingType];
  } else if (filtered.length === 1) {
    firstPane.encodings[encodingType] = filtered[0];
  } else {
    firstPane.encodings[encodingType] = filtered;
  }

  return serializeXML(parsed);
}

/**
 * Move a field to a new position within an encoding type
 * @param worksheetXml - The worksheet XML as a string
 * @param encodingType - Type of encoding
 * @param columnRef - Column reference to move
 * @param newIndex - New position (0-based)
 * @returns Modified worksheet XML
 */
export function moveFieldInEncoding(
  worksheetXml: string,
  encodingType: EncodingType,
  columnRef: string,
  newIndex: number,
): string {
  encodingType = canonicalEncodingType(encodingType);
  const parsed = parseXML(worksheetXml);
  const worksheet = getWorksheet(parsed);

  if (!worksheet?.table?.panes) {
    throw new Error('No panes found in worksheet');
  }

  const panes = normalizeArray(worksheet.table.panes.pane);
  if (panes.length === 0) {
    throw new Error('No panes found');
  }

  const firstPane = panes[0];
  if (!firstPane.encodings?.[encodingType]) {
    throw new Error(`No ${encodingType} encodings found`);
  }

  const encodings = normalizeArray(firstPane.encodings[encodingType]);
  const currentIndex = encodings.findIndex((enc) => enc['@_column'] === columnRef);

  if (currentIndex === -1) {
    throw new Error(`Encoding ${encodingType} with column ${columnRef} not found`);
  }

  if (newIndex < 0 || newIndex >= encodings.length) {
    throw new Error(`Invalid index ${newIndex}. Must be between 0 and ${encodings.length - 1}`);
  }

  // Move the element
  const [moved] = encodings.splice(currentIndex, 1);
  encodings.splice(newIndex, 0, moved);

  // Update encodings
  firstPane.encodings[encodingType] = encodings.length === 1 ? encodings[0] : encodings;

  return serializeXML(parsed);
}

/**
 * Add a field to the rows shelf
 * @param worksheetXml - The worksheet XML as a string
 * @param columnRef - Column reference to add
 * @param index - Optional position (0-based). If omitted, appends to end.
 * @param workbookXml - Optional workbook XML to look up datasource captions
 * @returns Modified worksheet XML
 */
export function addFieldToRows(
  worksheetXml: string,
  columnRef: string,
  index?: number,
  workbookXml?: string,
): string {
  return addFieldToShelf(worksheetXml, 'rows', columnRef, index, workbookXml);
}

/**
 * Add a field to the columns shelf
 * @param worksheetXml - The worksheet XML as a string
 * @param columnRef - Column reference to add
 * @param index - Optional position (0-based). If omitted, appends to end.
 * @param workbookXml - Optional workbook XML to look up datasource captions
 * @returns Modified worksheet XML
 */
export function addFieldToCols(
  worksheetXml: string,
  columnRef: string,
  index?: number,
  workbookXml?: string,
): string {
  return addFieldToShelf(worksheetXml, 'cols', columnRef, index, workbookXml);
}

/**
 * Remove a field from the rows shelf
 * @param worksheetXml - The worksheet XML as a string
 * @param columnRef - Column reference to remove
 * @returns Modified worksheet XML
 */
export function removeFieldFromRows(worksheetXml: string, columnRef: string): string {
  return removeFieldFromShelf(worksheetXml, 'rows', columnRef);
}

/**
 * Remove a field from the columns shelf
 * @param worksheetXml - The worksheet XML as a string
 * @param columnRef - Column reference to remove
 * @returns Modified worksheet XML
 */
export function removeFieldFromCols(worksheetXml: string, columnRef: string): string {
  return removeFieldFromShelf(worksheetXml, 'cols', columnRef);
}

/**
 * Move a field to a new position in rows
 * @param worksheetXml - The worksheet XML as a string
 * @param columnRef - Column reference to move
 * @param newIndex - New position (0-based)
 * @returns Modified worksheet XML
 */
export function moveFieldInRows(worksheetXml: string, columnRef: string, newIndex: number): string {
  return moveFieldInShelf(worksheetXml, 'rows', columnRef, newIndex);
}

/**
 * Move a field to a new position in cols
 * @param worksheetXml - The worksheet XML as a string
 * @param columnRef - Column reference to move
 * @param newIndex - New position (0-based)
 * @returns Modified worksheet XML
 */
export function moveFieldInCols(worksheetXml: string, columnRef: string, newIndex: number): string {
  return moveFieldInShelf(worksheetXml, 'cols', columnRef, newIndex);
}

/**
 * Parse a shelf value into pill refs. Shelf text uses "/" between pills, while field
 * names can also contain "/" inside bracketed column-instance refs.
 */
export function parseShelfValue(value: string | string[] | undefined): string[] {
  if (!value) {
    return [];
  }
  if (typeof value === 'string') {
    return splitShelfString(value);
  }
  if (Array.isArray(value)) {
    return value.flatMap((v) => splitShelfString(typeof v === 'string' ? v : String(v)));
  }
  return [];
}

function splitShelfString(value: string): string[] {
  const parts: string[] = [];
  let current = '';
  let bracketDepth = 0;

  const pushCurrent = (): void => {
    const trimmed = current.trim();
    if (trimmed) {
      parts.push(trimmed);
    }
    current = '';
  };

  for (const char of value) {
    if (char === '[') {
      bracketDepth += 1;
      current += char;
      continue;
    }
    if (char === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1);
      current += char;
      continue;
    }
    if (char === '/' && bracketDepth === 0) {
      pushCurrent();
      continue;
    }
    current += char;
  }

  pushCurrent();
  return parts;
}

/**
 * Internal helper to serialize shelf array to string
 */
function serializeShelfValue(fields: string[]): string {
  // Join with '/' separator (custom language format)
  return fields.join(' / ');
}

/**
 * Map lowercase derivation abbreviations to proper-case derivation names
 * Column-instance names use lowercase (e.g., [ctd:Field:qk]) but derivation attributes use proper case (CountD)
 */
function mapDerivationToProperCase(abbrev: string): string {
  const derivationMap: Record<string, string> = {
    none: 'None',
    sum: 'Sum',
    avg: 'Avg',
    min: 'Min',
    max: 'Max',
    count: 'Count',
    ctd: 'CountD', // Count Distinct
    countd: 'CountD',
    user: 'User',
    median: 'Median',
    stdev: 'Stdev',
    stdevp: 'StdevP',
    var: 'Var',
    varp: 'VarP',
    attr: 'Attr',
    // Discrete date parts. Without these, a ref like [mn:Order Date:ok] was
    // written with derivation="mn" (invalid), so Tableau silently coerced the
    // pill back to a plain date — collapsing YoY/seasonal overlays into one line.
    yr: 'Year',
    qr: 'Quarter',
    mn: 'Month',
    wk: 'Week',
    dy: 'Day',
    // Truncated (continuous) date parts use the "<Part>-Trunc" form.
    tyr: 'Year-Trunc',
    tqr: 'Quarter-Trunc',
    tmn: 'Month-Trunc',
    twk: 'Week-Trunc',
    tdy: 'Day-Trunc',
  };
  return derivationMap[abbrev.toLowerCase()] || abbrev;
}

// Date-part derivations whose column-instance type must follow the ref's pivot
// suffix (the third segment), not the base date column's type — otherwise a
// discrete month part is emitted as a continuous date type and Tableau coerces it.
const DATE_PART_DERIVATIONS = new Set<string>([
  'Year',
  'Quarter',
  'Month',
  'Week',
  'Day',
  'Year-Trunc',
  'Quarter-Trunc',
  'Month-Trunc',
  'Week-Trunc',
  'Day-Trunc',
]);

// Map a column-instance pivot suffix (qk/ok/nk) to its Tableau type; null when unknown.
function typeFromPivotSuffix(columnInstanceName: string): string | null {
  const m = columnInstanceName.match(/:([^:\]]+)\]$/);
  if (!m) return null;
  switch (m[1].toLowerCase()) {
    case 'qk':
      return 'quantitative';
    case 'ok':
      return 'ordinal';
    case 'nk':
      return 'nominal';
    default:
      return null;
  }
}

/**
 * Parse column-instance name to extract base column name and derivation
 * Format: [derivation:ColumnName:type] → { column: "[ColumnName]", derivation: "derivation" }
 */
function parseColumnInstanceName(
  columnInstanceName: string,
): { column: string; derivation: string; localFieldName: string; pivot: string } | null {
  const parsed = parseColumnInstanceRef(columnInstanceName);
  if (!parsed || !parsed.pivot) return null;

  return {
    column: `[${parsed.localFieldName}]`,
    derivation: mapDerivationToProperCase(parsed.derivation),
    localFieldName: parsed.localFieldName,
    pivot: parsed.pivot,
  };
}

/**
 * Look up datasource caption from workbook XML
 * Returns the friendly caption name for a datasource
 */
function getDatasourceCaption(
  workbookXml: string | undefined,
  datasourceName: string,
): string | undefined {
  if (!workbookXml) {
    return undefined;
  }

  try {
    const parsed = parseXML(workbookXml);
    const workbook = parsed.workbook;
    if (!workbook) {
      return undefined;
    }

    // Look for datasource definition in workbook
    const datasources = normalizeArray(workbook.datasources?.datasource);
    const ds = datasources.find((d: any) => d['@_name'] === datasourceName);
    return ds?.['@_caption'];
  } catch {
    // If parsing fails, return undefined
    return undefined;
  }
}

/**
 * Look up column definition from workbook datasource
 * Returns the full column definition including calculation elements
 */
function getColumnFromWorkbook(
  workbookXml: string | undefined,
  datasourceName: string,
  columnName: string,
): any {
  if (!workbookXml) {
    return undefined;
  }

  try {
    const parsed = parseXML(workbookXml);
    const workbook = parsed.workbook;
    if (!workbook) {
      return undefined;
    }

    // Look for datasource definition in workbook
    const datasources = normalizeArray(workbook.datasources?.datasource);
    const ds = datasources.find((d: any) => d['@_name'] === datasourceName);
    if (!ds) {
      return undefined;
    }

    // Look for column in datasource
    const columns = normalizeArray(ds.column);
    const column = columns.find((col: any) => col['@_name'] === columnName);
    return column;
  } catch {
    // If parsing fails, return undefined
    return undefined;
  }
}

/**
 * Ensure column-instance exists in datasource-dependencies
 * If it doesn't exist, adds both column and column-instance entries
 * Returns the actual column-instance name used (may be corrected for calculated fields)
 */
function ensureColumnInstanceInDependencies(
  worksheet: ParsedWorksheet,
  datasource: string,
  columnInstanceName: string,
  workbookXml?: string,
): string {
  if (!worksheet.table) {
    worksheet.table = {};
  }
  if (!worksheet.table.view) {
    worksheet.table.view = {};
  }

  // Ensure datasource exists in <datasources> section within <table><view>
  const datasourcesArray = normalizeArray(worksheet.table.view.datasources?.datasource);
  const datasources = [...datasourcesArray];
  const datasourceExists = datasources.some((ds: any) => ds['@_name'] === datasource);

  if (!datasourceExists) {
    // Look up caption from workbook if available
    const caption = getDatasourceCaption(workbookXml, datasource);

    // Create new datasource entry with caption if available
    const newDatasource: any = {
      '@_name': datasource,
    };
    if (caption) {
      newDatasource['@_caption'] = caption;
    }

    datasources.push(newDatasource);
    if (!worksheet.table.view.datasources) {
      worksheet.table.view.datasources = {};
    }
    worksheet.table.view.datasources.datasource =
      datasources.length === 1 ? datasources[0] : datasources;
  }

  // Get or create datasource-dependencies array
  // Create a new array to ensure modifications are tracked
  const depsArray = normalizeArray(worksheet.table.view['datasource-dependencies']);
  const dependencies = [...depsArray];

  let datasourceDep = dependencies.find((dep: any) => dep['@_datasource'] === datasource);

  if (!datasourceDep) {
    // Create new datasource-dependencies entry
    datasourceDep = {
      '@_datasource': datasource,
    };
    dependencies.push(datasourceDep);
  }

  // Check if column-instance already exists
  const columnInstancesArray = normalizeArray(datasourceDep['column-instance']);
  const columnInstances = [...columnInstancesArray];

  // First check if the requested column-instance exists
  let exists = columnInstances.some((ci: any) => ci['@_name'] === columnInstanceName);

  // Also parse to see if we need to correct it for calculated fields
  const parsed = parseColumnInstanceName(columnInstanceName);
  if (!parsed) {
    throw new Error(
      `Invalid column-instance name format: ${columnInstanceName}. Expected format: [derivation:ColumnName:type]`,
    );
  }

  // Check if base column exists to determine if it's a calculated field
  const columnsArray = normalizeArray(datasourceDep.column);
  const existingBaseColumn = columnsArray.find((col: any) => col['@_name'] === parsed.column);
  let correctedInstanceName = columnInstanceName;

  // If it's a calculated field with aggregation, we need to use usr prefix
  if (existingBaseColumn?.calculation?.['@_formula']) {
    const formula = existingBaseColumn.calculation['@_formula'];
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
    const hasAggregation = aggFunctions.some((fn) => formula.toUpperCase().includes(fn));

    if (hasAggregation && parsed.derivation !== 'User') {
      correctedInstanceName = `[usr:${parsed.localFieldName}:${parsed.pivot}]`;
      console.error(
        `[DEBUG] Correcting column reference for calculated field with aggregation: ${columnInstanceName} -> ${correctedInstanceName}`,
      );
      emitFieldRewrite({
        requested: columnInstanceName,
        applied: correctedInstanceName,
        reason: `calculated field "${parsed.column}" already aggregates in its formula; switching ${parsed.derivation} → User to avoid double aggregation`,
        datasource,
      });
      // Check if the corrected instance already exists
      exists = columnInstances.some((ci: any) => ci['@_name'] === correctedInstanceName);
    }
  }

  if (!exists) {
    // Parse the CORRECTED instance name to get base column and derivation
    const parsedCorrected = parseColumnInstanceName(correctedInstanceName);
    if (!parsedCorrected) {
      throw new Error(
        `Invalid column-instance name format: ${correctedInstanceName}. Expected format: [derivation:ColumnName:type]`,
      );
    }

    // Check if base column exists, if not create it
    const columns = [...columnsArray];
    const columnExists = columns.some((col: any) => col['@_name'] === parsedCorrected.column);

    if (!columnExists) {
      // Try to get full column definition from workbook (includes calculations, etc.)
      const workbookColumn = getColumnFromWorkbook(workbookXml, datasource, parsedCorrected.column);

      // Debug logging
      if (!workbookColumn) {
        if (workbookXml) {
          console.error(
            `[DEBUG] Failed to find column in workbook. Datasource: ${datasource}, Column: ${parsedCorrected.column}, Parsed derivation: ${parsedCorrected.derivation}`,
          );
        } else {
          console.warn(
            `[DEBUG] No workbook XML provided. Cannot look up column definition for: ${parsedCorrected.column}, Using derivation: ${parsedCorrected.derivation}`,
          );
        }
      }

      if (workbookColumn) {
        // Copy the full column definition from workbook, including any calculation elements
        // Make a shallow copy to avoid reference issues
        const newColumn = { ...workbookColumn };
        columns.push(newColumn);

        // If this is a calculated field, also ensure dependent columns exist
        if (workbookColumn.calculation) {
          // Parse the formula to extract dependent column names (simplified approach)
          const formula =
            workbookColumn.calculation['@_formula'] || workbookColumn.calculation['@_class'];
          if (formula && typeof formula === 'string') {
            // Extract column names in brackets from formula (e.g., [Profit], [Sales])
            const dependentColumns = formula.match(/\[([^\]]+)\]/g);
            if (dependentColumns) {
              for (const depCol of dependentColumns) {
                // Check if this dependent column already exists
                const depExists = columns.some((col: any) => col['@_name'] === depCol);
                if (!depExists) {
                  // Try to get it from workbook
                  const depWorkbookColumn = getColumnFromWorkbook(workbookXml, datasource, depCol);
                  if (depWorkbookColumn) {
                    columns.push({ ...depWorkbookColumn });
                  }
                }
              }
            }
          }
        }
      } else {
        // Fallback: create a basic column definition if not found in workbook
        // Infer type from derivation: Sum/Avg/Min/Max/Count/CountD/User → quantitative, None → nominal
        const isQuantitative = [
          'Sum',
          'Avg',
          'Min',
          'Max',
          'Count',
          'CountD',
          'CountDistinct',
          'Median',
          'Stdev',
          'StdevP',
          'Var',
          'VarP',
          'User',
        ].includes(parsedCorrected.derivation);
        const newColumn = {
          '@_name': parsedCorrected.column,
          '@_role': isQuantitative ? 'measure' : 'dimension',
          '@_type': isQuantitative ? 'quantitative' : 'nominal',
          '@_datatype': isQuantitative ? 'real' : 'string',
        };
        columns.push(newColumn);
        emitFieldRewrite({
          requested: columnInstanceName,
          applied: correctedInstanceName,
          reason: `column "${parsedCorrected.column}" not found in workbook; fabricated minimal definition (role=${newColumn['@_role']}, type=${newColumn['@_type']})`,
          fabricated: true,
          datasource,
        });
      }

      datasourceDep.column = columns.length === 1 ? columns[0] : columns;
    }

    // Create column-instance
    const baseColumn = columns.find((col: any) => col['@_name'] === parsedCorrected.column);

    // Infer type if not available from base column
    let instanceType = baseColumn?.['@_type'];
    if (!instanceType) {
      // Fallback: infer from derivation (use corrected derivation for consistency)
      const isQuantitative = [
        'Sum',
        'Avg',
        'Min',
        'Max',
        'Count',
        'CountD',
        'CountDistinct',
        'Median',
        'Stdev',
        'StdevP',
        'Var',
        'VarP',
        'User',
      ].includes(parsedCorrected.derivation);
      instanceType = isQuantitative ? 'quantitative' : 'nominal';
    }

    // Check if this is a calculated field with an aggregation already in the formula
    // If so, derivation should be "User" (not double-aggregate), otherwise use the requested derivation
    // Start with the corrected values from earlier correction logic
    let actualDerivation = parsedCorrected.derivation;
    let actualColumnInstanceName = correctedInstanceName;
    if (baseColumn?.calculation?.['@_formula']) {
      const formula = baseColumn.calculation['@_formula'];
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
      const hasAggregation = aggFunctions.some((fn) => formula.toUpperCase().includes(fn));

      if (hasAggregation && parsedCorrected.derivation !== 'User') {
        // This calculated field already has aggregation - use User derivation to prevent double aggregation
        console.error(
          `[DEBUG] Calculated field "${parsedCorrected.column}" has aggregation in formula, correcting from "${parsedCorrected.derivation}" to "User"`,
        );
        actualDerivation = 'User';
        // Also fix the column-instance name to use 'usr' prefix instead of aggregation prefix.
        actualColumnInstanceName = `[usr:${parsedCorrected.localFieldName}:${parsedCorrected.pivot}]`;
        console.error(`[DEBUG] Corrected column-instance name: ${actualColumnInstanceName}`);
        if (actualColumnInstanceName !== correctedInstanceName) {
          emitFieldRewrite({
            requested: correctedInstanceName,
            applied: actualColumnInstanceName,
            reason: `calculated field "${parsedCorrected.column}" already aggregates; final derivation forced to User`,
            datasource,
          });
        }
      }
    }

    // For date-part derivations the instance type must follow the ref's pivot
    // suffix, not the base date column's type, or Tableau coerces it back.
    if (DATE_PART_DERIVATIONS.has(actualDerivation)) {
      const pivotType = typeFromPivotSuffix(actualColumnInstanceName);
      if (pivotType) {
        instanceType = pivotType;
      }
    }

    const newColumnInstance = {
      '@_name': actualColumnInstanceName,
      '@_column': parsed.column,
      '@_derivation': actualDerivation,
      '@_pivot': 'key',
      '@_type': instanceType,
    };
    columnInstances.push(newColumnInstance);
    datasourceDep['column-instance'] =
      columnInstances.length === 1 ? columnInstances[0] : columnInstances;
  }

  // CRITICAL: Update dependencies array back to worksheet structure
  worksheet.table.view['datasource-dependencies'] =
    dependencies.length === 1 ? dependencies[0] : dependencies;

  // Return the corrected instance name so caller can use it
  return correctedInstanceName;
}

/**
 * Internal helper to add field to rows or cols shelf
 */
function addFieldToShelf(
  worksheetXml: string,
  shelf: 'rows' | 'cols',
  columnRef: string,
  index?: number,
  workbookXml?: string,
): string {
  const parsed = parseXML(worksheetXml);
  const worksheet = getWorksheet(parsed);

  if (!worksheet) {
    throw new Error('No worksheet found in XML');
  }

  if (!worksheet.table) {
    worksheet.table = {};
  }

  // Parse column reference to get datasource and column-instance
  const parsedRef = parseDatasourceQualifiedColumnRef(columnRef);
  if (!parsedRef) {
    throw new Error(
      `Invalid column reference format: ${columnRef}. Expected format: [Datasource Name].[column-instance-name]`,
    );
  }

  // Ensure column-instance exists in datasource-dependencies
  // This may return a corrected column-instance name (e.g., for calculated fields with aggregations)
  const correctedColumnInstanceName = ensureColumnInstanceInDependencies(
    worksheet,
    parsedRef.datasource,
    parsedRef.columnInstanceName,
    workbookXml,
  );

  // Build corrected column reference
  const correctedColumnRef = `[${parsedRef.datasource}].${correctedColumnInstanceName}`;

  // Get current shelf value and parse to array
  const currentArray = parseShelfValue(worksheet.table[shelf]);

  // Note: Tableau allows duplicate fields on the same shelf, so we don't check for existing entries

  // Add at specified index or end (using corrected column ref)
  if (index !== undefined && index >= 0 && index <= currentArray.length) {
    currentArray.splice(index, 0, correctedColumnRef);
  } else {
    currentArray.push(correctedColumnRef);
  }

  // Serialize back to string
  worksheet.table[shelf] = serializeShelfValue(currentArray);

  return serializeXML(parsed);
}

/**
 * Internal helper to remove field from rows or cols shelf
 */
function removeFieldFromShelf(
  worksheetXml: string,
  shelf: 'rows' | 'cols',
  columnRef: string,
): string {
  const parsed = parseXML(worksheetXml);
  const worksheet = getWorksheet(parsed);

  if (!worksheet?.table) {
    throw new Error(`No ${shelf} shelf found in worksheet`);
  }

  const currentArray = parseShelfValue(worksheet.table[shelf]);
  const filtered = currentArray.filter((col) => col !== columnRef);

  if (filtered.length === currentArray.length) {
    throw new Error(`Column ${columnRef} not found in ${shelf}`);
  }

  worksheet.table[shelf] = filtered.length > 0 ? serializeShelfValue(filtered) : '';

  return serializeXML(parsed);
}

/**
 * Internal helper to move field in rows or cols shelf
 */
function moveFieldInShelf(
  worksheetXml: string,
  shelf: 'rows' | 'cols',
  columnRef: string,
  newIndex: number,
): string {
  const parsed = parseXML(worksheetXml);
  const worksheet = getWorksheet(parsed);

  if (!worksheet?.table) {
    throw new Error(`No ${shelf} shelf found in worksheet`);
  }

  const currentArray = parseShelfValue(worksheet.table[shelf]);
  const currentIndex = currentArray.indexOf(columnRef);

  if (currentIndex === -1) {
    throw new Error(`Column ${columnRef} not found in ${shelf}`);
  }

  if (newIndex < 0 || newIndex >= currentArray.length) {
    throw new Error(`Invalid index ${newIndex}. Must be between 0 and ${currentArray.length - 1}`);
  }

  // Move the element
  const [moved] = currentArray.splice(currentIndex, 1);
  currentArray.splice(newIndex, 0, moved);

  worksheet.table[shelf] = serializeShelfValue(currentArray);

  return serializeXML(parsed);
}

/**
 * List all fields in a worksheet with their positions
 * @param worksheetXml - The worksheet XML as a string
 * @returns Array of field information with index positions
 */
export function listFields(worksheetXml: string): FieldInfo[] {
  const parsed = parseXML(worksheetXml);
  const fields: FieldInfo[] = [];

  const worksheet = getWorksheet(parsed);

  if (!worksheet) {
    return fields;
  }

  // Get encoding fields with indices
  const panes = normalizeArray(worksheet.table?.panes?.pane);
  for (const pane of panes) {
    if (pane.encodings) {
      for (const [encodingType, encodings] of Object.entries(pane.encodings)) {
        const encodingArray = normalizeArray(encodings);
        encodingArray.forEach((enc, idx) => {
          if (enc['@_column']) {
            fields.push({
              location: 'encodings',
              encodingType: encodingType as EncodingType,
              column: enc['@_column'],
              index: idx,
            });
          }
        });
      }
    }
  }

  // Get rows fields with indices
  const rowsArray = parseShelfValue(worksheet.table?.rows);
  rowsArray.forEach((col, idx) => {
    fields.push({
      location: 'rows',
      column: col,
      index: idx,
    });
  });

  // Get cols fields with indices
  const colsArray = parseShelfValue(worksheet.table?.cols);
  colsArray.forEach((col, idx) => {
    fields.push({
      location: 'cols',
      column: col,
      index: idx,
    });
  });

  return fields;
}
