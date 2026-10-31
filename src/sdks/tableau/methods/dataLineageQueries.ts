import { LineageKind } from '../types/dataLineage.js';

export type Relation = {
  field: string;
  target: LineageKind;
  direction: 'upstream' | 'downstream';
  evidence: 'direct' | 'possible';
  connection?: boolean;
  on?: string;
  terminal?: boolean;
  permissionMode?: false;
};

const direct = (
  field: string,
  target: LineageKind,
  direction: Relation['direction'],
  extra: Partial<Relation> = {},
): Relation => ({ field, target, direction, evidence: 'direct', connection: true, ...extra });
const rollup = (
  field: string,
  target: LineageKind,
  direction: Relation['direction'],
): Relation => ({
  field,
  target,
  direction,
  evidence: 'possible',
  connection: true,
  terminal: true,
});

// Only documented relationship names are interpolated. Caller text is always
// encoded as a GraphQL string literal by JSON.stringify in the query builder.
// https://help.tableau.com/current/api/metadata_api/en-us/reference/column.doc.html
export const relations: Partial<Record<LineageKind, Relation[]>> = {
  column: [
    direct('referencedByFieldsConnection', 'field', 'downstream'),
    direct('referencedByFlowColumnInputFieldConnection', 'flow-input-field', 'downstream'),
    direct('referencedByFlowColumnOutputFieldConnection', 'flow-output-field', 'upstream'),
    direct('remoteColumn', 'column', 'upstream', { connection: false }),
    rollup('upstreamFieldsConnection', 'field', 'upstream'),
    rollup('downstreamFlowsConnection', 'flow', 'downstream'),
    rollup('downstreamDatasourcesConnection', 'datasource', 'downstream'),
    rollup('downstreamSheetsConnection', 'sheet', 'downstream'),
    rollup('downstreamDashboardsConnection', 'dashboard', 'downstream'),
  ],
  field: [
    direct('columnsConnection', 'column', 'upstream', { on: 'ColumnField' }),
    direct('fieldsConnection', 'field', 'upstream', { on: 'FieldReferencingField' }),
    direct('remoteField', 'field', 'upstream', { on: 'DatasourceField', connection: false }),
    direct('referencedByFieldsConnection', 'field', 'downstream'),
    direct('referencedByCalculationsConnection', 'field', 'downstream'),
    direct('referencedByRemoteFieldsConnection', 'field', 'downstream'),
    direct('directSheetsConnection', 'sheet', 'downstream'),
    direct('referencedByFlowFieldInputFieldConnection', 'flow-input-field', 'downstream', {
      permissionMode: false,
    }),
    direct('referencedByFlowFieldOutputFieldConnection', 'flow-output-field', 'upstream'),
    direct('datasource', 'datasource', 'downstream', { connection: false, terminal: true }),
    rollup('upstreamFieldsConnection', 'field', 'upstream'),
    rollup('downstreamDashboardsConnection', 'dashboard', 'downstream'),
    rollup('downstreamFlowsConnection', 'flow', 'downstream'),
  ],
  'flow-input-field': [
    direct('column', 'column', 'upstream', { on: 'FlowColumnInputField', connection: false }),
    direct('field', 'field', 'upstream', { on: 'FlowFieldInputField', connection: false }),
    direct('childFieldsConnection', 'flow-output-field', 'downstream'),
    direct('flow', 'flow', 'downstream', { connection: false, terminal: true }),
  ],
  'flow-output-field': [
    direct('parentFieldsConnection', 'flow-input-field', 'upstream'),
    direct('column', 'column', 'downstream', { on: 'FlowColumnOutputField', connection: false }),
    direct('field', 'field', 'downstream', { on: 'FlowFieldOutputField', connection: false }),
    direct('flowOutputStep', 'flow-output-step', 'downstream', {
      connection: false,
      terminal: true,
    }),
    rollup('downstreamFlowsConnection', 'flow', 'downstream'),
    rollup('downstreamDatasourcesConnection', 'datasource', 'downstream'),
    rollup('downstreamSheetsConnection', 'sheet', 'downstream'),
    rollup('downstreamDashboardsConnection', 'dashboard', 'downstream'),
  ],
  flow: [
    direct('inputFieldsConnection', 'flow-input-field', 'upstream'),
    direct('outputFieldsConnection', 'flow-output-field', 'downstream'),
    direct('outputStepsConnection', 'flow-output-step', 'downstream'),
    { ...rollup('nextDownstreamFlowsConnection', 'flow', 'downstream'), terminal: false },
    { ...rollup('nextUpstreamFlowsConnection', 'flow', 'upstream'), terminal: false },
    rollup('downstreamDatasourcesConnection', 'datasource', 'downstream'),
    rollup('downstreamSheetsConnection', 'sheet', 'downstream'),
    rollup('downstreamDashboardsConnection', 'dashboard', 'downstream'),
    rollup('downstreamWorkbooksConnection', 'workbook', 'downstream'),
  ],
  'flow-output-step': [
    direct('outputFieldsConnection', 'flow-output-field', 'downstream'),
    direct('flow', 'flow', 'downstream', { connection: false, terminal: true }),
  ],
  datasource: [
    direct('fieldsConnection', 'field', 'downstream'),
    { ...rollup('upstreamFlowsConnection', 'flow', 'upstream'), on: 'PublishedDatasource' },
    rollup('downstreamSheetsConnection', 'sheet', 'downstream'),
    rollup('downstreamDashboardsConnection', 'dashboard', 'downstream'),
    { ...rollup('downstreamFlowsConnection', 'flow', 'downstream'), on: 'PublishedDatasource' },
  ],
  sheet: [
    direct('datasourceFieldsConnection', 'field', 'upstream'),
    direct('containedInDashboardsConnection', 'dashboard', 'downstream'),
    direct('workbook', 'workbook', 'downstream', { connection: false, terminal: true }),
  ],
  dashboard: [
    direct('sheetsConnection', 'sheet', 'upstream'),
    direct('workbook', 'workbook', 'downstream', { connection: false, terminal: true }),
  ],
};

