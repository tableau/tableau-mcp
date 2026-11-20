import {
  getEnabledFormatElement,
  listAvailableFieldsFromWorkbook,
  normalizeLogicalTableId,
} from './field-builder.js';
import { normalizeArray, parseXML } from './parser.js';

export type Cardinality = 'not-set' | 'one' | 'many';

export interface RelationshipEndPoint {
  tableId: string;
  uniqueKey?: string;
  guaranteedValue?: string;
  isDbSetUniqueKey?: string;
  isDbSetGuaranteedValue?: string;
  cardinality: Cardinality;
}

export interface RelationshipFieldPair {
  operator: string;
  fromField: string;
  toField: string;
}

export interface JoinClause {
  operator: string;
  left: string;
  right: string;
}

export interface DataModelRelationship {
  fromTableId: string;
  toTableId: string;
  operator?: string;
  fields: RelationshipFieldPair[];
  from: RelationshipEndPoint;
  to: RelationshipEndPoint;
}

export interface PhysicalRelation {
  type: string;
  join?: string;
  all?: string;
  name?: string;
  table?: string;
  connection?: string;
  clauses?: JoinClause[];
  children: PhysicalRelation[];
}

export interface LogicalTable {
  id: string;
  caption?: string;
  isLegacy: boolean;
  physical?: PhysicalRelation;
  /** Fields the table owns; absent when no field carries a logical table id. */
  measures?: number;
  dimensions?: number;
  /** Relationships with this table at either end point. */
  relationships: number;
}

export function tableLabel(tables: LogicalTable[], id: string): string {
  return tables.find((t) => t.id === id)?.caption ?? (id || '(unknown table)');
}

export type DataModelProblemKind =
  | 'no-join-field'
  | 'constant-join-side'
  | 'orphan-table'
  | 'many-to-many'
  | 'duplicate-table'
  | 'dangling-endpoint';

export interface DataModelProblem {
  kind: DataModelProblemKind;
  tables?: string[];
  relationship?: number;
  message: string;
}

export interface DataModelDatasource {
  name: string;
  caption?: string;
  tables: LogicalTable[];
  relationships: DataModelRelationship[];
  /** Visible fields tied to no table (mostly calcs). Omitted when no field is tied to any table. */
  untiedFields?: { measures: number; dimensions: number };
  problems: DataModelProblem[];
  notes: string[];
}

export interface DataModelResult {
  datasources: DataModelDatasource[];
}

type OperandKind = 'field' | 'calc' | 'constant';
type Operand = { text: string; kind: OperandKind };
type ExpressionTerm = { operator: string; left: Operand; right: Operand };
type ParsedRelationship = DataModelRelationship & { terms: ExpressionTerm[] };

const TABLEAU_DEFAULT_TEXT = 'not set (Tableau default)';

function attr(node: any, name: string): string | undefined {
  const value = node?.[`@_${name}`];
  return typeof value === 'string' ? value : undefined;
}

function isFieldName(op: string): boolean {
  const trimmed = op.trim();
  return trimmed.length > 2 && trimmed.startsWith('[') && trimmed.endsWith(']');
}

function readOperand(expression: any): Operand | undefined {
  const op = attr(expression, 'op');
  if (op === undefined) return undefined;
  const children = normalizeArray(expression.expression)
    .map(readOperand)
    .filter((child): child is Operand => child !== undefined);
  if (children.length === 0) {
    return { text: op.trim(), kind: isFieldName(op) ? 'field' : 'constant' };
  }
  const name = op.trim();
  const inner = children.map((child) => child.text);
  const text = /^[A-Za-z_]\w*$/.test(name)
    ? `${name}(${inner.join(', ')})`
    : inner.length === 1
      ? `${name}${inner[0]}`
      : `(${inner.join(` ${name} `)})`;
  return { text, kind: children.some((child) => child.kind !== 'constant') ? 'calc' : 'constant' };
}

function collectTerms(expression: any, terms: ExpressionTerm[]): void {
  const operator = attr(expression, 'op');
  if (operator === undefined) return;
  const children = normalizeArray(expression.expression);
  if (operator.toUpperCase() === 'AND') {
    for (const child of children) collectTerms(child, terms);
    return;
  }
  const left = readOperand(children[0]);
  const right = readOperand(children[1]);
  if (children.length === 2 && left && right) terms.push({ operator, left, right });
}

const showTerm = (t: ExpressionTerm): string => `${t.left.text} ${t.operator} ${t.right.text}`;

function readPhysical(relation: any): PhysicalRelation {
  const type = attr(relation, 'type') ?? 'unknown';
  const node: PhysicalRelation = { type, children: [] };
  if (type !== 'table' && type !== 'join' && type !== 'union') return node;

  for (const key of ['join', 'all', 'name', 'table', 'connection'] as const) {
    const value = attr(relation, key);
    if (value !== undefined) node[key] = value;
  }
  const terms: ExpressionTerm[] = [];
  collectTerms(relation?.clause?.expression, terms);
  if (terms.length > 0) {
    node.clauses = terms.map((t) => ({
      operator: t.operator,
      left: t.left.text,
      right: t.right.text,
    }));
  }
  node.children = normalizeArray(relation.relation).map(readPhysical);
  return node;
}

