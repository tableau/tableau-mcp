/**
 * Workbook Context Types
 * 
 * These interfaces define the metadata structure for extracting agent-relevant
 * context from Tableau workbooks. Used by the Analytics Agent Harness.
 */

// ============================================================================
// Core Workbook Context
// ============================================================================

export interface WorkbookContext {
  workbookId: string;
  workbookName: string;
  description?: string;
  sourceFile?: string;

  /** Server workbook ID (LUID) for REST API calls - set when downloaded from server */
  serverWorkbookId?: string;

  /** The queryable data sources (HBI can query these after 262) */
  dataSources: DataSourceContext[];

  /** Workbook-level required filters (apply to all HBI queries) */
  requiredFilters: {
    dataSourceFilters: FilterSpec[];
    applyToAllFilters: FilterSpec[];
  };

  /** All worksheets in the workbook */
  worksheets: WorksheetContext[];

  /** All dashboards in the workbook */
  dashboards: DashboardContext[];

  /** Parameters defined in the workbook */
  parameters: ParameterContext[];

  /** Analyst-authored guidance */
  analystGuidance?: AnalystGuidance;
}

// ============================================================================
// Data Source Context
// ============================================================================

export interface DataSourceContext {
  dataSourceId: string;
  dataSourceName: string;
  caption?: string;
  isEmbedded: boolean;

  /** Fields in this data source */
  fields: FieldContext[];

  /** Calculated fields (non-type-in) */
  calculations: CalculationContext[];

  /** Hierarchies defined in this data source */
  hierarchies: HierarchyContext[];

  /** Table/relation information */
  tables?: TableContext[];
}

export interface TableContext {
  name: string;
  connection?: string;
  columns: string[];
}

// ============================================================================
// Field Context
// ============================================================================

export interface FieldContext {
  fieldName: string;
  fieldCaption?: string;
  dataType: FieldDataType;
  role: 'dimension' | 'measure';
  description?: string;
  defaultFormat?: string;

  /** Signals for relevance inference */
  isHidden: boolean;
  isCalculated: boolean;
  usedInViews: string[];
  inHierarchy: boolean;
  hasDescription: boolean;

  /** Analyst override (from field tags) */
  agentVisibility?: 'include' | 'exclude' | null;
  tags?: string[];
}

export type FieldDataType =
  | 'string'
  | 'integer'
  | 'real'
  | 'date'
  | 'datetime'
  | 'boolean'
  | 'table'
  | 'unknown';

// ============================================================================
// Calculation Context
// ============================================================================

export interface CalculationContext {
  name: string;
  caption?: string;
  formula: string;
  dataType: FieldDataType;
  role: 'dimension' | 'measure';

  /** If this is a table calculation */
  isTableCalc: boolean;

  /** Dependencies on other fields/calculations */
  dependencies?: string[];
}

// ============================================================================
// Parameter Context
// ============================================================================

export interface ParameterContext {
  name: string;
  caption?: string;
  dataType: FieldDataType;
  currentValue: string | number | boolean | null;

  /** Domain type: list, range, or any */
  domainType: 'list' | 'range' | 'any';

  /** For list domain */
  allowedValues?: (string | number)[];

  /** For range domain */
  rangeMin?: number;
  rangeMax?: number;
  rangeStep?: number;

  defaultFormat?: string;
}

// ============================================================================
// Hierarchy Context
// ============================================================================

export interface HierarchyContext {
  name: string;
  caption?: string;
  levels: string[];
}

// ============================================================================
// Worksheet Context
// ============================================================================

export interface WorksheetContext {
  worksheetId: string;
  worksheetName: string;
  title?: string;

  /** Data sources used by this worksheet */
  dataSourceRefs: string[];

  /** Visual specification */
  visualSpec: VisualSpec;

  /** Type-in calculations (calcs that only exist on this sheet) */
  typeInCalculations: CalculationContext[];

  /** Filters on this sheet */
  sheetFilters: {
    contextFilters: FilterSpec[];
    regularFilters: FilterSpec[];
  };

  /** Interactive state (null in headless) */
  currentState: InteractiveState | null;

  /** Analytical facts from view data (populated via fetchViewData or populate-worksheet-facts) */
  facts?: WorksheetFacts;
}

// ============================================================================
// Worksheet Facts (from View Data)
// ============================================================================

/**
 * Analytical facts derived from fetching and analyzing a worksheet's view data.
 * These represent the "a-priori" analytical facts established by pre-built views.
 */
