import { bareName } from '../binder/schema-summary.js';
import { getCalculationFieldReferences } from '../formulaAggregation.js';
import { parsedXmlNamesEqual } from '../xmlElement.js';
import { isInternalColumnName, listAvailableFieldsFromWorkbook } from './field-builder.js';
import {
  parseCanonicalColumnRef,
  parseColumnInstanceRef,
  parseDatasourceQualifiedColumnRef,
} from './field-resolver.js';
import { normalizeArray, parseXML } from './parser.js';
import { collectPlacements, placementsForField } from './searchWorkbookFields.js';
import type { ParsedWorkbook } from './types.js';

export type DependencyNodeKind = 'field' | 'calculation' | 'parameter' | 'worksheet' | 'dashboard';
export type DependencyEdgeKind = 'formula' | 'uses' | 'contains';
export type DependencyDirection = 'dependents' | 'dependencies';

export interface DependencyNode {
  id: string;
  kind: DependencyNodeKind;
  name: string;
  caption?: string;
  datasource?: string;
  datasourceCaption?: string;
  /** A hidden datasource column: present in the workbook but not offered for authoring. */
  hidden?: true;
  /** A formula or worksheet names this field, but the workbook declares no such field. */
  unresolved?: true;
  /** A calculation declared only inside this worksheet, not on its datasource. */
  worksheet?: string;
}

/** `from` depends on `to`. */
export interface DependencyEdge {
  from: string;
  to: string;
  kind: DependencyEdgeKind;
  /** For 'uses' edges: rows, columns, encoding:<channel>, filter or sort. */
  locations?: string[];
}

/** A worksheet part this tool saw but could not follow. */
export interface UnreadablePart {
  /** The worksheet, or the dashboard when `dashboard` is set. */
  worksheet: string;
  reason: string;
  dashboard?: true;
}

export interface DependencyGraph {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
  unreadable: UnreadablePart[];
}

export interface DependencyTrace {
  root: DependencyNode;
  nodes: Array<DependencyNode & { depth: number }>;
  edges: DependencyEdge[];
  /** Each entry lists the nodes of one formula cycle, including a calc that names itself. */
  cycles: string[][];
}

export interface FieldDependenciesResult {
  field: string;
  direction: DependencyDirection;
  ambiguous: boolean;
  summary: string;
  roots: DependencyTrace[];
  /** Fixed limits first, then one entry per worksheet part this tool saw but could not follow. */
  notCovered: readonly string[];
}

export const DEPENDENCIES_NOT_COVERED = [
  'dashboard actions',
  'groups or sets declared inside a worksheet, and set actions',
  'story points',
  'reference lines and table calculation addressing',
  'datasource filters and extracts',
  'published datasource internals',
  'anything outside the workbook XML',
] as const;

/** Most matching fields traced in one result; the rest are counted in the summary. */
export const MAX_DEPENDENCY_ROOTS = 5;

const PARAMETERS_DATASOURCE = 'Parameters';

function fieldNodeId(datasource: string, bareName: string): string {
  return `${datasource}\u0000${bareName}`;
}

/** `[:Measure Names]` and friends: Tableau-generated columns that are not workbook fields. */
function isPseudoColumn(columnName: string): boolean {
  return bareName(columnName).startsWith(':') || isInternalColumnName(columnName);
}

// Group-filter attributes whose values are literals, not field references.
const GROUPFILTER_LITERAL_ATTRIBUTES = new Set(['member', 'from', 'to', 'function', 'direction']);

/** Calls `visit` with every attribute value in a group-filter tree that may name a field. */
function walkGroupFilter(groupFilter: any, visit: (value: string) => void): void {
  for (const [attribute, value] of Object.entries<any>(groupFilter ?? {})) {
    if (!attribute.startsWith('@_') || typeof value !== 'string') continue;
    const name = attribute.slice(2);
    if (name.startsWith('user:') || GROUPFILTER_LITERAL_ATTRIBUTES.has(name)) continue;
    if (value.includes('[')) visit(value);
  }
  for (const nested of normalizeArray<any>(groupFilter?.groupfilter))
    walkGroupFilter(nested, visit);
}