function forEachLeaf(
  relation: PhysicalRelation | undefined,
  visit: (leaf: PhysicalRelation) => void,
): void {
  if (!relation) return;
  if (relation.type === 'table') visit(relation);
  for (const child of relation.children) forEachLeaf(child, visit);
}

function readEndPoint(endPoint: any): RelationshipEndPoint {
  const uniqueKey = attr(endPoint, 'unique-key');
  const guaranteedValue = attr(endPoint, 'guaranteed-value');
  const isDbSetUniqueKey = attr(endPoint, 'is-db-set-unique-key');
  const isDbSetGuaranteedValue = attr(endPoint, 'is-db-set-guaranteed-value');
  return {
    tableId: normalizeLogicalTableId(attr(endPoint, 'object-id')) ?? '',
    ...(uniqueKey !== undefined ? { uniqueKey } : {}),
    ...(guaranteedValue !== undefined ? { guaranteedValue } : {}),
    ...(isDbSetUniqueKey !== undefined ? { isDbSetUniqueKey } : {}),
    ...(isDbSetGuaranteedValue !== undefined ? { isDbSetGuaranteedValue } : {}),
    cardinality: uniqueKey === 'true' ? 'one' : uniqueKey === 'false' ? 'many' : 'not-set',
  };
}

function readRelationship(relationship: any): ParsedRelationship {
  const terms: ExpressionTerm[] = [];
  collectTerms(relationship?.expression, terms);
  const from = readEndPoint(relationship?.['first-end-point']);
  const to = readEndPoint(relationship?.['second-end-point']);
  const operator = attr(relationship?.expression, 'op');
  return {
    fromTableId: from.tableId,
    toTableId: to.tableId,
    ...(operator !== undefined ? { operator } : {}),
    fields: terms
      .filter((t) => t.left.kind !== 'constant' && t.right.kind !== 'constant')
      .map((t) => ({ operator: t.operator, fromField: t.left.text, toField: t.right.text })),
    from,
    to,
    terms,
  };
}

function readTables(datasource: any, graph: any, notes: string[]): LogicalTable[] {
  if (!graph) {
    const relations = normalizeArray(datasource.connection?.relation);
    if (relations.length !== 1 || attr(relations[0], 'type') === 'collection') {
      notes.push('No object graph and no single connection relation; tables not read.');
      return [];
    }
    const physical = readPhysical(relations[0]);
    const id = physical.name ?? attr(datasource, 'name') ?? 'legacy';
    notes.push('No object graph; read the single connection relation as one legacy table.');
    return [{ id, caption: physical.name, isLegacy: true, physical, relationships: 0 }];
  }

  const isLegacy = attr(graph, 'is-legacy') === 'true';
  const tables: LogicalTable[] = [];
  for (const object of normalizeArray(graph.objects?.object)) {
    const id = normalizeLogicalTableId(attr(object, 'id'));
    if (!id) continue;
    const properties = normalizeArray(object.properties).find((p) => attr(p, 'context') === '');
    const relation = normalizeArray(properties?.relation)[0];
    tables.push({
      id,
      ...(attr(object, 'caption') !== undefined ? { caption: attr(object, 'caption') } : {}),
      isLegacy,
      ...(relation ? { physical: readPhysical(relation) } : {}),
      relationships: 0,
    });
  }
  return tables;
}

function countTableFacts(
  tables: LogicalTable[],
  relationships: ParsedRelationship[],
  owned: { role: string; logicalTableId?: string }[],
): void {
  for (const table of tables) {
    table.relationships = relationships.filter(
      (r) => r.fromTableId === table.id || r.toTableId === table.id,
    ).length;
    if (owned.length > 0) {
      table.measures = owned.filter(
        (f) => f.logicalTableId === table.id && f.role === 'measure',
      ).length;
      table.dimensions = owned.filter(
        (f) => f.logicalTableId === table.id && f.role === 'dimension',
      ).length;
    }
  }
}

