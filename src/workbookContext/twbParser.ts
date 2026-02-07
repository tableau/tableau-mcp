/**
 * TWB Parser
 * 
 * Parses Tableau Workbook (.twb) XML files to extract metadata
 * for the Analytics Agent Harness.
 */

import { XMLParser, XMLValidator } from 'fast-xml-parser';
import * as fs from 'fs';
import * as path from 'path';

import type {
  WorkbookContext,
  DataSourceContext,
  FieldContext,
  FieldDataType,
  CalculationContext,
  ParameterContext,
  WorksheetContext,
  DashboardContext,
  FilterSpec,
  ActionSpec,
  VisualSpec,
  FieldReference,
  MarksSpec,
  HierarchyContext,
  TableContext,
  AnalystGuidance,
} from './types';

// ============================================================================
// Main Parser Function
// ============================================================================

export interface ParseTwbOptions {
  /** Extract full filter details (can be verbose) */
  includeFilterDetails?: boolean;
  /** Extract marks card details */
  includeMarksDetails?: boolean;
  /** Extract action details */
  includeActions?: boolean;
}

export async function parseTwbFile(
  filePath: string,
  options: ParseTwbOptions = {}
): Promise<WorkbookContext> {
  const absolutePath = path.resolve(filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`TWB file not found: ${absolutePath}`);
  }

  const xmlContent = fs.readFileSync(absolutePath, 'utf-8');
  return parseTwbXml(xmlContent, path.basename(filePath), options);
}

export function parseTwbXml(
  xmlContent: string,
  sourceFile?: string,
  options: ParseTwbOptions = {}
): WorkbookContext {
  // Validate XML first
  const validationResult = XMLValidator.validate(xmlContent);
  if (validationResult !== true) {
    throw new Error(`Invalid XML: ${validationResult.err?.msg || 'Unknown error'}`);
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    isArray: (name) => {
      // These elements should always be arrays
      const arrayElements = [
        'datasource', 'column', 'column-instance', 'relation', 'worksheet',
        'dashboard', 'filter', 'action', 'member', 'hierarchy', 'named-connection',
        'zone', 'encoding', 'map', 'groupfilter', 'metadata-record', 'object'
      ];
      return arrayElements.includes(name);
    },
    parseAttributeValue: true,
    trimValues: true,
  });

  const parsed = parser.parse(xmlContent);
  const workbook = parsed.workbook;

  if (!workbook) {
    throw new Error('Invalid TWB: No workbook element found');
  }

  // Extract workbook-level info
  const workbookId = extractWorkbookId(workbook);
  const workbookName = extractWorkbookName(workbook, sourceFile);

  // Extract parameters first (they're in a special "Parameters" datasource)
  const parameters = extractParameters(workbook);

  // Extract data sources
  const dataSources = extractDataSources(workbook);

  // Extract worksheets
  const worksheets = extractWorksheets(workbook, dataSources, options);

  // Track which fields are used in views
  updateFieldUsageInViews(dataSources, worksheets);

  // Extract dashboards
  const dashboards = extractDashboards(workbook, options);

  // Extract workbook-level filters
  const requiredFilters = extractRequiredFilters(workbook, dataSources);

  return {
    workbookId,
    workbookName,
    sourceFile,
    dataSources,
    requiredFilters,
    worksheets,
    dashboards,
    parameters,
    analystGuidance: extractAnalystGuidance(workbook),
  };
}

// ============================================================================
// Workbook-level extraction
// ============================================================================

function extractWorkbookId(workbook: any): string {
  // Try to get from repository-location
  const repoLocation = workbook['repository-location'];
  if (repoLocation?.['@_id']) {
    return repoLocation['@_id'];
  }
  // Generate a placeholder ID
  return `workbook-${Date.now()}`;
}

function extractWorkbookName(workbook: any, sourceFile?: string): string {
  // Try to get from repository-location
  const repoLocation = workbook['repository-location'];
  if (repoLocation?.['@_id']) {
    return repoLocation['@_id'];
  }
  // Fall back to source file name
  if (sourceFile) {
    return path.basename(sourceFile, path.extname(sourceFile));
  }
  return 'Untitled Workbook';
}

// ============================================================================
// Parameter extraction
// ============================================================================

