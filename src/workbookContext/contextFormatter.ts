/**
 * Context Formatter
 * 
 * Utilities for formatting WorkbookContext into agent-consumable formats.
 * These summaries are designed to be included in agent prompts or system messages.
 */

import type {
  WorkbookContext,
  DataSourceContext,
  FieldContext,
  CalculationContext,
  ParameterContext,
  WorksheetContext,
  DashboardContext,
  FilterSpec,
  AnalystGuidance,
} from './types';

// ============================================================================
// Summary Generation Options
// ============================================================================

export interface ContextSummaryOptions {
  /** Include hidden fields in the output (default: false) */
  includeHiddenFields?: boolean;

  /** Include fields with no view usage (default: true) */
  includeUnusedFields?: boolean;

  /** Include calculation formulas (default: true) */
  includeFormulas?: boolean;

  /** Maximum number of fields to show per data source (default: 50) */
  maxFieldsPerDataSource?: number;

  /** Include worksheet details (default: true) */
  includeWorksheets?: boolean;

  /** Include dashboard details (default: true) */
  includeDashboards?: boolean;

  /** Include filter details (default: false) */
  includeFilterDetails?: boolean;

  /** Format: 'markdown' | 'json' | 'text' */
  format?: 'markdown' | 'json' | 'text';
}

const DEFAULT_OPTIONS: Required<ContextSummaryOptions> = {
  includeHiddenFields: false,
  includeUnusedFields: true,
  includeFormulas: true,
  maxFieldsPerDataSource: 50,
  includeWorksheets: true,
  includeDashboards: true,
  includeFilterDetails: false,
  format: 'markdown',
};

// ============================================================================
// Main Summary Functions
// ============================================================================

/**
 * Generate a comprehensive summary of the workbook context.
 * This is suitable for including in an agent's system message or context.
 */
export function generateContextSummary(
  context: WorkbookContext,
  options: ContextSummaryOptions = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  switch (opts.format) {
    case 'json':
      return generateJsonSummary(context, opts);
    case 'text':
      return generateTextSummary(context, opts);
    case 'markdown':
    default:
      return generateMarkdownSummary(context, opts);
  }
}

/**
 * Generate a compact summary focused on data sources and fields.
 * Useful when you need just the queryable metadata.
 */
export function generateDataSourceSummary(
  context: WorkbookContext,
  options: ContextSummaryOptions = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const lines: string[] = [];

  for (const ds of context.dataSources) {
    lines.push(formatDataSource(ds, opts));
  }

  if (context.parameters.length > 0) {
    lines.push('\n## Parameters\n');
    for (const param of context.parameters) {
      lines.push(formatParameter(param));
    }
  }

  return lines.join('\n');
}

/**
 * Generate a summary of required filters that must be applied to all queries.
 */
export function generateRequiredFiltersSummary(context: WorkbookContext): string {
  const lines: string[] = ['## Required Filters\n'];

  const { dataSourceFilters, applyToAllFilters } = context.requiredFilters;

  if (dataSourceFilters.length === 0 && applyToAllFilters.length === 0) {
    lines.push('No required filters defined.');
    return lines.join('\n');
  }

  if (dataSourceFilters.length > 0) {
    lines.push('### Data Source Filters');
    lines.push('These filters are defined at the data source level and always apply:\n');
    for (const filter of dataSourceFilters) {
      lines.push(`- ${formatFilter(filter)}`);
    }
    lines.push('');
  }

  if (applyToAllFilters.length > 0) {
    lines.push('### Apply-to-All Filters');
    lines.push('These filters apply across all worksheets:\n');
    for (const filter of applyToAllFilters) {
      lines.push(`- ${formatFilter(filter)}`);
    }
  }

  return lines.join('\n');
}

/**
 * Generate guidance for an agent based on analyst-authored metadata.
 */
