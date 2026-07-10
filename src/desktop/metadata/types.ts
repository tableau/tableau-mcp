export type EncodingType =
  | 'color'
  | 'size'
  | 'lod'
  | 'detail'
  | 'text'
  | 'tooltip'
  | 'path'
  | 'angle';

export type FieldLocation = 'rows' | 'cols' | 'encodings';

export enum AggregationType {
  None = 'None',
  Sum = 'Sum',
  Avg = 'Avg',
  Min = 'Min',
  Max = 'Max',
  Count = 'Count',
  CountDistinct = 'CountDistinct',
  User = 'User',
}

export interface FieldInfo {
  location: FieldLocation;
  encodingType?: EncodingType;
  column: string;
  index?: number;
}

export interface FieldReference {
  datasource: string;
  columnName: string;
  columnInstanceName: string;
  derivation: AggregationType;
  type: string;
  role: string;
  datatype?: string;
  caption?: string;
  isAggregated?: boolean;
  formula?: string;
  folder?: string;
}

export interface ParsedWorkbook {
  workbook?: {
    worksheets?: {
      worksheet?: ParsedWorksheet | ParsedWorksheet[];
    };
    dashboards?: {
      dashboard?: ParsedDashboard | ParsedDashboard[];
    };
    windows?: {
      window?: ParsedWindow | ParsedWindow[];
    };
    [key: string]: any;
  };
  [key: string]: any;
}

export interface ParsedWorksheet {
  '@_name': string;
  table?: {
    view?: {
      datasources?: {
        datasource?: ParsedDatasource | ParsedDatasource[];
      };
      'datasource-dependencies'?: ParsedDatasourceDependencies | ParsedDatasourceDependencies[];
      aggregation?: { '@_value': string };
    };
    style?: any;
    panes?: {
      pane?: ParsedPane | ParsedPane[];
    };
    rows?: string | string[];
    cols?: string | string[];
  };
  'simple-id'?: { '@_uuid': string };
  [key: string]: any;
}

export interface ParsedDatasource {
  '@_name': string;
  [key: string]: any;
}

export interface ParsedDatasourceDependencies {
  '@_datasource': string;
  column?: ParsedColumn | ParsedColumn[];
  'column-instance'?: ParsedColumnInstance | ParsedColumnInstance[];
  [key: string]: any;
}

export interface ParsedColumn {
  '@_name': string;
  '@_role': string;
  '@_type': string;
  '@_datatype': string;
  '@_caption'?: string;
  calculation?: {
    '@_class': string;
    '@_formula': string;
  };
  [key: string]: any;
}

export interface ParsedColumnInstance {
  '@_name': string;
  '@_column': string;
  '@_derivation': string;
  '@_pivot': string;
  '@_type': string;
  [key: string]: any;
}

export interface ParsedPane {
  '@_selection-relaxation-option'?: string;
  view?: {
    breakdown?: { '@_value': string };
  };
  mark?: { '@_class': string };
  encodings?: {
    [key: string]: ParsedEncoding | ParsedEncoding[];
  };
  [key: string]: any;
}

export interface ParsedEncoding {
  '@_column': string;
  [key: string]: any;
}

export interface ParsedWindow {
  '@_class': string;
  '@_name': string;
  '@_maximized'?: string;
  viewpoints?: any;
  active?: { '@_id': string };
  'simple-id'?: { '@_uuid': string };
  [key: string]: any;
}

export interface ParsedDashboard {
  '@_enable-sort-zone-taborder'?: string;
  '@_name': string;
  style?: any;
  size?: {
    '@_maxheight'?: string;
    '@_maxwidth'?: string;
    '@_minheight'?: string;
    '@_minwidth'?: string;
    '@_sizing-mode'?: string;
    [key: string]: any;
  };
  zones?: {
    zone?: ParsedZone | ParsedZone[];
  };
  devicelayouts?: any;
  'simple-id'?: { '@_uuid': string };
  [key: string]: any;
}

export interface ParsedZone {
  '@_name'?: string;
  '@_h'?: string;
  '@_w'?: string;
  '@_x'?: string;
  '@_y'?: string;
  'zone-pane'?: {
    '@_name': string;
    [key: string]: any;
  };
  [key: string]: any;
}