function extractParameters(workbook: any): ParameterContext[] {
  const parameters: ParameterContext[] = [];

  const datasources = ensureArray(workbook.datasources?.datasource);
  const paramsDatasource = datasources.find(
    (ds: any) => ds['@_name'] === 'Parameters'
  );

  if (!paramsDatasource) {
    return parameters;
  }

  const columns = ensureArray(paramsDatasource.column);
  for (const col of columns) {
    const paramDomainType = col['@_param-domain-type'];
    if (!paramDomainType) continue; // Not a parameter

    const param: ParameterContext = {
      name: cleanFieldName(col['@_name'] || ''),
      caption: col['@_caption'],
      dataType: mapDataType(col['@_datatype']),
      currentValue: extractParameterValue(col),
      domainType: mapParamDomainType(paramDomainType),
      defaultFormat: col['@_default-format'],
    };

    // Extract range info
    if (col.range) {
      param.rangeMin = col.range['@_min'];
      param.rangeMax = col.range['@_max'];
      param.rangeStep = col.range['@_granularity'];
    }

    // Extract list values
    if (col.members?.member) {
      const members = ensureArray(col.members.member);
      param.allowedValues = members.map((m: any) => {
        const val = m['@_value'] || m;
        return cleanStringValue(val);
      });
    }

    parameters.push(param);
  }

  return parameters;
}

function extractParameterValue(col: any): string | number | boolean | null {
  const value = col['@_value'];
  if (value === undefined || value === null) return null;

  const datatype = col['@_datatype'];

  if (datatype === 'integer') {
    return parseInt(value, 10);
  } else if (datatype === 'real') {
    return parseFloat(value);
  } else if (datatype === 'boolean') {
    return value === 'true' || value === true;
  }

  return cleanStringValue(value);
}

function mapParamDomainType(domainType: string): 'list' | 'range' | 'any' {
  switch (domainType) {
    case 'list': return 'list';
    case 'range': return 'range';
    default: return 'any';
  }
}

// ============================================================================
// Data Source extraction
// ============================================================================

function extractDataSources(workbook: any): DataSourceContext[] {
  const dataSources: DataSourceContext[] = [];

  const rawDatasources = ensureArray(workbook.datasources?.datasource);

  for (const ds of rawDatasources) {
    // Skip the Parameters "datasource"
    if (ds['@_name'] === 'Parameters') continue;

    const dsContext = extractSingleDataSource(ds);
    dataSources.push(dsContext);
  }

  return dataSources;
}

function extractSingleDataSource(ds: any): DataSourceContext {
  const dataSourceId = ds['@_name'] || `ds-${Date.now()}`;
  const caption = ds['@_caption'];
  const isEmbedded = ds['@_inline'] === 'true' || ds['@_inline'] === true;

  // Extract fields
  const fields = extractFields(ds);

  // Extract calculated fields
  const calculations = extractCalculations(ds);

  // Extract hierarchies
  const hierarchies = extractHierarchies(ds);

  // Extract table info
  const tables = extractTables(ds);

  return {
    dataSourceId,
    dataSourceName: caption || cleanFieldName(dataSourceId),
    caption,
    isEmbedded,
    fields,
    calculations,
    hierarchies,
    tables,
  };
}

function extractFields(ds: any): FieldContext[] {
  const fields: FieldContext[] = [];
  const columns = ensureArray(ds.column);

  for (const col of columns) {
    // Skip internal/system columns
    const name = col['@_name'] || '';
    if (name.startsWith('[:]') || name.includes('__tableau_internal')) continue;

    // Skip parameter columns (they have param-domain-type)
    if (col['@_param-domain-type']) continue;

    const hasCalculation = !!col.calculation;

    const field: FieldContext = {
      fieldName: cleanFieldName(name),
      fieldCaption: col['@_caption'],
      dataType: mapDataType(col['@_datatype']),
      role: col['@_role'] === 'measure' ? 'measure' : 'dimension',
      defaultFormat: col['@_default-format'],
      isHidden: col['@_hidden'] === 'true' || col['@_hidden'] === true,
      isCalculated: hasCalculation,
      usedInViews: [], // Will be populated later
      inHierarchy: false, // Will be populated later
      hasDescription: false, // TWB doesn't store descriptions; would come from metadata API
      agentVisibility: extractAgentVisibility(col),
      tags: extractTags(col),
    };

    fields.push(field);
  }

  // Also extract fields from metadata-records if available
  const metadataRecords = ensureArray(ds.connection?.['metadata-records']?.['metadata-record']);
  for (const record of metadataRecords) {
    if (record['@_class'] !== 'column') continue;

    const localName = record['local-name'];
    if (!localName) continue;

    // Check if we already have this field
    const cleanName = cleanFieldName(localName);
    if (fields.some(f => f.fieldName === cleanName)) continue;

    const field: FieldContext = {
      fieldName: cleanName,
      fieldCaption: record['remote-alias'],
      dataType: mapDataType(record['local-type']),
      role: record.aggregation === 'Sum' || record.aggregation === 'Avg' ? 'measure' : 'dimension',
      isHidden: false,
      isCalculated: false,
      usedInViews: [],
      inHierarchy: false,
      hasDescription: false,
      agentVisibility: null,
    };

    fields.push(field);
  }

  return fields;
}