export const metadataRoots: Partial<Record<LineageKind, string[]>> = {
  column: ['columnsConnection'],
  field: ['fieldsConnection'],
  datasource: ['publishedDatasourcesConnection', 'embeddedDatasourcesConnection'],
  flow: ['flowsConnection'],
  'flow-input-field': ['flowColumnInputFieldsConnection', 'flowFieldInputFieldsConnection'],
  'flow-output-field': ['flowColumnOutputFieldsConnection', 'flowFieldOutputFieldsConnection'],
  'flow-output-step': ['flowOutputStepsConnection'],
  sheet: ['sheetsConnection'],
  dashboard: ['dashboardsConnection'],
  workbook: ['workbooksConnection'],
};

// Private scope references are parsed separately and never copied to results.
export function identitySelection(kind: LineageKind): string {
  const basic = '__typename id';
  const flow = 'id luid';
  switch (kind) {
    case 'column':
      return `${basic} name dataType: remoteType table { name ... on DatabaseTable { schema database { name } } }`;
    case 'field':
      return `${basic} ... on Field { name datasource { __typename id ... on PublishedDatasource { luid } ... on EmbeddedDatasource { workbook { luid } } } ... on CalculatedField { formula dataType } ... on ColumnField { dataType } }`;
    case 'datasource':
      return `${basic} ... on Datasource { name ... on PublishedDatasource { luid } ... on EmbeddedDatasource { workbook { luid } } }`;
    case 'flow':
      return `${basic} name luid`;
    case 'flow-input-field':
      return `${basic} name flow { ${flow} }`;
    case 'flow-output-field':
      return `${basic} name flow { ${flow} }`;
    case 'flow-output-step':
      return `${basic} name stepId flow { ${flow} }`;
    case 'sheet':
    case 'dashboard':
      return `${basic} name luid workbook { luid }`;
    case 'workbook':
      return `${basic} name luid`;
    default:
      throw new Error('Flow-document nodes cannot be queried through Metadata API.');
  }
}

export function relationSelection(
  relation: Relation,
  alias: string,
  pageSize: number,
  after?: string,
): string {
  const selection = identitySelection(relation.target);
  const value = relation.connection
    ? `${alias}: ${relation.field}(first: ${pageSize}${relation.permissionMode === false ? '' : ', permissionMode: FILTER'}${after ? `, after: ${JSON.stringify(after)}` : ''}) { nodes { ${selection} } pageInfo { hasNextPage endCursor } }`
    : `${alias}: ${relation.field} { ${selection} }`;
  const interfaces: Record<string, string> = {
    FlowColumnInputField: 'FlowInputField',
    FlowFieldInputField: 'FlowInputField',
    FlowColumnOutputField: 'FlowOutputField',
    FlowFieldOutputField: 'FlowOutputField',
    PublishedDatasource: 'Datasource',
  };
  const wrapped = relation.on ? `... on ${relation.on} { ${value} }` : value;
  const scope = relation.on ? interfaces[relation.on] : undefined;
  return scope ? `... on ${scope} { ${wrapped} }` : wrapped;
}

export function metadataQuery(
  root: string,
  filter: string,
  selection: string,
  first = 1,
  after?: string,
): string {
  // This one published root has no permissionMode argument. Its values are
  // discovery-only until re-fetched through an owning Flow's FILTER connection.
  const permission = root === 'flowFieldInputFieldsConnection' ? '' : ', permissionMode: FILTER';
  return `query dataLineage { asset: ${root}(filter: { ${filter} }, first: ${first}${permission}${after ? `, after: ${JSON.stringify(after)}` : ''}) { nodes { ${selection} } pageInfo { hasNextPage endCursor } } }`;
}

export function prepInputVisibilityQuery(flowId: string, inputId: string): string {
  return metadataQuery(
    'flowsConnection',
    `id: ${JSON.stringify(flowId)}`,
    `${identitySelection('flow')} r0: inputFieldsConnection(filter: { id: ${JSON.stringify(inputId)} }, first: 1, permissionMode: FILTER) { nodes { ${identitySelection('flow-input-field')} } pageInfo { hasNextPage endCursor } }`,
  );
}