export interface WorksheetFacts {
  /** Tableau view ID (for REST API reference) */
  viewId?: string;

  /** When the data was fetched */
  fetchedAt?: string;

  /** Data summary with statistics */
  dataSummary?: WorksheetDataSummary;

  /** Error message if data fetch failed */
  fetchError?: string;
}

export interface WorksheetDataSummary {
  rowCount: number;
  columnCount: number;
  dimensions: DimensionSummary[];
  measures: MeasureSummary[];
  sampleRows: Record<string, string>[];
}

export interface DimensionSummary {
  name: string;
  distinctCount: number;
  /** All distinct values (only for low-cardinality dimensions, <= 50 values) */
  distinctValues?: string[];
  /** Sample of first 5 unique values */
  sampleValues: string[];
}

export interface MeasureSummary {
  name: string;
  min: number;
  max: number;
  avg: number;
  sum: number;
}

export interface VisualSpec {
  markType: string;
  fieldsOnRows: FieldReference[];
  fieldsOnColumns: FieldReference[];
  marks: MarksSpec;
}

export interface FieldReference {
  fieldName: string;
  dataSourceId?: string;
  aggregation?: string;
  derivation?: string;
}

export interface MarksSpec {
  color?: FieldReference;
  size?: FieldReference;
  shape?: FieldReference;
  label?: FieldReference[];
  detail?: FieldReference[];
  tooltip?: FieldReference[];
}

// ============================================================================
// Dashboard Context
// ============================================================================

export interface DashboardContext {
  dashboardId: string;
  dashboardName: string;
  title?: string;

  /** References to contained worksheets */
  worksheetRefs: string[];

  /** Dashboard-level actions that connect sheets */
  filterActions: ActionSpec[];
  parameterActions: ActionSpec[];
  highlightActions: ActionSpec[];

  /** Interactive state (null in headless) */
  currentState: DashboardInteractiveState | null;
}

export interface ActionSpec {
  name: string;
  caption?: string;
  actionType: 'filter' | 'parameter' | 'highlight' | 'url';
  sourceWorksheet?: string;
  targetWorksheets?: string[];
  activation?: 'on-select' | 'on-hover' | 'on-menu';
  fields?: string[];
}

// ============================================================================
// Filter Specifications
// ============================================================================

export interface FilterSpec {
  fieldName: string;
  dataSourceId?: string;
  filterType: 'categorical' | 'quantitative' | 'date' | 'relative-date' | 'top-n';

  /** For categorical filters */
  selectedValues?: (string | number | boolean)[];
  excludeMode?: boolean;

  /** For quantitative/date filters */
  rangeMin?: string | number | Date;
  rangeMax?: string | number | Date;
  includeNulls?: boolean;

  /** Filter group (for "apply to all worksheets") */
  filterGroup?: string;
  isApplyToAll?: boolean;
  isContextFilter?: boolean;
}

// ============================================================================
// Interactive State
// ============================================================================

export interface InteractiveState {
  activeFilters: FilterState[];
  parameterValues: ParameterState[];
  selectedMarks?: MarkSelection[];
}

export interface DashboardInteractiveState extends InteractiveState {
  activeSheet?: string;
}

export interface FilterState {
  fieldName: string;
  filterType: 'categorical' | 'range' | 'relative-date' | 'top-n';
  selectedValues?: (string | number | boolean)[];
  rangeMin?: string | number | Date;
  rangeMax?: string | number | Date;
}

export interface ParameterState {
  parameterName: string;
  currentValue: string | number | boolean | null;
}

export interface MarkSelection {
  worksheetName: string;
  selectedTuples: Record<string, string | number | boolean>[];
}

// ============================================================================
// Analyst Guidance
// ============================================================================

export interface AnalystGuidance {
  /** From workbook description */
  description?: string;

  /** Explicit field exclusions (via field tags) */
  fieldsToExclude?: string[];

  /** Required filter rules: "Always filter X to Y" */
  requiredFilterRules?: FilterRule[];

  /** Example questions and queries */
  fewShotExamples?: Example[];
}

export interface FilterRule {
  fieldName: string;
  operator: 'equals' | 'not-equals' | 'in' | 'not-in' | 'greater-than' | 'less-than' | 'between';
  values: (string | number | boolean)[];
  reason?: string;
}

export interface Example {
  question: string;
  queryOrAnswer: string;
  context?: string;
}