function extractCalculations(ds: any): CalculationContext[] {
  const calculations: CalculationContext[] = [];
  const columns = ensureArray(ds.column);

  for (const col of columns) {
    if (!col.calculation) continue;

    // Skip parameter calculations
    if (col['@_param-domain-type']) continue;

    const calc = col.calculation;
    const formula = calc['@_formula'] || '';

    const calculation: CalculationContext = {
      name: cleanFieldName(col['@_name'] || ''),
      caption: col['@_caption'],
      formula,
      dataType: mapDataType(col['@_datatype']),
      role: col['@_role'] === 'measure' ? 'measure' : 'dimension',
      isTableCalc: !!calc['table-calc'],
      dependencies: extractCalcDependencies(formula),
    };

    calculations.push(calculation);
  }

  return calculations;
}

function extractCalcDependencies(formula: string): string[] {
  const dependencies: string[] = [];
  // Match field references like [Field Name]
  const fieldPattern = /\[([^\]]+)\]/g;
  let match;

  while ((match = fieldPattern.exec(formula)) !== null) {
    const fieldName = match[1];
    // Skip parameters
    if (fieldName.startsWith('Parameters.')) continue;
    if (!dependencies.includes(fieldName)) {
      dependencies.push(fieldName);
    }
  }

  return dependencies;
}

function extractHierarchies(ds: any): HierarchyContext[] {
  const hierarchies: HierarchyContext[] = [];
  const drillPaths = ensureArray(ds['drill-paths']?.['drill-path']);

  for (const drill of drillPaths) {
    const fields = ensureArray(drill.field);

    hierarchies.push({
      name: drill['@_name'] || '',
      levels: fields.map((f: any) => cleanFieldName(f)),
    });
  }

  return hierarchies;
}

function extractTables(ds: any): TableContext[] {
  const tables: TableContext[] = [];
  const connection = ds.connection;
  if (!connection) return tables;

  // Handle relation elements
  const relations = collectRelations(connection.relation);

  for (const rel of relations) {
    if (rel['@_type'] !== 'table') continue;

    const cols = ensureArray(rel.columns?.column);

    tables.push({
      name: rel['@_name'] || '',
      connection: rel['@_connection'],
      columns: cols.map((c: any) => c['@_name'] || ''),
    });
  }

  return tables;
}

function collectRelations(relation: any): any[] {
  if (!relation) return [];

  const results: any[] = [];
  const relations = ensureArray(relation);

  for (const rel of relations) {
    if (rel['@_type'] === 'table') {
      results.push(rel);
    } else if (rel['@_type'] === 'collection' || rel['@_type'] === 'join') {
      // Recursively collect nested relations
      results.push(...collectRelations(rel.relation));
    }
  }

  return results;
}

// ============================================================================
// Worksheet extraction
// ============================================================================

function extractWorksheets(
  workbook: any,
  dataSources: DataSourceContext[],
  options: ParseTwbOptions
): WorksheetContext[] {
  const worksheets: WorksheetContext[] = [];
  const rawWorksheets = ensureArray(workbook.worksheets?.worksheet);

  for (const ws of rawWorksheets) {
    const wsContext = extractSingleWorksheet(ws, dataSources, options);
    worksheets.push(wsContext);
  }

  return worksheets;
}

function extractSingleWorksheet(
  ws: any,
  dataSources: DataSourceContext[],
  options: ParseTwbOptions
): WorksheetContext {
  const worksheetName = ws['@_name'] || 'Untitled';
  const view = ws.table?.view;

  // Extract data source references
  const dataSourceRefs = extractDataSourceRefs(view);

  // Extract visual spec
  const visualSpec = extractVisualSpec(ws.table, options);

  // Build a set of all calculation names defined at the data source level
  // These are "data pane calcs" and should NOT be considered type-in calcs
  const dataSourceCalcNames = new Set<string>();
  for (const ds of dataSources) {
    for (const calc of ds.calculations) {
      dataSourceCalcNames.add(calc.name);
    }
    // Also add calculated fields (fields with isCalculated = true)
    for (const field of ds.fields) {
      if (field.isCalculated) {
        dataSourceCalcNames.add(field.fieldName);
      }
    }
  }

  // Extract type-in calculations (ad-hoc calcs defined only in this view)
  const typeInCalculations = extractTypeInCalculations(view, dataSourceCalcNames);

  // Extract filters
  const sheetFilters = extractSheetFilters(view, options);

  // Extract title
  const title = extractWorksheetTitle(ws);

  return {
    worksheetId: ws['simple-id']?.['@_uuid'] || worksheetName,
    worksheetName,
    title,
    dataSourceRefs,
    visualSpec,
    typeInCalculations,
    sheetFilters,
    currentState: null, // Will be populated from embedding API in interactive mode
  };
}

