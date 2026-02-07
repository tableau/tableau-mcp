/**
 * Context Query Utility
 * 
 * Provides jq-like query capabilities for WorkbookContext objects.
 * This is designed to be used by an MCP tool that allows agents to
 * drill down into specific parts of the context.
 */

import type {
  WorkbookContext,
  DataSourceContext,
  WorksheetContext,
  DashboardContext,
  FieldContext,
  CalculationContext,
  ParameterContext,
} from './types';

// ============================================================================
// Query Types
// ============================================================================

export type QueryPath =
  | 'dataSources'
  | 'dataSources.*'
  | 'dataSources.*.fields'
  | 'dataSources.*.calculations'
  | 'worksheets'
  | 'worksheets.*'
  | 'dashboards'
  | 'dashboards.*'
  | 'parameters'
  | 'requiredFilters'
  | 'analystGuidance';

export interface ContextQueryOptions {
  /** Filter results by name (for arrays) */
  filterByName?: string;

  /** Filter data source results */
  dataSource?: string;

  /** Filter worksheet results */
  worksheet?: string;

  /** Filter dashboard results */
  dashboard?: string;

  /** Include hidden fields (default: false) */
  includeHidden?: boolean;

  /** Maximum results to return (default: 50) */
  limit?: number;

  /** Format: 'json' | 'text' (default: 'json') */
  format?: 'json' | 'text';
}

/** Internal resolved options with defaults applied */
interface ResolvedQueryOptions {
  filterByName?: string;
  dataSource?: string;
  worksheet?: string;
  dashboard?: string;
  includeHidden: boolean;
  limit: number;
  format: 'json' | 'text';
}

export interface QueryResult {
  success: boolean;
  path: string;
  data?: any;
  count?: number;
  error?: string;
}

// ============================================================================
// Main Query Function
// ============================================================================

/**
 * Query the workbook context using a path expression.
 * 
 * Supported queries:
 * - "dataSources" - List all data sources
 * - "dataSources[name]" - Get specific data source
 * - "dataSources[name].fields" - Get fields for a data source
 * - "dataSources[name].calculations" - Get calculations for a data source
 * - "worksheets" - List all worksheets
 * - "worksheets[name]" - Get specific worksheet
 * - "dashboards" - List all dashboards  
 * - "dashboards[name]" - Get specific dashboard
 * - "parameters" - List all parameters
 * - "requiredFilters" - Get required filters
 * - "analystGuidance" - Get analyst guidance
 * 
 * @param context The full WorkbookContext
 * @param query The query path expression
 * @param options Query options for filtering/formatting
 */