/** Every field a formula-like value names; `instanceColumns` maps `[sum:Sales:qk]` back to `Sales`. */
function columnsReferencedIn(
  value: string,
  defaultDatasource: string,
  instanceColumns: ReadonlyMap<string, string>,
): Array<{ datasource: string; column: string }> {
  return getCalculationFieldReferences(value).map((reference) => {
    const datasource = reference.datasource ?? defaultDatasource;
    const column =
      instanceColumns.get(fieldNodeId(datasource, reference.field)) ??
      parseColumnInstanceRef(`[${reference.field}]`)?.localFieldName ??
      reference.field;
    return { datasource, column };
  });
}

/** Text of every `<run>` under `value`, where titles, captions and tooltips keep their text. */
function collectRunText(value: unknown, into: string[] = []): string[] {
  if (!value || typeof value !== 'object') return into;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'run') {
      for (const run of normalizeArray<any>(child as any)) {
        const text = typeof run === 'string' ? run : run?.['#text'];
        if (typeof text === 'string') into.push(text);
      }
    } else {
      collectRunText(child, into);
    }
  }
  return into;
}

/** `<[datasource].[field]>` references inside rich text. */
function textReferences(text: string): string[] {
  return [...text.matchAll(/<(\[[^<>]*\])>/g)].map((match) => match[1]);
}