function extractDataSourceRefs(view: any): string[] {
  if (!view?.datasources?.datasource) return [];

  const dsList = ensureArray(view.datasources.datasource);
  return dsList.map((ds: any) => ds['@_name'] || '').filter(Boolean);
}

function extractVisualSpec(table: any, options: ParseTwbOptions): VisualSpec {
  const visualSpec: VisualSpec = {
    markType: 'automatic',
    fieldsOnRows: [],
    fieldsOnColumns: [],
    marks: {},
  };

  if (!table) return visualSpec;

  // Extract rows and columns
  visualSpec.fieldsOnRows = parseFieldReferences(table.rows);
  visualSpec.fieldsOnColumns = parseFieldReferences(table.cols);

  // Extract mark type
  const panes = ensureArray(table.panes?.pane);
  for (const pane of panes) {
    const mark = pane.mark;
    if (mark?.['@_class']) {
      visualSpec.markType = mark['@_class'];
      break;
    }
  }

  // Extract marks card if requested
  if (options.includeMarksDetails) {
    visualSpec.marks = extractMarksSpec(table);
  }

  return visualSpec;
}

function parseFieldReferences(fieldExpr: string | undefined): FieldReference[] {
  if (!fieldExpr || typeof fieldExpr !== 'string') return [];

  const refs: FieldReference[] = [];

  // Pattern to match field references like [datasource].[field:aggregation]
  const pattern = /\[([^\]]+)\]\.\[([^\]]+)\]/g;
  let match;

  while ((match = pattern.exec(fieldExpr)) !== null) {
    const dataSourceId = match[1];
    const fieldPart = match[2];

    // Parse the field part which may include aggregation like "sum:Sales:qk"
    const fieldParts = fieldPart.split(':');

    let aggregation: string | undefined;
    let fieldName: string;

    if (fieldParts.length >= 2 && isAggregation(fieldParts[0])) {
      aggregation = fieldParts[0];
      fieldName = fieldParts[1];
    } else {
      fieldName = fieldParts[0].replace(/^none:/, '');
    }

    refs.push({
      fieldName,
      dataSourceId,
      aggregation,
    });
  }

  return refs;
}

function isAggregation(str: string): boolean {
  const aggregations = [
    'sum', 'avg', 'min', 'max', 'cnt', 'ctd', 'var', 'std',
    'yr', 'qr', 'mn', 'dy', 'hr', 'mi', 'sc',
    'tmn', 'twk', 'tyr', 'tqr',
    'usr', 'none', 'pcto', 'attr', 'mdn'
  ];
  return aggregations.includes(str.toLowerCase());
}

function extractMarksSpec(table: any): MarksSpec {
  const marks: MarksSpec = {};

  const panes = ensureArray(table.panes?.pane);
  for (const pane of panes) {
    const encodings = ensureArray(pane.encodings?.encoding);

    for (const enc of encodings) {
      const attr = enc['@_attr'];
      const field = enc['@_column'];

      if (!attr || !field) continue;

      const fieldRef = parseFieldReferences(field)[0];
      if (!fieldRef) continue;

      switch (attr) {
        case 'color':
          marks.color = fieldRef;
          break;
        case 'size':
          marks.size = fieldRef;
          break;
        case 'shape':
          marks.shape = fieldRef;
          break;
        case 'text':
          marks.label = marks.label || [];
          marks.label.push(fieldRef);
          break;
      }
    }
  }

  return marks;
}