function findProblems(
  tables: LogicalTable[],
  relationships: ParsedRelationship[],
  hasGraph: boolean,
): DataModelProblem[] {
  const problems: DataModelProblem[] = [];
  const declared = new Set(tables.map((t) => t.id));
  const label = (id: string): string => tableLabel(tables, id);

  relationships.forEach((r, index) => {
    const pair = `${label(r.fromTableId)} to ${label(r.toTableId)}`;
    const tablesInRelationship = [r.fromTableId, r.toTableId];

    const sides = r.terms.flatMap((t) => [t.left, t.right]);
    if (sides.every((side) => side.kind === 'constant')) {
      const shown = r.terms.map(showTerm).join(' AND ');
      problems.push({
        kind: 'no-join-field',
        tables: tablesInRelationship,
        relationship: index,
        message: shown
          ? `${pair} joins on ${shown}: no side is a field, so every row matches every row.`
          : `${pair} has no join expression.`,
      });
    } else {
      const constantTerm = r.terms.find(
        (t) => (t.left.kind === 'constant') !== (t.right.kind === 'constant'),
      );
      if (constantTerm) {
        problems.push({
          kind: 'constant-join-side',
          tables: tablesInRelationship,
          relationship: index,
          message: `${pair} joins on ${showTerm(constantTerm)}: one side is a constant, not a field.`,
        });
      }
    }

    for (const end of [r.from, r.to]) {
      if (!end.tableId || !declared.has(end.tableId)) {
        problems.push({
          kind: 'dangling-endpoint',
          tables: [end.tableId],
          relationship: index,
          message: `${pair} points at table id "${end.tableId}", which no logical table declares.`,
        });
      }
    }

    const manyLike = (c: Cardinality): boolean => c === 'many' || c === 'not-set';
    if (manyLike(r.from.cardinality) && manyLike(r.to.cardinality)) {
      const notSet = [r.from, r.to].filter((e) => e.cardinality === 'not-set').length;
      const why =
        notSet === 2
          ? `cardinality ${TABLEAU_DEFAULT_TEXT} on both sides`
          : notSet === 1
            ? `one side set to Many, the other ${TABLEAU_DEFAULT_TEXT}`
            : 'both sides explicitly set to Many';
      problems.push({
        kind: 'many-to-many',
        tables: tablesInRelationship,
        relationship: index,
        message:
          notSet > 0
            ? `${pair} is many-to-many: ${why}. Tableau treats an unset side as Many and assumes some records match.`
            : `${pair} is many-to-many: ${why}.`,
      });
    }
  });

  if (hasGraph && tables.length >= 2) {
    const related = new Set(relationships.flatMap((r) => [r.fromTableId, r.toTableId]));
    for (const table of tables) {
      if (!related.has(table.id)) {
        problems.push({
          kind: 'orphan-table',
          tables: [table.id],
          message: `${label(table.id)} is in no relationship.`,
        });
      }
    }
  }

  const byCaption = new Map<string, string[]>();
  const byLeaf = new Map<string, Set<string>>();
  for (const table of tables) {
    if (table.caption !== undefined) {
      byCaption.set(table.caption, [...(byCaption.get(table.caption) ?? []), table.id]);
    }
    forEachLeaf(table.physical, (leaf) => {
      // Every object of a published datasource shares the [sqlproxy] leaf.
      if (leaf.table === undefined || leaf.table === '[sqlproxy]') return;
      const key = `${leaf.connection ?? ''}|${leaf.table}`;
      byLeaf.set(key, (byLeaf.get(key) ?? new Set()).add(table.id));
    });
  }
  for (const [caption, ids] of byCaption) {
    if (ids.length > 1) {
      problems.push({
        kind: 'duplicate-table',
        tables: ids,
        message: `${ids.length} logical tables share the caption "${caption}".`,
      });
    }
  }
  for (const [key, ids] of byLeaf) {
    if (ids.size > 1) {
      const [connection, table] = key.split('|');
      problems.push({
        kind: 'duplicate-table',
        tables: [...ids],
        message: `${[...ids].map(label).join(', ')} all read ${table} from connection ${connection || '(none)'}.`,
      });
    }
  }

  return problems;
}

/** Logical tables, relationships, field and relationship counts, and model problems, per datasource. */
export function describeDataModel(workbookXml: string): DataModelResult {
  const workbook = parseXML(workbookXml);
  const fields = listAvailableFieldsFromWorkbook(workbook);
  const datasources: DataModelDatasource[] = [];

  for (const datasource of normalizeArray(workbook.workbook?.datasources?.datasource) as any[]) {
    const name = attr(datasource, 'name');
    if (!name || name === 'Parameters') continue;

    const notes: string[] = [];
    const graph = getEnabledFormatElement(datasource, 'object-graph');
    const tables = readTables(datasource, graph, notes);
    const relationships = graph
      ? normalizeArray(graph.relationships?.relationship).map(readRelationship)
      : [];

    const dsFields = fields.filter((f) => f.datasource === name);
    const owned = dsFields.filter((f) => f.logicalTableId !== undefined);
    const untied = dsFields.filter((f) => f.logicalTableId === undefined);
    countTableFacts(tables, relationships, owned);
    const problems = findProblems(tables, relationships, graph !== undefined);

    datasources.push({
      name,
      ...(attr(datasource, 'caption') !== undefined
        ? { caption: attr(datasource, 'caption') }
        : {}),
      tables,
      ...(owned.length > 0
        ? {
            untiedFields: {
              measures: untied.filter((f) => f.role === 'measure').length,
              dimensions: untied.filter((f) => f.role === 'dimension').length,
            },
          }
        : {}),
      relationships: relationships.map(({ terms: _terms, ...relationship }) => relationship),
      problems,
      notes,
    });
  }

  return { datasources };
}