export function queryContext(
  context: WorkbookContext,
  query: string,
  options: ContextQueryOptions = {}
): QueryResult {
  const opts = {
    includeHidden: false,
    limit: 50,
    format: 'json' as const,
    ...options,
  };

  try {
    const result = executeQuery(context, query, opts);
    return {
      success: true,
      path: query,
      data: opts.format === 'text' ? formatAsText(result.data, query) : result.data,
      count: result.count,
    };
  } catch (error) {
    return {
      success: false,
      path: query,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================================================
// Query Execution
// ============================================================================

function executeQuery(
  context: WorkbookContext,
  query: string,
  opts: ResolvedQueryOptions
): { data: any; count?: number } {
  // Parse the query
  const parsed = parseQuery(query);

  switch (parsed.root) {
    case 'dataSources':
      return queryDataSources(context, parsed, opts);
    case 'worksheets':
      return queryWorksheets(context, parsed, opts);
    case 'dashboards':
      return queryDashboards(context, parsed, opts);
    case 'parameters':
      return queryParameters(context, opts);
    case 'requiredFilters':
      return { data: context.requiredFilters };
    case 'analystGuidance':
      return { data: context.analystGuidance || null };
    case 'workbook':
      return { data: getWorkbookSummary(context) };
    default:
      throw new Error(`Unknown query root: ${parsed.root}. Valid roots: dataSources, worksheets, dashboards, parameters, requiredFilters, analystGuidance`);
  }
}

interface ParsedQuery {
  root: string;
  selector?: string;
  property?: string;
}

function parseQuery(query: string): ParsedQuery {
  // Handle simple paths like "dataSources" or "worksheets"
  if (!query.includes('[') && !query.includes('.')) {
    return { root: query };
  }

  // Handle indexed access like "dataSources[Sample - Superstore]"
  const indexMatch = query.match(/^(\w+)\[([^\]]+)\](?:\.(.+))?$/);
  if (indexMatch) {
    return {
      root: indexMatch[1],
      selector: indexMatch[2],
      property: indexMatch[3],
    };
  }

  // Handle dot access like "dataSources.fields"
  const dotMatch = query.match(/^(\w+)\.(.+)$/);
  if (dotMatch) {
    return {
      root: dotMatch[1],
      property: dotMatch[2],
    };
  }

  return { root: query };
}

// ============================================================================
// Query Handlers
// ============================================================================

function queryDataSources(
  context: WorkbookContext,
  parsed: ParsedQuery,
  opts: ResolvedQueryOptions
): { data: any; count?: number } {
  // If no selector, list all data sources
  if (!parsed.selector && !parsed.property) {
    const list = context.dataSources.map(ds => ({
      name: ds.dataSourceName,
      caption: ds.caption,
      isEmbedded: ds.isEmbedded,
      fieldCount: ds.fields.filter(f => opts.includeHidden || !f.isHidden).length,
      calculationCount: ds.calculations.length,
    }));
    return { data: list, count: list.length };
  }

  // Find specific data source
  const dsName = parsed.selector || opts.dataSource;
  let dataSource: DataSourceContext | undefined;

  if (dsName) {
    dataSource = context.dataSources.find(ds =>
      ds.dataSourceName === dsName ||
      ds.caption === dsName ||
      ds.dataSourceId === dsName
    );

    if (!dataSource) {
      throw new Error(`Data source not found: ${dsName}`);
    }
  } else if (parsed.property && context.dataSources.length === 1) {
    // If there's only one data source and user queries a property, use it
    dataSource = context.dataSources[0];
  } else if (parsed.property) {
    throw new Error(`Multiple data sources exist. Specify one: dataSources[name].${parsed.property}`);
  }

  // If no property, return the full data source
  if (!parsed.property && dataSource) {
    return { data: formatDataSourceForQuery(dataSource, opts) };
  }

  // Handle specific properties
  if (dataSource && parsed.property) {
    switch (parsed.property) {
      case 'fields': {
        let fields = dataSource.fields;
        if (!opts.includeHidden) {
          fields = fields.filter(f => !f.isHidden);
        }
        const limited = fields.slice(0, opts.limit);
        return {
          data: limited.map(f => formatFieldForQuery(f)),
          count: fields.length,
        };
      }
      case 'calculations': {
        const calcs = dataSource.calculations.slice(0, opts.limit);
        return {
          data: calcs.map(c => formatCalculationForQuery(c)),
          count: dataSource.calculations.length,
        };
      }
      case 'hierarchies':
        return { data: dataSource.hierarchies };
      case 'tables':
        return { data: dataSource.tables || [] };
      default:
        throw new Error(`Unknown data source property: ${parsed.property}`);
    }
  }

  throw new Error(`Invalid data source query: ${parsed.selector}${parsed.property ? '.' + parsed.property : ''}`);
}

function queryWorksheets(
  context: WorkbookContext,
  parsed: ParsedQuery,
  opts: ResolvedQueryOptions
): { data: any; count?: number } {
  // List all worksheets
  if (!parsed.selector && !parsed.property) {
    const list = context.worksheets.map(ws => ({
      name: ws.worksheetName,
      title: ws.title,
      markType: ws.visualSpec.markType,
      dataSourceCount: ws.dataSourceRefs.length,
      filterCount: ws.sheetFilters.contextFilters.length + ws.sheetFilters.regularFilters.length,
      typeInCalcCount: ws.typeInCalculations.length,
    }));
    return { data: list, count: list.length };
  }

  // Find specific worksheet
  const wsName = parsed.selector || opts.worksheet;
  let worksheet: WorksheetContext | undefined;

  if (wsName) {
    worksheet = context.worksheets.find(ws =>
      ws.worksheetName === wsName ||
      ws.worksheetId === wsName
    );

    if (!worksheet) {
      throw new Error(`Worksheet not found: ${wsName}`);
    }

    return { data: formatWorksheetForQuery(worksheet) };
  }

  throw new Error('Specify a worksheet name: worksheets[name]');
}

function queryDashboards(
  context: WorkbookContext,
  parsed: ParsedQuery,
  opts: ResolvedQueryOptions
): { data: any; count?: number } {
  // List all dashboards
  if (!parsed.selector && !parsed.property) {
    const list = context.dashboards.map(db => ({
      name: db.dashboardName,
      title: db.title,
      worksheetCount: db.worksheetRefs.length,
      worksheets: db.worksheetRefs,
      actionCount: db.filterActions.length + db.parameterActions.length + db.highlightActions.length,
    }));
    return { data: list, count: list.length };
  }

  // Find specific dashboard
  const dbName = parsed.selector || opts.dashboard;
  let dashboard: DashboardContext | undefined;

  if (dbName) {
    dashboard = context.dashboards.find(db =>
      db.dashboardName === dbName ||
      db.dashboardId === dbName
    );

    if (!dashboard) {
      throw new Error(`Dashboard not found: ${dbName}`);
    }

    return { data: formatDashboardForQuery(dashboard) };
  }

  throw new Error('Specify a dashboard name: dashboards[name]');
}

function queryParameters(
  context: WorkbookContext,
  opts: ResolvedQueryOptions
): { data: any; count?: number } {
  const params = context.parameters.slice(0, opts.limit).map(p => ({
    name: p.name,
    caption: p.caption,
    dataType: p.dataType,
    domainType: p.domainType,
    currentValue: p.currentValue,
    allowedValues: p.allowedValues,
    range: p.rangeMin !== undefined ? { min: p.rangeMin, max: p.rangeMax, step: p.rangeStep } : undefined,
  }));

  return { data: params, count: context.parameters.length };
}

// ============================================================================
// Formatting Helpers
// ============================================================================

function getWorkbookSummary(context: WorkbookContext): any {
  return {
    name: context.workbookName,
    id: context.workbookId,
    description: context.description,
    dataSourceCount: context.dataSources.length,
    worksheetCount: context.worksheets.length,
    dashboardCount: context.dashboards.length,
    parameterCount: context.parameters.length,
  };
}

function formatDataSourceForQuery(ds: DataSourceContext, opts: ResolvedQueryOptions): any {
  const fields = opts.includeHidden ? ds.fields : ds.fields.filter(f => !f.isHidden);

  return {
    name: ds.dataSourceName,
    caption: ds.caption,
    id: ds.dataSourceId,
    isEmbedded: ds.isEmbedded,
    fields: fields.slice(0, opts.limit).map(f => formatFieldForQuery(f)),
    fieldCount: fields.length,
    calculations: ds.calculations.slice(0, opts.limit).map(c => formatCalculationForQuery(c)),
    calculationCount: ds.calculations.length,
    hierarchies: ds.hierarchies,
  };
}

function formatFieldForQuery(field: FieldContext): any {
  return {
    name: field.fieldName,
    caption: field.fieldCaption,
    dataType: field.dataType,
    role: field.role,
    description: field.description,
    isHidden: field.isHidden,
    isCalculated: field.isCalculated,
    usedInViews: field.usedInViews,
    inHierarchy: field.inHierarchy,
    agentVisibility: field.agentVisibility,
    tags: field.tags,
  };
}

function formatCalculationForQuery(calc: CalculationContext): any {
  return {
    name: calc.name,
    caption: calc.caption,
    formula: calc.formula,
    dataType: calc.dataType,
    role: calc.role,
    isTableCalc: calc.isTableCalc,
    dependencies: calc.dependencies,
  };
}

function formatWorksheetForQuery(ws: WorksheetContext): any {
  return {
    name: ws.worksheetName,
    id: ws.worksheetId,
    title: ws.title,
    dataSourceRefs: ws.dataSourceRefs,
    visualSpec: {
      markType: ws.visualSpec.markType,
      rows: ws.visualSpec.fieldsOnRows.map(f => f.fieldName),
      columns: ws.visualSpec.fieldsOnColumns.map(f => f.fieldName),
      marks: ws.visualSpec.marks,
    },
    typeInCalculations: ws.typeInCalculations.map(c => formatCalculationForQuery(c)),
    filters: {
      context: ws.sheetFilters.contextFilters,
      regular: ws.sheetFilters.regularFilters,
    },
    currentState: ws.currentState,
  };
}

function formatDashboardForQuery(db: DashboardContext): any {
  return {
    name: db.dashboardName,
    id: db.dashboardId,
    title: db.title,
    worksheets: db.worksheetRefs,
    actions: {
      filter: db.filterActions,
      parameter: db.parameterActions,
      highlight: db.highlightActions,
    },
    currentState: db.currentState,
  };
}

function formatAsText(data: any, query: string): string {
  if (data === null || data === undefined) {
    return 'null';
  }

  if (Array.isArray(data)) {
    const lines: string[] = [];
    lines.push(`Results for: ${query}`);
    lines.push('-'.repeat(40));

    for (const item of data) {
      if (typeof item === 'object') {
        const name = item.name || item.caption || JSON.stringify(item);
        lines.push(`- ${name}`);
      } else {
        lines.push(`- ${item}`);
      }
    }

    return lines.join('\n');
  }

  if (typeof data === 'object') {
    return JSON.stringify(data, null, 2);
  }

  return String(data);
}

// ============================================================================
// Pre-defined Queries for Common Patterns
// ============================================================================

/**
 * Get all queryable fields across all data sources, formatted for HBI query construction.
 */
export function getQueryableFields(
  context: WorkbookContext,
  dataSourceName?: string
): { dimensions: any[]; measures: any[] } {
  const dataSources = dataSourceName
    ? context.dataSources.filter(ds =>
      ds.dataSourceName === dataSourceName ||
      ds.caption === dataSourceName
    )
    : context.dataSources;

  const dimensions: any[] = [];
  const measures: any[] = [];

  for (const ds of dataSources) {
    for (const field of ds.fields) {
      if (field.isHidden || field.agentVisibility === 'exclude') {
        continue;
      }

      const formatted = {
        name: field.fieldCaption || field.fieldName,
        internalName: field.fieldName,
        dataType: field.dataType,
        dataSource: ds.dataSourceName,
        isCalculated: field.isCalculated,
      };

      if (field.role === 'dimension') {
        dimensions.push(formatted);
      } else {
        measures.push(formatted);
      }
    }
  }

  return { dimensions, measures };
}

/**
 * Get fields used in a specific worksheet.
 */
export function getWorksheetFields(
  context: WorkbookContext,
  worksheetName: string
): { rows: string[]; columns: string[]; marks: any } | null {
  const worksheet = context.worksheets.find(ws => ws.worksheetName === worksheetName);
  if (!worksheet) {
    return null;
  }

  return {
    rows: worksheet.visualSpec.fieldsOnRows.map(f => f.fieldName),
    columns: worksheet.visualSpec.fieldsOnColumns.map(f => f.fieldName),
    marks: worksheet.visualSpec.marks,
  };
}