function extractTypeInCalculations(
  view: any,
  dataSourceCalcNames: Set<string>
): CalculationContext[] {
  const typeInCalcs: CalculationContext[] = [];

  // Type-in calculations are in datasource-dependencies, but we need to filter out:
  // 1. Parameters (have param-domain-type attribute)
  // 2. Data pane calcs (already defined at the data source level)
  const dependencies = ensureArray(view?.['datasource-dependencies']);

  for (const dep of dependencies) {
    // Skip Parameters datasource entirely
    const datasourceName = dep['@_datasource'];
    if (datasourceName === 'Parameters') continue;

    const columns = ensureArray(dep.column);

    for (const col of columns) {
      // Skip if not a calculation
      if (!col.calculation) continue;

      // Skip parameters (have param-domain-type)
      if (col['@_param-domain-type']) continue;

      const formula = col.calculation['@_formula'];
      if (!formula) continue;

      const calcName = cleanFieldName(col['@_name'] || '');

      // Skip if this calc is defined at the data source level (it's a data pane calc, not type-in)
      if (dataSourceCalcNames.has(calcName)) continue;

      // This is a true type-in calculation (ad-hoc calc defined in the view)
      typeInCalcs.push({
        name: calcName,
        caption: col['@_caption'],
        formula,
        dataType: mapDataType(col['@_datatype']),
        role: col['@_role'] === 'measure' ? 'measure' : 'dimension',
        isTableCalc: !!col.calculation['table-calc'],
        dependencies: extractCalcDependencies(formula),
      });
    }
  }

  return typeInCalcs;
}

function extractSheetFilters(
  view: any,
  options: ParseTwbOptions
): { contextFilters: FilterSpec[]; regularFilters: FilterSpec[] } {
  const contextFilters: FilterSpec[] = [];
  const regularFilters: FilterSpec[] = [];

  const filters = ensureArray(view?.filter);

  for (const filter of filters) {
    const filterSpec = parseFilter(filter, options);
    if (!filterSpec) continue;

    // Check if it's a context filter (context="true" attribute or filter-group)
    // Context filters have priority in Tableau's order of operations
    if (filter['@_context'] === 'true') {
      contextFilters.push(filterSpec);
    } else {
      regularFilters.push(filterSpec);
    }
  }

  return { contextFilters, regularFilters };
}

function parseFilter(filter: any, options: ParseTwbOptions): FilterSpec | null {
  const column = filter['@_column'];
  if (!column) return null;

  const filterClass = filter['@_class'];

  const filterSpec: FilterSpec = {
    fieldName: extractFieldNameFromColumn(column),
    dataSourceId: extractDataSourceFromColumn(column),
    filterType: mapFilterClass(filterClass),
    filterGroup: filter['@_filter-group'],
  };

  if (options.includeFilterDetails) {
    // Extract filter values/ranges
    if (filterClass === 'categorical') {
      filterSpec.selectedValues = extractCategoricalFilterValues(filter);
      filterSpec.excludeMode = filter['@_include-mode'] === 'exclude';
    } else if (filterClass === 'quantitative') {
      if (filter.min) filterSpec.rangeMin = filter.min;
      if (filter.max) filterSpec.rangeMax = filter.max;
      filterSpec.includeNulls = filter['@_include-nulls'] === 'true';
    }
  }

  return filterSpec;
}

function extractFieldNameFromColumn(column: string): string {
  // Column format: [datasource].[field:aggregation] or [datasource].[:Measure Names]
  const match = column.match(/\]\.\[([^\]]+)\]/);
  if (match) {
    // Remove aggregation prefix if present
    const fieldPart = match[1];
    const parts = fieldPart.split(':');
    return parts.length > 1 ? parts[1] : parts[0];
  }
  return column;
}

function extractDataSourceFromColumn(column: string): string | undefined {
  const match = column.match(/^\[([^\]]+)\]/);
  return match ? match[1] : undefined;
}

function mapFilterClass(filterClass: string): FilterSpec['filterType'] {
  switch (filterClass) {
    case 'categorical': return 'categorical';
    case 'quantitative': return 'quantitative';
    case 'relative-date': return 'relative-date';
    case 'top': return 'top-n';
    default: return 'categorical';
  }
}

function extractCategoricalFilterValues(filter: any): (string | number | boolean)[] {
  const values: (string | number | boolean)[] = [];

  const groupfilters = ensureArray(filter.groupfilter);
  for (const gf of groupfilters) {
    if (gf['@_function'] === 'member' && gf['@_member']) {
      values.push(cleanStringValue(gf['@_member']));
    }

    // Handle nested groupfilters (for union operations)
    const nested = ensureArray(gf.groupfilter);
    for (const ngf of nested) {
      if (ngf['@_function'] === 'member' && ngf['@_member']) {
        values.push(cleanStringValue(ngf['@_member']));
      }
    }
  }

  return values;
}

function extractWorksheetTitle(ws: any): string | undefined {
  const layoutOptions = ws['layout-options'];
  if (!layoutOptions?.title) return undefined;

  const formattedText = layoutOptions.title['formatted-text'];
  if (!formattedText?.run) return undefined;

  const runs = ensureArray(formattedText.run);
  return runs.map((r: any) => {
    if (typeof r === 'string') return r;
    if (r['#text']) return r['#text'];
    return '';
  }).join('').trim() || undefined;
}