export function buildDependencyGraph(workbookXml: string): DependencyGraph {
  const workbook = parseXML(workbookXml);
  const nodes = new Map<string, DependencyNode>();
  const edges = new Map<string, DependencyEdge>();
  const datasources = normalizeArray(workbook.workbook?.datasources?.datasource);
  const datasourceCaptions = new Map<string, string>();
  const datasourceNames = new Set<string>();
  for (const datasource of datasources) {
    if (typeof datasource['@_name'] === 'string') datasourceNames.add(datasource['@_name']);
    const caption = datasource['@_caption'];
    if (typeof caption === 'string' && caption !== datasource['@_name']) {
      datasourceCaptions.set(datasource['@_name'], caption);
    }
  }

  /** A worksheet `<column>` that is a plain field: no calculation, no group, on a datasource the workbook has. */
  const isPlainSheetField = (column: any, datasource: string): boolean =>
    column.calculation === undefined &&
    column.group === undefined &&
    datasourceNames.has(datasource);

  const addFieldNode = (node: Omit<DependencyNode, 'id' | 'datasourceCaption'>): string => {
    const datasource = node.datasource ?? '';
    const id = fieldNodeId(datasource, node.name);
    if (!nodes.has(id)) {
      const datasourceCaption = datasourceCaptions.get(datasource);
      nodes.set(id, { id, ...node, ...(datasourceCaption ? { datasourceCaption } : {}) });
    }
    return id;
  };
  const addEdge = (edge: DependencyEdge): DependencyEdge => {
    const key = `${edge.kind}\u0000${edge.from}\u0000${edge.to}`;
    const existing = edges.get(key);
    if (existing) return existing;
    edges.set(key, edge);
    return edge;
  };
  const resolveReference = (datasource: string, field: string): string => {
    const id = fieldNodeId(datasource, field);
    if (nodes.has(id)) return id;
    return addFieldNode({
      kind: datasource === PARAMETERS_DATASOURCE ? 'parameter' : 'field',
      name: field,
      datasource,
      unresolved: true,
    });
  };

  const formulas = collectFormulas(workbook);
  for (const field of listAvailableFieldsFromWorkbook(workbook)) {
    const name = bareName(field.columnName);
    addFieldNode({
      kind: formulas.has(fieldNodeId(field.datasource, name)) ? 'calculation' : 'field',
      name,
      ...(field.caption ? { caption: field.caption } : {}),
      datasource: field.datasource,
    });
  }

  for (const datasource of datasources) {
    const datasourceName = datasource['@_name'];
    if (typeof datasourceName !== 'string') continue;
    for (const column of normalizeArray<any>(datasource.column)) {
      const columnName = column?.['@_name'];
      if (typeof columnName !== 'string') continue;
      if (isInternalColumnName(columnName)) continue;
      const name = bareName(columnName);
      const caption = column['@_caption'];
      if (datasourceName === PARAMETERS_DATASOURCE) {
        addFieldNode({
          kind: 'parameter',
          name,
          ...(typeof caption === 'string' ? { caption } : {}),
          datasource: datasourceName,
        });
      } else if (column['@_hidden'] === 'true') {
        addFieldNode({
          kind: formulas.has(fieldNodeId(datasourceName, name)) ? 'calculation' : 'field',
          name,
          ...(typeof caption === 'string' ? { caption } : {}),
          datasource: datasourceName,
          hidden: true,
        });
      }
    }
    for (const set of normalizeArray<any>(datasource.group)) {
      const setName = set?.['@_name'];
      if (typeof setName !== 'string' || isInternalColumnName(setName)) continue;
      const caption = set['@_caption'];
      addFieldNode({
        kind: 'field',
        name: bareName(setName),
        ...(typeof caption === 'string' ? { caption } : {}),
        datasource: datasourceName,
      });
    }
  }

  for (const [calcId, { datasource, formula }] of formulas) {
    if (!nodes.has(calcId)) continue;
    for (const reference of getCalculationFieldReferences(formula)) {
      const to = resolveReference(reference.datasource ?? datasource, reference.field);
      addEdge({ from: calcId, to, kind: 'formula' });
    }
  }

  // A set depends on every field its group-filter tree names; a bin on its source column.
  for (const datasource of datasources) {
    const datasourceName = datasource['@_name'];
    if (typeof datasourceName !== 'string') continue;
    for (const set of normalizeArray<any>(datasource.group)) {
      const setName = set?.['@_name'];
      const from =
        typeof setName === 'string' ? fieldNodeId(datasourceName, bareName(setName)) : '';
      if (!nodes.has(from)) continue;
      const visit = (value: string): void => {
        for (const { datasource: ds, column } of columnsReferencedIn(
          value,
          datasourceName,
          new Map(),
        )) {
          addEdge({ from, to: resolveReference(ds, column), kind: 'formula' });
        }
      };
      // The group's own name and caption are not references; only its group-filter tree is.
      for (const groupFilter of normalizeArray<any>(set.groupfilter))
        walkGroupFilter(groupFilter, visit);
    }
    for (const column of normalizeArray<any>(datasource.column)) {
      const columnName = column?.['@_name'];
      const source = column?.calculation?.['@_column'];
      if (typeof columnName !== 'string' || typeof source !== 'string') continue;
      if (column.calculation['@_class'] !== 'categorical-bin') continue;
      const from = fieldNodeId(datasourceName, bareName(columnName));
      if (!nodes.has(from)) continue;
      addEdge({ from, to: resolveReference(datasourceName, bareName(source)), kind: 'formula' });
    }
  }

  const unreadableParts: UnreadablePart[] = [];
  const addUnreadable = (part: UnreadablePart): void => {
    if (!unreadableParts.some((p) => p.worksheet === part.worksheet && p.reason === part.reason)) {
      unreadableParts.push(part);
    }
  };
  // Judged after every sheet is read: a later sheet can declare a field an earlier one only named.
  const namedFields: Array<{ id: string; part: UnreadablePart }> = [];
  const worksheets = normalizeArray(workbook.workbook?.worksheets?.worksheet);
  const placements = collectPlacements(worksheets);
  for (const worksheet of worksheets) {
    const worksheetName = worksheet['@_name'];
    if (typeof worksheetName !== 'string') continue;
    const worksheetId = `worksheet\u0000${worksheetName}`;
    nodes.set(worksheetId, { id: worksheetId, kind: 'worksheet', name: worksheetName });

    const unreadable = (reason: string): void =>
      addUnreadable({ worksheet: worksheetName, reason });
    const view: Record<string, any> | undefined = worksheet.table?.view;
    const dependencyBlocks = normalizeArray<any>(view?.['datasource-dependencies']).filter(
      (block) => typeof block?.['@_datasource'] === 'string',
    );

    // Calcs declared only in this worksheet resolve here first, so their inputs are followed.
    const adHocCalcs = new Map<string, { id: string; datasource: string; formula: string }>();
    // `[sum:Sales:qk]` -> `Sales`, per datasource, for references that name a column-instance.
    const instanceColumns = new Map<string, string>();
    for (const block of dependencyBlocks) {
      const datasource: string = block['@_datasource'];
      if (datasource === PARAMETERS_DATASOURCE) continue;
      for (const instance of normalizeArray<any>(block['column-instance'])) {
        const name = instance?.['@_name'];
        const column = instance?.['@_column'];
        if (typeof name === 'string' && typeof column === 'string') {
          instanceColumns.set(fieldNodeId(datasource, bareName(name)), bareName(column));
        }
      }
      for (const column of normalizeArray<any>(block.column)) {
        const columnName = column?.['@_name'];
        if (typeof columnName !== 'string' || isPseudoColumn(columnName)) continue;
        const name = bareName(columnName);
        const existing = nodes.get(fieldNodeId(datasource, name));
        if (isPlainSheetField(column, datasource)) {
          // A sheet can declare a physical field its datasource lists nowhere (extract-only, older workbooks).
          const caption = column['@_caption'];
          if (!existing) {
            addFieldNode({
              kind: 'field',
              name,
              ...(typeof caption === 'string' ? { caption } : {}),
              datasource,
            });
          } else if (existing.kind === 'field' && existing.unresolved) {
            // A datasource calc named it first, as an unresolved placeholder.
            delete existing.unresolved;
            if (typeof caption === 'string') existing.caption = caption;
          }
          continue;
        }
        if (existing && !existing.unresolved) continue;
        if (column.group !== undefined) {
          unreadable(`group ${name} declared in the worksheet`);
          continue;
        }
        if (column.calculation === undefined || existing) continue;
        const formula = column.calculation['@_formula'];
        if (typeof formula !== 'string') {
          unreadable(`calculation ${name} has no readable formula`);
          continue;
        }
        const caption = column['@_caption'];
        const adHocId = `adhoc\u0000${worksheetName}\u0000${datasource}\u0000${name}`;
        const datasourceCaption = datasourceCaptions.get(datasource);
        nodes.set(adHocId, {
          id: adHocId,
          kind: 'calculation',
          name,
          ...(typeof caption === 'string' ? { caption } : {}),
          datasource,
          ...(datasourceCaption ? { datasourceCaption } : {}),
          worksheet: worksheetName,
        });
        adHocCalcs.set(fieldNodeId(datasource, name), { id: adHocId, datasource, formula });
      }
    }

    const resolveInSheet = (datasource: string, field: string): string =>
      adHocCalcs.get(fieldNodeId(datasource, field))?.id ?? resolveReference(datasource, field);
    for (const { id, datasource, formula } of adHocCalcs.values()) {
      for (const reference of getCalculationFieldReferences(formula)) {
        const to = resolveInSheet(reference.datasource ?? datasource, reference.field);
        addEdge({ from: id, to, kind: 'formula' });
      }
    }

    const addUse = (datasource: string, field: string, location?: string): void => {
      if (isPseudoColumn(field)) return;
      const to = resolveInSheet(datasource, field);
      namedFields.push({
        id: to,
        part: { worksheet: worksheetName, reason: `${field} is not a field this tool can read` },
      });
      const edge = addEdge({ from: worksheetId, to, kind: 'uses', locations: [] });
      const locations = edge.locations ?? [];
      if (location === undefined) {
        for (const placement of placementsForField(placements, datasource, field)) {
          if (placement.worksheet !== worksheetName) continue;
          const shelf =
            placement.location === 'encoding'
              ? `encoding:${placement.encoding}`
              : placement.location;
          if (!locations.includes(shelf)) locations.push(shelf);
        }
      } else if (!locations.includes(location)) {
        locations.push(location);
      }
      edge.locations = locations;
    };

    // Only column-instances are direct uses: add-field also declares a calc's inputs as <column>.
    for (const block of dependencyBlocks) {
      for (const instance of normalizeArray<any>(block['column-instance'])) {
        const column = instance?.['@_column'];
        if (typeof column === 'string') addUse(block['@_datasource'], bareName(column));
      }
      if (block['@_datasource'] !== PARAMETERS_DATASOURCE) continue;
      for (const column of normalizeArray<any>(block.column)) {
        const columnName = column?.['@_name'];
        if (typeof columnName === 'string')
          addUse(PARAMETERS_DATASOURCE, bareName(columnName), 'declared');
      }
    }

    /** Follow every field a filter attribute names; `defaultDatasource` qualifies bare names. */
    const addReferencesIn = (value: string, defaultDatasource: string, location: string): void => {
      for (const { datasource, column } of columnsReferencedIn(
        value,
        defaultDatasource,
        instanceColumns,
      )) {
        addUse(datasource, column, location);
      }
    };
    const followGroupFilter = (groupFilter: any, defaultDatasource: string): void =>
      walkGroupFilter(groupFilter, (value) => addReferencesIn(value, defaultDatasource, 'filter'));
    const soleDatasource = dependencyBlocks.length === 1 ? dependencyBlocks[0]['@_datasource'] : '';

    for (const filter of normalizeArray<any>(view?.filter)) {
      const column = filter?.['@_column'];
      if (typeof column !== 'string') {
        unreadable('a filter with no column');
        continue;
      }
      const qualified = parseDatasourceQualifiedColumnRef(column);
      if (!qualified) {
        unreadable(`a filter on ${column}, which is not a datasource-qualified field`);
        continue;
      }
      if (!isPseudoColumn(qualified.columnInstanceName)) {
        const canonical = parseCanonicalColumnRef(column);
        addUse(
          qualified.datasource,
          canonical ? canonical.localFieldName : bareName(qualified.columnInstanceName),
          'filter',
        );
      }
      followGroupFilter(filter, qualified.datasource);
    }
    for (const sort of normalizeArray<any>(view?.['computed-sort'])) {
      for (const attribute of ['@_column', '@_using']) {
        const value = sort?.[attribute];
        if (typeof value === 'string') addReferencesIn(value, soleDatasource, 'sort');
      }
    }
    const soleOrNone = dependencyBlocks.filter((b) => b['@_datasource'] !== PARAMETERS_DATASOURCE);
    for (const text of collectRunText(worksheet)) {
      for (const reference of textReferences(text)) {
        addReferencesIn(
          reference,
          soleOrNone.length === 1 ? soleOrNone[0]['@_datasource'] : '',
          'text',
        );
      }
    }
    if (containsKey(worksheet, 'reference-line')) {
      unreadable('reference lines, whose formulas this tool does not read');
    }
  }

  const worksheetNodes = [...nodes.values()].filter((node) => node.kind === 'worksheet');
  for (const dashboard of normalizeArray<any>(workbook.workbook?.dashboards?.dashboard)) {
    const dashboardName = dashboard?.['@_name'];
    if (typeof dashboardName !== 'string' || dashboard['@_type'] === 'storyboard') continue;
    const dashboardId = `dashboard\u0000${dashboardName}`;
    nodes.set(dashboardId, { id: dashboardId, kind: 'dashboard', name: dashboardName });
    for (const zoneName of worksheetZoneNames(dashboard)) {
      const worksheet = worksheetNodes.find((node) => parsedXmlNamesEqual(node.name, zoneName));
      if (worksheet) addEdge({ from: dashboardId, to: worksheet.id, kind: 'contains' });
    }

    const addDashboardUse = (datasource: string, field: string, location: string): void => {
      if (isPseudoColumn(field)) return;
      const to = resolveReference(datasource, field);
      namedFields.push({
        id: to,
        part: {
          worksheet: dashboardName,
          reason: `${field} is not a field this tool can read`,
          dashboard: true,
        },
      });
      const edge = addEdge({ from: dashboardId, to, kind: 'uses', locations: [] });
      edge.locations = edge.locations ?? [];
      if (!edge.locations.includes(location)) edge.locations.push(location);
    };
    for (const text of collectRunText(dashboard)) {
      for (const reference of textReferences(text)) {
        for (const { datasource, column } of columnsReferencedIn(reference, '', new Map())) {
          addDashboardUse(datasource, column, 'text');
        }
      }
    }
    for (const { ref, location, zoneType, classified } of zoneFieldRefs(dashboard)) {
      for (const { datasource, column } of columnsReferencedIn(
        ref,
        PARAMETERS_DATASOURCE,
        new Map(),
      )) {
        if (classified) {
          addDashboardUse(datasource, column, location);
        } else if (datasource === PARAMETERS_DATASOURCE) {
          addDashboardUse(datasource, column, 'control');
        } else {
          addDashboardUse(datasource, column, 'other');
          addUnreadable({
            worksheet: dashboardName,
            reason: `a ${zoneType} zone uses ${column}, which this tool doesn't classify`,
            dashboard: true,
          });
        }
      }
    }
  }

  for (const { id, part } of namedFields) {
    if (nodes.get(id)?.unresolved) addUnreadable(part);
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()], unreadable: unreadableParts };
}