export function generateAnalystGuidanceSummary(context: WorkbookContext): string {
  const guidance = context.analystGuidance;
  if (!guidance) {
    return '';
  }

  const lines: string[] = ['## Analyst Guidance\n'];

  if (guidance.description) {
    lines.push(`**Description:** ${guidance.description}\n`);
  }

  if (guidance.fieldsToExclude && guidance.fieldsToExclude.length > 0) {
    lines.push('### Fields to Exclude from Queries');
    lines.push('These fields should NOT be used in agent-generated queries:\n');
    for (const field of guidance.fieldsToExclude) {
      lines.push(`- ${field}`);
    }
    lines.push('');
  }

  if (guidance.requiredFilterRules && guidance.requiredFilterRules.length > 0) {
    lines.push('### Required Filter Rules');
    for (const rule of guidance.requiredFilterRules) {
      const values = rule.values.join(', ');
      lines.push(`- **${rule.fieldName}** ${rule.operator} [${values}]`);
      if (rule.reason) {
        lines.push(`  - Reason: ${rule.reason}`);
      }
    }
    lines.push('');
  }

  if (guidance.fewShotExamples && guidance.fewShotExamples.length > 0) {
    lines.push('### Example Questions and Answers');
    for (const example of guidance.fewShotExamples) {
      lines.push(`**Q:** ${example.question}`);
      lines.push(`**A:** ${example.queryOrAnswer}`);
      if (example.context) {
        lines.push(`*Context: ${example.context}*`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ============================================================================
// Format-specific generators
// ============================================================================

function generateMarkdownSummary(
  context: WorkbookContext,
  opts: Required<ContextSummaryOptions>
): string {
  const sections: string[] = [];

  // Header
  sections.push(`# Workbook: ${context.workbookName}\n`);

  // Data Sources
  sections.push('## Data Sources\n');
  for (const ds of context.dataSources) {
    sections.push(formatDataSource(ds, opts));
  }

  // Parameters
  if (context.parameters.length > 0) {
    sections.push('## Parameters\n');
    for (const param of context.parameters) {
      sections.push(formatParameter(param));
    }
  }

  // Required Filters
  sections.push(generateRequiredFiltersSummary(context));

  // Worksheets
  if (opts.includeWorksheets && context.worksheets.length > 0) {
    sections.push('\n## Worksheets\n');
    for (const ws of context.worksheets) {
      sections.push(formatWorksheet(ws, opts));
    }
  }

  // Dashboards
  if (opts.includeDashboards && context.dashboards.length > 0) {
    sections.push('\n## Dashboards\n');
    for (const db of context.dashboards) {
      sections.push(formatDashboard(db));
    }
  }

  // Analyst Guidance
  const guidance = generateAnalystGuidanceSummary(context);
  if (guidance) {
    sections.push(guidance);
  }

  return sections.join('\n');
}

function generateTextSummary(
  context: WorkbookContext,
  opts: Required<ContextSummaryOptions>
): string {
  const lines: string[] = [];

  lines.push(`WORKBOOK: ${context.workbookName}`);
  lines.push('='.repeat(50));
  lines.push('');

  lines.push('DATA SOURCES:');
  for (const ds of context.dataSources) {
    lines.push(`  - ${ds.dataSourceName}`);

    const fields = filterFields(ds.fields, opts);
    const dimensions = fields.filter(f => f.role === 'dimension');
    const measures = fields.filter(f => f.role === 'measure');

    lines.push(`    Dimensions: ${dimensions.map(f => f.fieldCaption || f.fieldName).join(', ')}`);
    lines.push(`    Measures: ${measures.map(f => f.fieldCaption || f.fieldName).join(', ')}`);
  }
  lines.push('');

  if (context.parameters.length > 0) {
    lines.push('PARAMETERS:');
    for (const param of context.parameters) {
      lines.push(`  - ${param.caption || param.name} (${param.domainType})`);
    }
    lines.push('');
  }

  lines.push('WORKSHEETS:');
  for (const ws of context.worksheets) {
    lines.push(`  - ${ws.worksheetName}`);
  }
  lines.push('');

  lines.push('DASHBOARDS:');
  for (const db of context.dashboards) {
    lines.push(`  - ${db.dashboardName} (${db.worksheetRefs.length} worksheets)`);
  }

  return lines.join('\n');
}

function generateJsonSummary(
  context: WorkbookContext,
  opts: Required<ContextSummaryOptions>
): string {
  const summary = {
    workbook: {
      name: context.workbookName,
      id: context.workbookId,
    },
    dataSources: context.dataSources.map(ds => ({
      name: ds.dataSourceName,
      id: ds.dataSourceId,
      isEmbedded: ds.isEmbedded,
      fields: filterFields(ds.fields, opts).map(f => ({
        name: f.fieldCaption || f.fieldName,
        internalName: f.fieldName,
        type: f.dataType,
        role: f.role,
        isHidden: f.isHidden,
        usedInViews: f.usedInViews,
      })),
      calculations: opts.includeFormulas
        ? ds.calculations.map(c => ({
          name: c.caption || c.name,
          formula: c.formula,
          type: c.dataType,
        }))
        : ds.calculations.length,
    })),
    parameters: context.parameters.map(p => ({
      name: p.caption || p.name,
      type: p.dataType,
      domain: p.domainType,
      currentValue: p.currentValue,
    })),
    worksheets: context.worksheets.map(ws => ws.worksheetName),
    dashboards: context.dashboards.map(db => ({
      name: db.dashboardName,
      worksheets: db.worksheetRefs,
    })),
    requiredFilters: {
      dataSourceFilters: context.requiredFilters.dataSourceFilters.length,
      applyToAllFilters: context.requiredFilters.applyToAllFilters.length,
    },
  };

  return JSON.stringify(summary, null, 2);
}

// ============================================================================
// Formatting helpers
// ============================================================================

function formatDataSource(ds: DataSourceContext, opts: Required<ContextSummaryOptions>): string {
  const lines: string[] = [];

  lines.push(`### ${ds.dataSourceName}`);
  if (ds.isEmbedded) {
    lines.push('*Embedded data source*\n');
  } else {
    lines.push('*Published data source*\n');
  }

  const fields = filterFields(ds.fields, opts);
  const dimensions = fields.filter(f => f.role === 'dimension');
  const measures = fields.filter(f => f.role === 'measure');

  if (dimensions.length > 0) {
    lines.push('**Dimensions:**');
    for (const dim of dimensions.slice(0, opts.maxFieldsPerDataSource)) {
      lines.push(`- ${formatField(dim)}`);
    }
    if (dimensions.length > opts.maxFieldsPerDataSource) {
      lines.push(`- ... and ${dimensions.length - opts.maxFieldsPerDataSource} more`);
    }
    lines.push('');
  }

  if (measures.length > 0) {
    lines.push('**Measures:**');
    for (const measure of measures.slice(0, opts.maxFieldsPerDataSource)) {
      lines.push(`- ${formatField(measure)}`);
    }
    if (measures.length > opts.maxFieldsPerDataSource) {
      lines.push(`- ... and ${measures.length - opts.maxFieldsPerDataSource} more`);
    }
    lines.push('');
  }

  if (opts.includeFormulas && ds.calculations.length > 0) {
    lines.push('**Calculated Fields:**');
    for (const calc of ds.calculations) {
      lines.push(`- ${formatCalculation(calc)}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function formatField(field: FieldContext): string {
  const parts: string[] = [];

  const displayName = field.fieldCaption || field.fieldName;
  parts.push(`\`${displayName}\``);

  if (field.fieldCaption && field.fieldCaption !== field.fieldName) {
    parts.push(`(${field.fieldName})`);
  }

  parts.push(`[${field.dataType}]`);

  if (field.isHidden) {
    parts.push('*hidden*');
  }

  if (field.usedInViews.length > 0) {
    parts.push(`- used in ${field.usedInViews.length} view(s)`);
  }

  return parts.join(' ');
}

function formatCalculation(calc: CalculationContext): string {
  const displayName = calc.caption || calc.name;
  let result = `\`${displayName}\` [${calc.dataType}]`;

  if (calc.isTableCalc) {
    result += ' *table calculation*';
  }

  // Truncate long formulas
  const formula = calc.formula.length > 100
    ? calc.formula.substring(0, 97) + '...'
    : calc.formula;

  result += `\n  Formula: \`${formula}\``;

  return result;
}

function formatParameter(param: ParameterContext): string {
  const displayName = param.caption || param.name;
  let result = `- \`${displayName}\` [${param.dataType}] (${param.domainType})`;

  if (param.currentValue !== null) {
    result += ` = ${param.currentValue}`;
  }

  if (param.domainType === 'range') {
    const range: string[] = [];
    if (param.rangeMin !== undefined) range.push(`min: ${param.rangeMin}`);
    if (param.rangeMax !== undefined) range.push(`max: ${param.rangeMax}`);
    if (range.length > 0) {
      result += ` [${range.join(', ')}]`;
    }
  } else if (param.domainType === 'list' && param.allowedValues) {
    const values = param.allowedValues.slice(0, 5).join(', ');
    const more = param.allowedValues.length > 5 ? '...' : '';
    result += ` [${values}${more}]`;
  }

  return result;
}

function formatWorksheet(ws: WorksheetContext, opts: Required<ContextSummaryOptions>): string {
  const lines: string[] = [];

  lines.push(`### ${ws.worksheetName}`);
  if (ws.title && ws.title !== ws.worksheetName) {
    lines.push(`*Title: ${ws.title}*`);
  }

  // Visual spec
  const rowFields = ws.visualSpec.fieldsOnRows.map(f => f.fieldName).join(', ') || 'none';
  const colFields = ws.visualSpec.fieldsOnColumns.map(f => f.fieldName).join(', ') || 'none';
  lines.push(`- Mark type: ${ws.visualSpec.markType}`);
  lines.push(`- Rows: ${rowFields}`);
  lines.push(`- Columns: ${colFields}`);

  // Filters
  if (opts.includeFilterDetails) {
    const totalFilters = ws.sheetFilters.contextFilters.length + ws.sheetFilters.regularFilters.length;
    if (totalFilters > 0) {
      lines.push(`- Filters: ${totalFilters} (${ws.sheetFilters.contextFilters.length} context)`);
    }
  }

  // Type-in calculations
  if (ws.typeInCalculations.length > 0) {
    lines.push(`- Type-in calculations: ${ws.typeInCalculations.length}`);
    for (const calc of ws.typeInCalculations) {
      lines.push(`  - \`${calc.caption || calc.name}\`: ${calc.formula}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

function formatDashboard(db: DashboardContext): string {
  const lines: string[] = [];

  lines.push(`### ${db.dashboardName}`);
  if (db.title && db.title !== db.dashboardName) {
    lines.push(`*Title: ${db.title}*`);
  }

  lines.push(`- Worksheets: ${db.worksheetRefs.join(', ') || 'none'}`);

  const totalActions = db.filterActions.length + db.parameterActions.length + db.highlightActions.length;
  if (totalActions > 0) {
    lines.push(`- Actions: ${totalActions} (${db.filterActions.length} filter, ${db.highlightActions.length} highlight)`);
  }

  lines.push('');
  return lines.join('\n');
}

function formatFilter(filter: FilterSpec): string {
  let result = `\`${filter.fieldName}\` [${filter.filterType}]`;

  if (filter.selectedValues && filter.selectedValues.length > 0) {
    const values = filter.selectedValues.slice(0, 3).join(', ');
    const more = filter.selectedValues.length > 3 ? '...' : '';
    result += ` = [${values}${more}]`;
  }

  if (filter.rangeMin !== undefined || filter.rangeMax !== undefined) {
    const min = filter.rangeMin ?? '*';
    const max = filter.rangeMax ?? '*';
    result += ` = [${min} to ${max}]`;
  }

  return result;
}

function filterFields(
  fields: FieldContext[],
  opts: Required<ContextSummaryOptions>
): FieldContext[] {
  return fields.filter(f => {
    // Filter hidden fields
    if (!opts.includeHiddenFields && f.isHidden) {
      return false;
    }

    // Filter unused fields
    if (!opts.includeUnusedFields && f.usedInViews.length === 0) {
      return false;
    }

    // Filter agent-excluded fields
    if (f.agentVisibility === 'exclude') {
      return false;
    }

    return true;
  });
}

// ============================================================================
// L1 Compact Summary (Always in Agent Context)
// ============================================================================

/**
 * Generate a compact index (~1-2KB) suitable for always including in agent context.
 * This gives the agent enough to decide where to look for more detail.
 * 
 * Inspired by how Claude Code handles large codebases - provide a "map" 
 * that agents can use to decide what to drill into.
 */
export function generateCompactIndex(context: WorkbookContext): string {
  const lines: string[] = [];

  lines.push(`WORKBOOK: ${context.workbookName}`);
  lines.push('');

  // Data Sources - compact view with counts
  lines.push('DATA SOURCES:');
  for (const ds of context.dataSources) {
    const visibleFields = ds.fields.filter(f => !f.isHidden);
    const calcCount = ds.calculations.length;
    const caption = ds.caption && ds.caption !== ds.dataSourceName
      ? ` (${ds.caption})`
      : '';
    const calcInfo = calcCount > 0 ? `, ${calcCount} calculations` : '';
    lines.push(`  - ${ds.dataSourceName}${caption} [${visibleFields.length} fields${calcInfo}]`);
  }
  lines.push('');

  // Dashboards - show which worksheets they contain
  if (context.dashboards.length > 0) {
    lines.push('DASHBOARDS:');
    for (const db of context.dashboards) {
      const wsCount = db.worksheetRefs.length;
      lines.push(`  - ${db.dashboardName} (${wsCount} worksheet${wsCount !== 1 ? 's' : ''})`);
    }
    lines.push('');
  }

  // Worksheets - just names, with fact status if available
  if (context.worksheets.length > 0) {
    // Count worksheets with successful facts (has dataSummary with rowCount)
    const sheetsWithFacts = context.worksheets.filter(
      ws => ws.facts?.dataSummary && ws.facts.dataSummary.rowCount !== undefined
    );
    // Count worksheets with fact errors
    const sheetsWithErrors = context.worksheets.filter(
      ws => ws.facts?.fetchError
    );

    let factsInfo = '';
    if (sheetsWithFacts.length > 0 || sheetsWithErrors.length > 0) {
      const parts: string[] = [];
      if (sheetsWithFacts.length > 0) {
        parts.push(`${sheetsWithFacts.length} with facts`);
      }
      if (sheetsWithErrors.length > 0) {
        parts.push(`${sheetsWithErrors.length} failed`);
      }
      factsInfo = ` (${parts.join(', ')})`;
    }
    lines.push(`WORKSHEETS: ${context.worksheets.length} total${factsInfo}`);
    // Show first 10, then summarize
    const toShow = context.worksheets.slice(0, 10);
    for (const ws of toShow) {
      const factInfo = formatWorksheetFactInfo(ws);
      lines.push(`  - ${ws.worksheetName}${factInfo}`);
    }
    if (context.worksheets.length > 10) {
      lines.push(`  ... and ${context.worksheets.length - 10} more`);
    }
    lines.push('');
  }

  // Parameters - compact list
  if (context.parameters.length > 0) {
    const paramNames = context.parameters
      .map(p => p.caption || p.name)
      .slice(0, 8)
      .join(', ');
    const more = context.parameters.length > 8 ? ', ...' : '';
    lines.push(`PARAMETERS: ${paramNames}${more}`);
    lines.push('');
  }

  // Required Filters - brief mention if present
  const { dataSourceFilters, applyToAllFilters } = context.requiredFilters;
  if (dataSourceFilters.length > 0 || applyToAllFilters.length > 0) {
    lines.push('REQUIRED FILTERS:');
    for (const filter of [...dataSourceFilters, ...applyToAllFilters].slice(0, 5)) {
      lines.push(`  - ${formatFilterCompact(filter)}`);
    }
    const total = dataSourceFilters.length + applyToAllFilters.length;
    if (total > 5) {
      lines.push(`  ... and ${total - 5} more`);
    }
    lines.push('');
  }

  // Analyst Guidance - just mention if it exists
  if (context.analystGuidance) {
    const guidance = context.analystGuidance;
    const flags: string[] = [];
    if (guidance.fieldsToExclude && guidance.fieldsToExclude.length > 0) {
      flags.push(`${guidance.fieldsToExclude.length} excluded fields`);
    }
    if (guidance.fewShotExamples && guidance.fewShotExamples.length > 0) {
      flags.push(`${guidance.fewShotExamples.length} examples`);
    }
    if (guidance.requiredFilterRules && guidance.requiredFilterRules.length > 0) {
      flags.push(`${guidance.requiredFilterRules.length} filter rules`);
    }
    if (flags.length > 0) {
      lines.push(`ANALYST GUIDANCE: ${flags.join(', ')}`);
      lines.push('');
    }
  }

  // Usage hint for the agent
  lines.push('---');
  lines.push('Use query_workbook_context tool to inspect details (fields, calculations, worksheets, etc.)');

  return lines.join('\n');
}

/**
 * Format worksheet fact info for compact index
 */
function formatWorksheetFactInfo(ws: WorksheetContext): string {
  if (!ws.facts) {
    return '';
  }

  if (ws.facts.fetchError) {
    return ' [facts: error]';
  }

  if (ws.facts.dataSummary) {
    const { rowCount, dimensions, measures } = ws.facts.dataSummary;
    return ` [facts: ${rowCount} rows, ${dimensions.length} dims, ${measures.length} measures]`;
  }

  return '';
}

/**
 * Compact filter format for L1 summary
 */
function formatFilterCompact(filter: FilterSpec): string {
  let result = filter.fieldName;

  if (filter.selectedValues && filter.selectedValues.length > 0) {
    if (filter.selectedValues.length <= 3) {
      result += ` = [${filter.selectedValues.join(', ')}]`;
    } else {
      result += ` = [${filter.selectedValues.slice(0, 2).join(', ')}, ... (${filter.selectedValues.length} values)]`;
    }
  } else if (filter.rangeMin !== undefined || filter.rangeMax !== undefined) {
    const min = filter.rangeMin ?? '*';
    const max = filter.rangeMax ?? '*';
    result += ` [${min} to ${max}]`;
  }

  return result;
}

// ============================================================================
// Agent-specific context builders
// ============================================================================

/**
 * Generate a focused context for an agent answering questions about a specific dashboard.
 */
export function generateDashboardFocusedContext(
  context: WorkbookContext,
  dashboardName: string,
  options: ContextSummaryOptions = {}
): string {
  const dashboard = context.dashboards.find(d => d.dashboardName === dashboardName);
  if (!dashboard) {
    return `Dashboard "${dashboardName}" not found in workbook.`;
  }

  const opts = { ...DEFAULT_OPTIONS, ...options };
  const lines: string[] = [];

  lines.push(`# Dashboard: ${dashboard.dashboardName}`);
  if (dashboard.title) {
    lines.push(`*${dashboard.title}*\n`);
  }

  // Get relevant worksheets
  const relevantWorksheets = context.worksheets.filter(ws =>
    dashboard.worksheetRefs.includes(ws.worksheetName)
  );

  // Get data sources used by these worksheets
  const usedDataSourceIds = new Set<string>();
  for (const ws of relevantWorksheets) {
    for (const dsRef of ws.dataSourceRefs) {
      usedDataSourceIds.add(dsRef);
    }
  }

  const relevantDataSources = context.dataSources.filter(ds =>
    usedDataSourceIds.has(ds.dataSourceId)
  );

  lines.push('## Data Sources\n');
  for (const ds of relevantDataSources) {
    lines.push(formatDataSource(ds, opts));
  }

  lines.push('## Worksheets in this Dashboard\n');
  for (const ws of relevantWorksheets) {
    lines.push(formatWorksheet(ws, opts));
  }

  // Required filters
  lines.push(generateRequiredFiltersSummary(context));

  // Analyst guidance
  const guidance = generateAnalystGuidanceSummary(context);
  if (guidance) {
    lines.push(guidance);
  }

  return lines.join('\n');
}

/**
 * Generate a minimal context containing only field metadata for HBI queries.
 */
export function generateHbiQueryContext(
  context: WorkbookContext,
  dataSourceName?: string
): string {
  const lines: string[] = [];

  const dataSources = dataSourceName
    ? context.dataSources.filter(ds =>
      ds.dataSourceName === dataSourceName || ds.caption === dataSourceName
    )
    : context.dataSources;

  for (const ds of dataSources) {
    lines.push(`# Data Source: ${ds.dataSourceName}`);
    lines.push('');

    // Only include visible, non-excluded fields
    const queryableFields = ds.fields.filter(f =>
      !f.isHidden && f.agentVisibility !== 'exclude'
    );

    const dimensions = queryableFields.filter(f => f.role === 'dimension');
    const measures = queryableFields.filter(f => f.role === 'measure');

    if (dimensions.length > 0) {
      lines.push('## Dimensions');
      for (const dim of dimensions) {
        const name = dim.fieldCaption || dim.fieldName;
        lines.push(`- ${name} (${dim.dataType})`);
      }
      lines.push('');
    }

    if (measures.length > 0) {
      lines.push('## Measures');
      for (const measure of measures) {
        const name = measure.fieldCaption || measure.fieldName;
        lines.push(`- ${name} (${measure.dataType})`);
      }
      lines.push('');
    }

    if (ds.calculations.length > 0) {
      lines.push('## Calculated Fields');
      for (const calc of ds.calculations) {
        const name = calc.caption || calc.name;
        lines.push(`- ${name} = ${calc.formula}`);
      }
      lines.push('');
    }
  }

  if (context.parameters.length > 0) {
    lines.push('# Parameters');
    for (const param of context.parameters) {
      const name = param.caption || param.name;
      lines.push(`- ${name}: ${param.dataType} (${param.domainType}), current = ${param.currentValue}`);
    }
  }

  return lines.join('\n');
}