// ============================================================================
// Dashboard extraction
// ============================================================================

function extractDashboards(workbook: any, options: ParseTwbOptions): DashboardContext[] {
  const dashboards: DashboardContext[] = [];
  const rawDashboards = ensureArray(workbook.dashboards?.dashboard);

  for (const db of rawDashboards) {
    const dbContext = extractSingleDashboard(db, workbook, options);
    dashboards.push(dbContext);
  }

  return dashboards;
}

function extractSingleDashboard(
  db: any,
  workbook: any,
  options: ParseTwbOptions
): DashboardContext {
  const dashboardName = db['@_name'] || 'Untitled';

  // Extract worksheet references from zones
  const worksheetRefs = extractDashboardWorksheetRefs(db);

  // Extract actions targeting this dashboard
  const actions = options.includeActions
    ? extractDashboardActions(workbook, dashboardName)
    : { filterActions: [], parameterActions: [], highlightActions: [] };

  // Extract title
  const title = extractDashboardTitle(db);

  return {
    dashboardId: db['simple-id']?.['@_uuid'] || dashboardName,
    dashboardName,
    title,
    worksheetRefs,
    ...actions,
    currentState: null,
  };
}

function extractDashboardWorksheetRefs(db: any): string[] {
  const worksheetRefs: string[] = [];

  // Control types that are NOT worksheet references
  const nonWorksheetTypes = new Set([
    'filter', 'paramctrl', 'color', 'size', 'shape', 'text', 'title',
    'layout-flow', 'layout-basic', 'empty', 'bitmap', 'web'
  ]);

  // Zones contain worksheet references
  function extractFromZones(zones: any) {
    if (!zones) return;

    const zoneList = ensureArray(zones.zone);
    for (const zone of zoneList) {
      const zoneName = zone['@_name'];
      const zoneType = zone['@_type-v2'] || zone['@_type'];

      // A zone is a worksheet reference if:
      // 1. It has a name attribute
      // 2. It doesn't have a type that indicates it's a control (filter, param, etc.)
      // 3. The name looks like a worksheet name (not a parameter reference)
      if (zoneName &&
        !nonWorksheetTypes.has(zoneType) &&
        !zoneName.startsWith('[') &&
        !zone['@_param']) {
        worksheetRefs.push(zoneName);
      }

      // Recursively check nested zones
      if (zone.zones) {
        extractFromZones(zone.zones);
      }
      if (zone.zone) {
        extractFromZones({ zone: zone.zone });
      }
    }
  }

  extractFromZones(db.zones);

  // Also check devicelayouts
  const deviceLayouts = ensureArray(db.devicelayouts?.devicelayout);
  for (const layout of deviceLayouts) {
    extractFromZones(layout.zones);
  }

  return [...new Set(worksheetRefs)]; // Remove duplicates
}

function extractDashboardActions(
  workbook: any,
  dashboardName: string
): { filterActions: ActionSpec[]; parameterActions: ActionSpec[]; highlightActions: ActionSpec[] } {
  const filterActions: ActionSpec[] = [];
  const parameterActions: ActionSpec[] = [];
  const highlightActions: ActionSpec[] = [];

  const actions = ensureArray(workbook.actions?.action);

  for (const action of actions) {
    const source = action.source;
    if (!source) continue;

    // Check if this action involves our dashboard
    if (source['@_dashboard'] !== dashboardName &&
      action.command?.param?.find((p: any) => p['@_name'] === 'target')?.['@_value'] !== dashboardName) {
      continue;
    }

    const actionSpec: ActionSpec = {
      name: action['@_name'] || '',
      caption: action['@_caption'],
      actionType: determineActionType(action),
      sourceWorksheet: source['@_worksheet'],
      activation: mapActivationType(action.activation?.['@_type']),
      fields: extractActionFields(action),
    };

    // Add target worksheets
    const excludeList = action.command?.param?.find((p: any) => p['@_name'] === 'exclude')?.['@_value'];
    if (excludeList) {
      actionSpec.targetWorksheets = excludeList.split(',').filter(Boolean);
    }

    switch (actionSpec.actionType) {
      case 'filter':
        filterActions.push(actionSpec);
        break;
      case 'parameter':
        parameterActions.push(actionSpec);
        break;
      case 'highlight':
        highlightActions.push(actionSpec);
        break;
    }
  }

  return { filterActions, parameterActions, highlightActions };
}