function containsKey(value: unknown, key: string): boolean {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([name, child]) => name === key || containsKey(child, key));
}

function collectFormulas(
  workbook: ParsedWorkbook,
): Map<string, { datasource: string; formula: string }> {
  const formulas = new Map<string, { datasource: string; formula: string }>();
  for (const datasource of normalizeArray(workbook.workbook?.datasources?.datasource)) {
    const datasourceName = datasource['@_name'];
    // Parameter "formulas" are literal current values, not references.
    if (typeof datasourceName !== 'string' || datasourceName === PARAMETERS_DATASOURCE) continue;
    for (const column of normalizeArray<any>(datasource.column)) {
      const columnName = column?.['@_name'];
      const formula = column?.calculation?.['@_formula'];
      if (typeof columnName === 'string' && typeof formula === 'string') {
        formulas.set(fieldNodeId(datasourceName, bareName(columnName)), {
          datasource: datasourceName,
          formula,
        });
      }
    }
  }
  return formulas;
}

/** Same zone rule as dashboardViewpoints.worksheetZoneName, over parsed XML; includes device layouts. */
function worksheetZoneNames(dashboard: any): string[] {
  const names: string[] = [];
  const visit = (zones: unknown): void => {
    for (const zone of normalizeArray<any>(zones as any)) {
      const name = zone?.['@_name'];
      const type = zone?.['@_type-v2'];
      if (typeof name === 'string' && name && (type === undefined || type === 'visual')) {
        names.push(name);
      }
      visit(zone?.zone);
    }
  };
  visit(dashboard.zones?.zone);
  for (const layout of normalizeArray<any>(dashboard.devicelayouts?.devicelayout)) {
    visit(layout?.zones?.zone);
  }
  return names;
}