function determineActionType(action: any): ActionSpec['actionType'] {
  const command = action.command?.['@_command'];
  if (!command) return 'filter';

  if (command.includes('brush')) return 'highlight';
  if (command.includes('filter') || command.includes('tsl-filter')) return 'filter';
  if (command.includes('parameter')) return 'parameter';
  if (command.includes('url')) return 'url';

  return 'filter';
}

function mapActivationType(type: string | undefined): ActionSpec['activation'] {
  switch (type) {
    case 'on-select': return 'on-select';
    case 'on-hover': return 'on-hover';
    case 'on-menu': return 'on-menu';
    default: return 'on-select';
  }
}

function extractActionFields(action: any): string[] {
  const params = ensureArray(action.command?.param);
  const fieldCaptionsParam = params.find((p: any) => p['@_name'] === 'field-captions');

  if (fieldCaptionsParam?.['@_value']) {
    return fieldCaptionsParam['@_value'].split(',').filter(Boolean);
  }

  return [];
}

function extractDashboardTitle(db: any): string | undefined {
  const layoutOptions = db['layout-options'];
  if (!layoutOptions?.title) return undefined;

  const formattedText = layoutOptions.title['formatted-text'];
  if (!formattedText?.run) return undefined;

  const runs = ensureArray(formattedText.run);
  return runs.map((r: any) => {
    if (typeof r === 'string') return r;
    if (r['#text']) return r['#text'];
    return '';
  }).join('').trim() || undefined;
}

// ============================================================================
// Required filters extraction
// ============================================================================

function extractRequiredFilters(
  workbook: any,
  dataSources: DataSourceContext[]
): { dataSourceFilters: FilterSpec[]; applyToAllFilters: FilterSpec[] } {
  const dataSourceFilters: FilterSpec[] = [];
  const applyToAllFilters: FilterSpec[] = [];

  // Data source filters are defined in the datasource connection
  for (const dsRaw of ensureArray(workbook.datasources?.datasource)) {
    if (dsRaw['@_name'] === 'Parameters') continue;

    // Check for extract filter or datasource-filter
    const connection = dsRaw.connection;
    if (!connection) continue;

    // Extract filters from filter elements in the datasource
    const filters = ensureArray(connection.filter);
    for (const filter of filters) {
      const filterSpec = parseFilter(filter, { includeFilterDetails: true });
      if (filterSpec) {
        filterSpec.dataSourceId = dsRaw['@_name'];
        dataSourceFilters.push(filterSpec);
      }
    }
  }

  // Apply-to-all filters are filters with specific filter-group values that appear across all worksheets
  // We identify these by looking for filters that have the same filter-group across multiple sheets
  const filterGroupCounts = new Map<string, { filter: FilterSpec; count: number }>();
  const worksheets = ensureArray(workbook.worksheets?.worksheet);

  for (const ws of worksheets) {
    const view = ws.table?.view;
    const filters = ensureArray(view?.filter);

    for (const filter of filters) {
      const filterGroup = filter['@_filter-group'];
      if (!filterGroup) continue;

      if (!filterGroupCounts.has(filterGroup)) {
        const filterSpec = parseFilter(filter, { includeFilterDetails: true });
        if (filterSpec) {
          filterSpec.filterGroup = filterGroup;
          filterSpec.isApplyToAll = true;
          filterGroupCounts.set(filterGroup, { filter: filterSpec, count: 1 });
        }
      } else {
        const entry = filterGroupCounts.get(filterGroup)!;
        entry.count++;
      }
    }
  }

  // Filters that appear in all (or most) worksheets are "apply to all"
  const worksheetCount = worksheets.length;
  for (const [, entry] of filterGroupCounts) {
    // If the filter appears in at least 50% of worksheets, consider it "apply to all"
    if (entry.count >= worksheetCount * 0.5) {
      applyToAllFilters.push(entry.filter);
    }
  }

  return { dataSourceFilters, applyToAllFilters };
}

// ============================================================================
// Field usage tracking
// ============================================================================

function updateFieldUsageInViews(
  dataSources: DataSourceContext[],
  worksheets: WorksheetContext[]
): void {
  // Build a map of field -> worksheets for quick lookup
  const fieldUsageMap = new Map<string, Set<string>>();

  for (const ws of worksheets) {
    const fieldsUsed = new Set<string>();

    // Collect fields from visual spec
    for (const ref of ws.visualSpec.fieldsOnRows) {
      fieldsUsed.add(ref.fieldName);
    }
    for (const ref of ws.visualSpec.fieldsOnColumns) {
      fieldsUsed.add(ref.fieldName);
    }

    // Collect fields from marks
    const marks = ws.visualSpec.marks;
    if (marks.color) fieldsUsed.add(marks.color.fieldName);
    if (marks.size) fieldsUsed.add(marks.size.fieldName);
    if (marks.shape) fieldsUsed.add(marks.shape.fieldName);
    for (const label of marks.label || []) {
      fieldsUsed.add(label.fieldName);
    }
    for (const detail of marks.detail || []) {
      fieldsUsed.add(detail.fieldName);
    }
    for (const tooltip of marks.tooltip || []) {
      fieldsUsed.add(tooltip.fieldName);
    }

    // Collect fields from filters
    for (const filter of [...ws.sheetFilters.contextFilters, ...ws.sheetFilters.regularFilters]) {
      fieldsUsed.add(filter.fieldName);
    }

    // Update the usage map
    for (const fieldName of fieldsUsed) {
      if (!fieldUsageMap.has(fieldName)) {
        fieldUsageMap.set(fieldName, new Set());
      }
      fieldUsageMap.get(fieldName)!.add(ws.worksheetName);
    }
  }

  // Update the fields in data sources
  for (const ds of dataSources) {
    for (const field of ds.fields) {
      const usageSet = fieldUsageMap.get(field.fieldName);
      field.usedInViews = usageSet ? Array.from(usageSet) : [];
    }

    // Also mark fields that are in hierarchies
    for (const hierarchy of ds.hierarchies) {
      for (const level of hierarchy.levels) {
        const field = ds.fields.find(f => f.fieldName === level);
        if (field) {
          field.inHierarchy = true;
        }
      }
    }
  }
}

// ============================================================================
// Analyst guidance extraction
// ============================================================================

function extractAnalystGuidance(workbook: any): AnalystGuidance | undefined {
  // For now, we can only extract basic info from the workbook
  // More detailed guidance would come from field tags or external metadata

  const guidance: AnalystGuidance = {};

  // Collect fields marked for exclusion (via hidden or agent:exclude tag)
  const fieldsToExclude: string[] = [];

  const datasources = ensureArray(workbook.datasources?.datasource);
  for (const ds of datasources) {
    if (ds['@_name'] === 'Parameters') continue;

    const columns = ensureArray(ds.column);
    for (const col of columns) {
      const visibility = extractAgentVisibility(col);
      if (visibility === 'exclude') {
        fieldsToExclude.push(cleanFieldName(col['@_name'] || ''));
      }
    }
  }

  if (fieldsToExclude.length > 0) {
    guidance.fieldsToExclude = fieldsToExclude;
  }

  // Only return if we have any guidance
  if (Object.keys(guidance).length === 0) {
    return undefined;
  }

  return guidance;
}

function extractAgentVisibility(col: any): 'include' | 'exclude' | null {
  const tags = extractTags(col);
  if (!tags) return null;

  for (const tag of tags) {
    if (tag.toLowerCase() === 'agent:exclude') return 'exclude';
    if (tag.toLowerCase() === 'agent:include') return 'include';
  }

  return null;
}

function extractTags(col: any): string[] | undefined {
  // Tags might be in a custom attribute or separate element
  // This depends on how Tableau stores custom tags
  const tagsAttr = col['@_tags'];
  if (tagsAttr && typeof tagsAttr === 'string') {
    return tagsAttr.split(',').map((t: string) => t.trim()).filter(Boolean);
  }
  return undefined;
}

// ============================================================================
// Utility functions
// ============================================================================

function ensureArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function cleanFieldName(name: string): string {
  // Remove brackets: [Field Name] -> Field Name
  return name.replace(/^\[/, '').replace(/\]$/, '');
}

function cleanStringValue(value: string): string {
  // Remove quote wrappers: "Value" -> Value
  if (typeof value !== 'string') return String(value);
  return value.replace(/^"/, '').replace(/"$/, '');
}

function mapDataType(datatype: string | undefined): FieldDataType {
  switch (datatype?.toLowerCase()) {
    case 'string':
    case 'nominal':
      return 'string';
    case 'integer':
    case 'int':
      return 'integer';
    case 'real':
    case 'float':
    case 'double':
      return 'real';
    case 'date':
      return 'date';
    case 'datetime':
      return 'datetime';
    case 'boolean':
    case 'bool':
      return 'boolean';
    case 'table':
      return 'table';
    default:
      return 'unknown';
  }
}

// ============================================================================
// Exports
// ============================================================================

export { ensureArray, cleanFieldName, cleanStringValue, mapDataType };