/** `type-v2` of a zone -> the location its `param` reference is a use at. */
const ZONE_PARAM_LOCATIONS: Record<string, string> = {
  paramctrl: 'control',
  filter: 'filter',
  color: 'legend',
  size: 'legend',
  shape: 'legend',
  highlighter: 'highlight',
  currpage: 'pages',
};

interface ZoneFieldRef {
  ref: string;
  location: string;
  zoneType: string;
  classified: boolean;
}

/** Every `param` reference on a dashboard zone with its location, device layouts included. */
function zoneFieldRefs(dashboard: any): ZoneFieldRef[] {
  const refs: ZoneFieldRef[] = [];
  const visit = (zones: unknown): void => {
    for (const zone of normalizeArray<any>(zones as any)) {
      const param = zone?.['@_param'];
      const declaredType = zone?.['@_type-v2'] ?? zone?.['@_type'];
      const zoneType = typeof declaredType === 'string' ? declaredType : 'untyped';
      const known = ZONE_PARAM_LOCATIONS[zoneType];
      if (typeof param === 'string') {
        refs.push({
          ref: param,
          location: known ?? 'other',
          zoneType,
          classified: known !== undefined,
        });
      }
      visit(zone?.zone);
    }
  };
  visit(dashboard.zones?.zone);
  for (const layout of normalizeArray<any>(dashboard.devicelayouts?.devicelayout)) {
    visit(layout?.zones?.zone);
  }
  return refs;
}

function normalizeQuery(value: string): string {
  return bareName(value.trim()).trim().toLowerCase();
}

/** Exact, case-insensitive match on caption or bare name. Returns every match. */
export function findDependencyRoots(
  graph: DependencyGraph,
  query: string,
  datasource?: string,
): DependencyNode[] {
  const target = normalizeQuery(query);
  const datasourceTarget = datasource === undefined ? undefined : datasource.trim().toLowerCase();
  return graph.nodes.filter((node) => {
    if (node.kind !== 'field' && node.kind !== 'calculation' && node.kind !== 'parameter') {
      return false;
    }
    if (node.unresolved) return false;
    if (
      datasourceTarget !== undefined &&
      node.datasource?.toLowerCase() !== datasourceTarget &&
      node.datasourceCaption?.toLowerCase() !== datasourceTarget
    ) {
      return false;
    }
    return (
      normalizeQuery(node.name) === target ||
      (node.caption !== undefined && normalizeQuery(node.caption) === target)
    );
  });
}

/** Breadth-first walk from one node; returns only the reached subgraph. */
export function traceDependencies(
  graph: DependencyGraph,
  rootId: string,
  direction: DependencyDirection,
): DependencyTrace {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const root = nodesById.get(rootId);
  if (!root) throw new Error(`No dependency node with id ${JSON.stringify(rootId)}.`);

  const outgoing = new Map<string, DependencyEdge[]>();
  for (const edge of graph.edges) {
    const key = direction === 'dependents' ? edge.to : edge.from;
    const list = outgoing.get(key) ?? [];
    list.push(edge);
    outgoing.set(key, list);
  }
  const next = (edge: DependencyEdge): string => (direction === 'dependents' ? edge.from : edge.to);

  const depths = new Map<string, number>([[rootId, 0]]);
  const reachedEdges: DependencyEdge[] = [];
  const queue = [rootId];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    for (const edge of outgoing.get(current) ?? []) {
      reachedEdges.push(edge);
      const neighbor = next(edge);
      if (depths.has(neighbor)) continue;
      depths.set(neighbor, (depths.get(current) ?? 0) + 1);
      queue.push(neighbor);
    }
  }

  return {
    root,
    nodes: queue.map((id) => ({ ...nodesById.get(id)!, depth: depths.get(id)! })),
    edges: reachedEdges,
    cycles: findCycles(queue, reachedEdges),
  };
}

/** Strongly connected components with a cycle (size above one, or a self-loop). */
function findCycles(nodeIds: string[], edges: DependencyEdge[]): string[][] {
  const successors = new Map<string, string[]>();
  for (const edge of edges) {
    const list = successors.get(edge.from) ?? [];
    list.push(edge.to);
    successors.set(edge.from, list);
  }
  const selfLoops = new Set(edges.filter((edge) => edge.from === edge.to).map((edge) => edge.from));

  let counter = 0;
  const index = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cycles: string[][] = [];

  const connect = (id: string): void => {
    index.set(id, counter);
    lowLink.set(id, counter);
    counter += 1;
    stack.push(id);
    onStack.add(id);
    for (const successor of successors.get(id) ?? []) {
      if (!index.has(successor)) {
        connect(successor);
        lowLink.set(id, Math.min(lowLink.get(id)!, lowLink.get(successor)!));
      } else if (onStack.has(successor)) {
        lowLink.set(id, Math.min(lowLink.get(id)!, index.get(successor)!));
      }
    }
    if (lowLink.get(id) !== index.get(id)) return;
    const component: string[] = [];
    let member: string | undefined;
    do {
      member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
    } while (member !== id);
    if (component.length > 1 || selfLoops.has(id)) cycles.push(component.reverse());
  };

  for (const id of nodeIds) {
    if (!index.has(id)) connect(id);
  }
  return cycles;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function countOf(count: number, noun: string): string {
  if (count === 0) return `no ${noun}s`;
  return count === 1 ? `1 ${noun}` : `${count} ${noun}s`;
}

function labelOf(node: DependencyNode): string {
  const name = node.caption ?? node.name;
  const datasource = node.datasourceCaption ?? node.datasource;
  return datasource ? `${name} (${datasource})` : name;
}

/** One note for the whole result: names only sheets some trace reaches; the rest are a count. */
function unreadableNote(unreadable: UnreadablePart[], reachedNames: ReadonlySet<string>): string {
  const sheets = [...new Set(unreadable.map((part) => part.worksheet))];
  const reached = sheets.filter((sheet) => reachedNames.has(sheet));
  const detail = reached
    .map((sheet) => {
      const reasons = unreadable.filter((part) => part.worksheet === sheet).map((p) => p.reason);
      return `${sheet} (${reasons.join('; ')})`;
    })
    .join(', ');
  const others = sheets.length - reached.length;
  const total = `${sheets.length === 1 ? '1 sheet has' : `${sheets.length} sheets have`} parts this tool can't read`;
  if (reached.length === 0) return `${total}, none on the paths traced here`;
  return `${total}: ${detail}${others > 0 ? `; ${others} more not on the paths traced here` : ''}`;
}

function summarize(
  trace: DependencyTrace,
  direction: DependencyDirection,
  hasUnreadable: boolean,
): string {
  const reached = trace.nodes.filter((node) => node.depth > 0);
  const fields = reached.filter(
    (node) => node.kind === 'field' || node.kind === 'calculation' || node.kind === 'parameter',
  ).length;
  const rootInCycle = trace.cycles.some((cycle) => cycle.includes(trace.root.id));
  const cycleNote = rootInCycle
    ? ' It is part of a formula cycle.'
    : trace.cycles.length > 0
      ? ' The walk reaches a formula cycle.'
      : '';
  if (direction === 'dependencies') {
    return `${labelOf(trace.root)} depends on ${countOf(fields, 'field')}.${cycleNote}`;
  }
  const worksheets = reached.filter((node) => node.kind === 'worksheet').length;
  const dashboards = reached.filter((node) => node.kind === 'dashboard').length;
  const base =
    `Changing ${labelOf(trace.root)} affects ${countOf(fields, 'field')}, ` +
    `${countOf(worksheets, 'worksheet')} and ${countOf(dashboards, 'dashboard')}.${cycleNote}`;
  return hasUnreadable && worksheets === 0
    ? base.replace('no worksheets and', 'no worksheets found and')
    : base;
}

/** Find every field matching `query` and trace each one. Zero roots means no match. */
export function getFieldDependencies(
  workbookXml: string,
  query: string,
  options: { direction?: DependencyDirection; datasource?: string } = {},
): FieldDependenciesResult {
  const direction = options.direction ?? 'dependents';
  const graph = buildDependencyGraph(workbookXml);
  const matched = findDependencyRoots(graph, query, options.datasource);
  const roots = matched
    .slice(0, MAX_DEPENDENCY_ROOTS)
    .map((root) => traceDependencies(graph, root.id, direction));
  const sentences = roots.map((root) => summarize(root, direction, graph.unreadable.length > 0));
  if (matched.length > roots.length) {
    sentences.push(
      `${matched.length - roots.length} more fields match '${query.trim()}'; pass datasource to narrow.`,
    );
  }
  if (direction === 'dependents' && graph.unreadable.length > 0) {
    const reachedNames = new Set(
      roots.flatMap((root) =>
        root.nodes
          .filter((node) => node.kind === 'worksheet' || node.kind === 'dashboard')
          .map((node) => node.name),
      ),
    );
    sentences.push(`${capitalize(unreadableNote(graph.unreadable, reachedNames))}.`);
  }
  return {
    field: query.trim(),
    direction,
    ambiguous: matched.length > 1,
    summary: sentences.join(' '),
    roots,
    notCovered: [
      ...DEPENDENCIES_NOT_COVERED,
      ...graph.unreadable.map(
        (part) => `${part.dashboard ? 'dashboard' : 'worksheet'} ${part.worksheet}: ${part.reason}`,
      ),
    ],
  };
}
