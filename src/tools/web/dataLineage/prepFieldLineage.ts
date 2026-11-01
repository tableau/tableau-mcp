import {
  LineageEdge,
  LineageNode,
  PrepSchemaObservation,
} from '../../../sdks/tableau/types/dataLineage.js';
import { sourceRowNumberName } from './prepGeneratedFields.js';
import policies from './prepNodePolicies.json';
import { expressionReferences, multiRowReferences } from './prepOperations.js';
import { prepDocumentSha256 } from './prepSchemaObservations.js';

type Obj = Record<string, unknown>;
const object = (value: unknown): Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Obj) : {};
const text = (value: unknown): string | undefined =>
  typeof value === 'string' &&
  value.length <= 1024 &&
  value.trim() &&
  !/<Parameters\.|^\{/.test(value)
    ? value
    : undefined;
const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const names = (value: unknown): string[] =>
  array(value).filter((v): v is string => typeof v === 'string');
type State = { fields: Map<string, string>; complete: boolean };
type Ports = Map<string, State>;
const empty = (): State => ({ fields: new Map(), complete: false });
const clone = (state: State): State => ({
  fields: new Map(state.fields),
  complete: state.complete,
});
const pointer = (path: string, key: string): string =>
  `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`;

export type PrepFieldAnalysis = {
  nodes: LineageNode[];
  edges: LineageEdge[];
  // Native identifiers are scoped to this document, never field captions alone.
  nativeFieldIds: Map<string, Set<string>>;
  outputs: Map<string, Ports>;
  issues: Array<{
    code: string;
    path: string;
    fieldName?: string;
    status?: 'broken' | 'unresolved';
  }>;
  truncated: boolean;
  schemaRequirements?: {
    documentSha256: string;
    nodes: Array<{ nodeId: string; nodeType: string }>;
  };
  appliedSchemaObservations: number;
};

/** Static field versions over saved JSON. Port/name effects reuse the user's
 * established Prep schema contract. No Python runtime, native compiler, model,
 * script, database or expression evaluator is invoked by the MCP server. */
export function analyzePrepFields(
  flow: unknown,
  flowLuid: string,
  maxVersions = 5000,
  observations: PrepSchemaObservation[] = [],
): PrepFieldAnalysis {
  const result: PrepFieldAnalysis = {
    nodes: [],
    edges: [],
    nativeFieldIds: new Map(),
    outputs: new Map(),
    issues: [],
    truncated: false,
    appliedSchemaObservations: 0,
  };
  const byId = new Map<string, LineageNode>();
  const edgeIds = new Set<string>();
  let visits = 0;
  let identityCount = 0;
  const identitiesByVersion = new Map<string, Set<string>>();
  const registerIdentity = (version: string, identity: unknown): void => {
    if (typeof identity !== 'string' || !identity || identity.length > 2048) return;
    const versions = result.nativeFieldIds.get(identity) ?? new Set<string>();
    if (versions.has(version)) return;
    if (++identityCount > maxVersions * 8) {
      result.truncated = true;
      return;
    }
    versions.add(version);
    result.nativeFieldIds.set(identity, versions);
    const identities = identitiesByVersion.get(version) ?? new Set<string>();
    identities.add(identity);
    identitiesByVersion.set(version, identities);
  };
  const inheritIdentity = (version: string, parents: string[]): void => {
    for (const parent of parents)
      for (const identity of identitiesByVersion.get(parent) ?? [])
        registerIdentity(version, identity);
  };
  const issue = (
    code: string,
    path: string,
    fieldName?: string,
    status?: 'broken' | 'unresolved',
  ): void => {
    if (
      result.issues.length < 100 &&
      !result.issues.some(
        (i) =>
          i.code === code && i.path === path && i.fieldName === fieldName && i.status === status,
      )
    )
      result.issues.push({
        code,
        path,
        ...(fieldName ? { fieldName } : {}),
        ...(status ? { status } : {}),
      });
    else if (result.issues.length >= 100) result.truncated = true;
  };
  try {
    result.schemaRequirements = { documentSha256: prepDocumentSha256(flow), nodes: [] };
  } catch {
    issue('schema-binding-unavailable', '/flow');
  }
  const observed = (node: Obj, family: string, path: string): PrepSchemaObservation | undefined => {
    const nodeId = text(node.id);
    if (!nodeId || !['input', 'external', 'prediction'].includes(family)) return;
    const requirements = result.schemaRequirements;
    if (requirements && !requirements.nodes.some((row) => row.nodeId === nodeId)) {
      if (requirements.nodes.length < 100)
        requirements.nodes.push({ nodeId, nodeType: String(node.nodeType) });
      else result.truncated = true;
    }
    const relevant = observations.filter((value) => value.nodeId === nodeId);
    const matches = relevant.filter(
      (value) => value.documentSha256 === requirements?.documentSha256,
    );
    if (matches.length === 1) return matches[0];
    if (relevant.length)
      issue(matches.length ? 'ambiguous-schema-observation' : 'stale-schema-observation', path);
  };
  const emit = (
    name: string,
    path: string,
    owner: string,
    operation: string,
    parents: string[],
    complete = true,
    dataType?: string,
    nativeNodeId?: string,
  ): string | undefined => {
    const id = `prep-field:${JSON.stringify([flowLuid, path, name])}`;
    if (byId.has(id)) {
      issue('duplicate-field-version', path);
      return undefined;
    }
    if (result.nodes.length >= maxVersions) {
      result.truncated = true;
      return undefined;
    }
    const node: LineageNode = {
      id,
      kind: 'prep-field',
      name,
      stepId: owner,
      flowLuid,
      operation,
      documentPath: path,
      ...(dataType ? { dataType } : {}),
    };
    result.nodes.push(node);
    byId.set(id, node);
    if (
      nativeNodeId &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nativeNodeId)
    )
      registerIdentity(id, `${nativeNodeId}-${name}`);
    for (const from of new Set(parents)) {
      if (!byId.has(from)) {
        issue('missing-field-version', path);
        continue;
      }
      const edgeId = JSON.stringify([from, id, operation]);
      if (!edgeIds.has(edgeId)) {
        if (result.edges.length >= maxVersions * 4) {
          result.truncated = true;
          break;
        }
        edgeIds.add(edgeId);
        result.edges.push({
          id: edgeId,
          from,
          to: id,
          relationship: operation,
          evidence: complete ? 'direct' : 'unknown',
          provenance: 'flow-document',
          propagates: true,
        });
      }
    }
    return id;
  };
  const unique = (name: string, occupied: Set<string>): string => {
    const match = name.match(/^(.*)-(\d+)$/);
    const base = match?.[1] ?? name;
    let number = match ? BigInt(match[2]) : 0n,
      candidate = match ? `${base}-${number}` : name;
    while (occupied.has(candidate)) {
      number++;
      candidate = `${base}-${number}`;
    }
    return candidate;
  };
  const apply = (
    node: Obj,
    source: State,
    ports: Ports,
    path: string,
    owner: string,
    observation?: PrepSchemaObservation,
  ): State => {
    const token = text(node.nodeType) ?? '';
    const family = (policies as Record<string, string>)[token] ?? 'opaque';
    const kind = token.split('.').pop() ?? '';
    const state = clone(source);
    // A known field reference does not require a complete list of unrelated columns.
    // Unresolved earlier edges still carry unknown evidence along the complete path.
    let mappingComplete = true;
    const column = text(node.columnName);
    const requireField = (name: unknown, input = source): string[] => {
      const value = text(name),
        id = value ? input.fields.get(value) : undefined;
      if (!id) {
        issue(
          'unresolved-field-reference',
          path,
          value,
          value && input.complete ? 'broken' : 'unresolved',
        );
        state.complete = false;
        mappingComplete = false;
      }
      return id ? [id] : [];
    };
    const references = (expression: unknown, input = source): string[] => {
      if (typeof expression !== 'string' || expression.length > 65536) {
        issue('unsupported-expression', path);
        state.complete = false;
        mappingComplete = false;
        return [];
      }
      const parsed = expressionReferences(expression);
      if (!parsed.complete) {
        issue('unsupported-expression', path);
        state.complete = false;
        mappingComplete = false;
        return [];
      }
      return parsed.names.flatMap((name) => requireField(name, input));
    };
    const write = (
      name: unknown,
      parents: string[],
      operation: string,
      complete = mappingComplete,
      datatype?: string,
    ): void => {
      const value = text(name);
      if (!value) {
        issue('dynamic-field-name', path);
        state.complete = false;
        mappingComplete = false;
        return;
      }
      const id = emit(value, path, owner, operation, parents, complete, datatype, text(node.id));
      if (id) {
        state.fields.set(value, id);
        const retained = [
          'rename',
          'bulk-rename',
          'type-change',
          'value-change',
          'row-condition',
          'join-left',
          'join-right',
          'union',
        ];
        if (retained.includes(operation)) {
          const identityParents = ['rename', 'bulk-rename', 'join-left', 'join-right'].includes(
            operation,
          )
            ? parents.slice(0, 1)
            : operation === 'union'
              ? parents
              : source.fields.has(value)
                ? [source.fields.get(value)!]
                : [];
          inheritIdentity(id, identityParents);
        }
      } else {
        state.complete = false;
        mappingComplete = false;
      }
    };
    const retainWithDependencies = (deps: string[], operation: string): void => {
      for (const [name, id] of source.fields) write(name, [id, ...deps], operation);
    };
    if (family === 'input' || family === 'output' || family === 'container') return state;
    if (family === 'overwrite') {
      const deps =
        kind === 'DuplicateColumn' && typeof node.expression !== 'string'
          ? requireField(node.columnName)
          : references(node.expression);
      if (kind === 'MultiRowCalc') {
        const controls = multiRowReferences(node);
        deps.push(...controls.names.flatMap((name) => requireField(name)));
        if (!controls.complete) {
          issue('unsupported-multi-row-controls', path);
          state.complete = false;
          mappingComplete = false;
        }
      }
      write(column, deps, 'calculation');
    } else if (family === 'rename') {
      const deps = requireField(column),
        target = text(node.rename);
      if (column) state.fields.delete(column);
      if (target && state.fields.has(target) && target !== column) {
        issue('rename-collision', path);
        state.fields.clear();
        state.complete = false;
        mappingComplete = false;
      } else write(target, deps, 'rename');
    } else if (family === 'bulk_rename') {
      const selection = object(node.columnsSelection),
        rule = object(selection.selectionRule),
        operation = object(node.columnsOperation);
      const included = names(selection.includedColumns).length
        ? new Set(names(selection.includedColumns))
        : new Set(source.fields.keys());
      const excluded = new Set(names(selection.exemptedColumns));
      const value = String(
        rule.columnNamePrefix ??
          rule.columnNameSuffix ??
          rule.fieldNameSuffix ??
          rule.columnNameSubStr ??
          rule.fieldNameSubStr ??
          '',
      );
      const renames = new Map<string, string>();
      if (
        ![
          'prefixBasedColumnsSelection',
          'suffixBasedColumnsSelection',
          'containsBasedColumnsSelection',
        ].includes(String(rule.type))
      ) {
        issue('unsupported-bulk-rename-selection', path);
        state.fields.clear();
        state.complete = false;
        mappingComplete = false;
        return state;
      }
      for (const name of source.fields.keys()) {
        const selected =
          rule.type === 'prefixBasedColumnsSelection'
            ? name.startsWith(value)
            : rule.type === 'suffixBasedColumnsSelection'
              ? name.endsWith(value)
              : rule.type === 'containsBasedColumnsSelection'
                ? name.includes(value)
                : false;
        if (!selected || !included.has(name) || excluded.has(name)) continue;
        let target = name;
        if (operation.type === 'addColumnPrefixOperation')
          target = String(operation.columnNamePrefix ?? '') + name;
        else if (operation.type === 'addColumnSuffixOperation')
          target = name + String(operation.columnNameSuffix ?? '');
        else if (
          operation.type === 'replaceColumnPrefixOperation' &&
          name.startsWith(String(operation.existingPrefix ?? ''))
        )
          target =
            String(operation.newPrefix ?? '') +
            name.slice(String(operation.existingPrefix ?? '').length);
        else if (
          operation.type === 'replaceColumnSuffixOperation' &&
          name.endsWith(String(operation.existingSuffix ?? ''))
        ) {
          const old = String(operation.existingSuffix ?? '');
          target = (old ? name.slice(0, -old.length) : name) + String(operation.newSuffix ?? '');
        } else if (
          operation.type === 'replaceColumnAllSubStringOperation' &&
          text(operation.existingSubString)
        )
          target = name
            .split(String(operation.existingSubString))
            .join(String(operation.newSubString ?? ''));
        else {
          issue('unsupported-bulk-rename', path);
          state.complete = false;
          mappingComplete = false;
        }
        if (target !== name) renames.set(name, target);
      }
      for (const name of renames.keys()) state.fields.delete(name);
      for (const [old, target] of renames) {
        if (state.fields.has(target)) {
          issue('rename-collision', path);
          state.complete = false;
          mappingComplete = false;
          continue;
        }
        write(target, requireField(old), 'bulk-rename');
      }
    } else if (family === 'remove' || family === 'keep') {
      const selected = new Set(
        Array.isArray(node.columnNames) ? names(node.columnNames) : column ? [column] : [],
      );
      for (const name of selected) requireField(name);
      state.fields = new Map(
        [...source.fields].filter(([name]) => selected.has(name) === (family === 'keep')),
      );
    } else if (family === 'merge') {
      const selected = names(node.mergeColumnsList),
        deps = selected.flatMap((name) => requireField(name));
      for (const name of selected) state.fields.delete(name);
      write(
        unique(text(node.mergedColumnName) ?? selected.join(' & '), new Set(state.fields.keys())),
        deps,
        'merge',
      );
    } else if (family === 'aggregate') {
      const groups = array(node.groupByFields),
        aggregates = array(node.aggregateFields);
      const groupDeps = groups.flatMap((value) => requireField(object(value).columnName));
      state.fields.clear();
      for (const value of [...groups, ...aggregates]) {
        const setting = object(value);
        if (setting.specialFieldType != null) {
          issue('special-aggregate-unresolved', path);
          state.complete = false;
          mappingComplete = false;
          continue;
        }
        write(
          setting.newColumnName ?? setting.columnName,
          [...requireField(setting.columnName), ...groupDeps],
          'aggregate',
        );
      }
    } else if (family === 'join') {
      const left = ports.get('Left') ?? empty(),
        right = ports.get('Right') ?? empty();
      state.complete = left.complete && right.complete;
      state.fields.clear();
      const conditions = array(node.conditions);
      const keys = conditions.flatMap((value) => {
        const condition = object(value);
        return [
          ...references(condition.leftExpression, left),
          ...references(condition.rightExpression, right),
        ];
      });
      const targets = new Map(
        [...right.fields.keys()].map((name) => [
          name,
          left.fields.has(name) ? unique(name, new Set(left.fields.keys())) : name,
        ]),
      );
      if (
        new Set(targets.values()).size !== targets.size ||
        [...targets].some(([name, target]) => name !== target && right.fields.has(target))
      ) {
        issue('ambiguous-join-suffix', path);
        state.complete = false;
        mappingComplete = false;
        return state;
      }
      for (const [name, id] of left.fields) write(name, [id, ...keys], 'join-left');
      for (const [name, id] of right.fields) write(targets.get(name), [id, ...keys], 'join-right');
    } else if (family === 'union') {
      state.fields.clear();
      state.complete = ports.size > 0 && [...ports.values()].every((s) => s.complete);
      const mapping = new Map(
        array(node.namespaceFieldMappings).map((value) => {
          const setting = object(value);
          return [String(setting.namespaceName), object(setting.fieldMappings)] as const;
        }),
      );
      const grouped = new Map<string, string[]>();
      for (const [port, input] of ports) {
        const decoded = new Map<string, string>();
        for (const [expression, target] of Object.entries(mapping.get(port) ?? {})) {
          const parsed = expressionReferences(expression);
          if (
            !parsed.complete ||
            parsed.names.length !== 1 ||
            !/^\[(?:\\.|[^\]\\])*\]$/.test(expression.trim()) ||
            !text(target)
          ) {
            issue('unresolved-union-mapping', path);
            state.complete = false;
            mappingComplete = false;
            continue;
          }
          decoded.set(parsed.names[0], String(target));
        }
        const seen = new Set<string>();
        for (const [name, id] of input.fields) {
          const target = decoded.get(name) ?? name;
          if (seen.has(target)) {
            issue('union-many-to-one', path);
            state.complete = false;
            mappingComplete = false;
          }
          seen.add(target);
          grouped.set(target, [...(grouped.get(target) ?? []), id]);
        }
      }
      for (const [name, deps] of grouped) write(name, deps, 'union');
      write(unique('Table Names', new Set(state.fields.keys())), [], 'generated-union-provenance');
    } else if (family === 'legacy_unpivot' || family === 'unpivot') {
      const values = new Map<string, string[]>(),
        consumed = new Set<string>();
      const collect = (output: unknown, input: string[], literal = false): void => {
        const name = text(output);
        if (!name) {
          state.complete = false;
          mappingComplete = false;
          issue('unresolved-unpivot-output', path);
          return;
        }
        const deps = input.flatMap((n) => requireField(n));
        input.forEach((n) => consumed.add(n));
        values.set(name, [...(values.get(name) ?? []), ...deps]);
        if (literal && !values.has(name)) values.set(name, []);
      };
      if (family === 'legacy_unpivot') {
        for (const group of array(node.unpivotGroups))
          for (const expression of array(object(group).expressions))
            for (const binding of array(object(expression).bindings)) {
              const value = object(binding);
              collect(
                value.newColumnName,
                text(value.columnName) ? [String(value.columnName)] : [],
                value.bindingType === 'literal',
              );
            }
      } else {
        const group = object(node.unpivotGroup);
        collect(object(group.literalColumn).literalColumnName, [], true);
        for (const value of array(group.unpivotColumns)) {
          const setting = object(value),
            info = object(setting.columnInformation);
          let selected: string[] = [];
          if (info.bindingsType === 'manual') selected = names(info.manualBindings);
          else if (
            info.bindingsType === 'wildcard' &&
            ['Starts with', 'Ends with', 'Contains'].includes(String(info.wildcardType)) &&
            source.complete &&
            typeof info.wildcardExpression === 'string'
          ) {
            const pattern = info.wildcardExpression;
            selected = [...source.fields.keys()].filter(
              (name) =>
                !consumed.has(name) &&
                !!pattern &&
                (info.wildcardType === 'Starts with'
                  ? name.startsWith(pattern)
                  : info.wildcardType === 'Ends with'
                    ? name.endsWith(pattern)
                    : name.includes(pattern)),
            );
            selected.push(...names(info.additionalColumns));
            selected.sort();
          } else {
            issue('unresolved-unpivot-membership', path);
            state.complete = false;
            mappingComplete = false;
          }
          collect(setting.unpivotColumnName, selected);
        }
      }
      for (const name of consumed) state.fields.delete(name);
      for (const [name, deps] of values) write(name, deps, 'unpivot');
    } else if (family === 'pivot') {
      const deps = [
        node.pivotColumnName,
        node.aggregateColumnName,
        ...names(node.pivotGroupingColumns),
      ].flatMap((name) => requireField(name));
      for (const name of [node.pivotColumnName, node.aggregateColumnName])
        if (typeof name === 'string') state.fields.delete(name);
      for (const value of array(node.newPivotColumns))
        write(object(value).newColumnName, deps, 'pivot');
    } else if (family === 'new_rows') {
      const generator = object(node.newRowsGenerator),
        one = generator.generatorType === 'newRowsOneColumnGenerator';
      const selected = one ? [generator.columnName] : [generator.startColumn, generator.endColumn];
      const deps = selected.flatMap((name) => requireField(name));
      write(generator.newColumnName ?? (one ? generator.columnName : undefined), deps, 'new-rows');
    } else if (family === 'prediction') {
      const settings = object(node.predictionSettings),
        deps = Object.keys(object(settings.fieldMappings)).flatMap((name) => requireField(name));
      write(
        unique(text(settings.outcomeName) ?? 'Prediction', new Set(state.fields.keys())),
        deps,
        'prediction-input',
      );
      for (const [key, label] of [
        ['topPredictors', 'Predictor'],
        ['topImprovements', 'Improvement'],
      ]) {
        const count = settings[key] ?? 0;
        if (!Number.isInteger(count) || Number(count) < 0 || Number(count) > 3) {
          issue('unresolved-prediction-output', path);
          state.complete = false;
          mappingComplete = false;
          continue;
        }
        for (let i = 1; i <= Number(count); i++) {
          const base = `${label} ${i}`;
          let suffix = 0,
            name = base,
            impact = `${base} Impact`;
          while (state.fields.has(name) || state.fields.has(impact)) {
            suffix++;
            name = `${base}-${suffix}`;
            impact = `${base} Impact-${suffix}`;
          }
          write(name, deps, 'prediction-input');
          write(impact, deps, 'prediction-input');
        }
      }
    } else if (family === 'external' && observation) {
      state.fields.clear();
      state.complete = true;
      for (const field of observation.fields)
        write(field.name, [], 'script-output', true, field.type);
      result.appliedSchemaObservations++;
      issue('external-script-dependencies-unavailable', path);
    } else if (family === 'external' || family === 'opaque') {
      state.fields.clear();
      state.complete = false;
      mappingComplete = false;
      issue(
        family === 'external' ? 'external-script-schema-unavailable' : 'unsupported-node-type',
        path,
      );
    } else if (family === 'preserve') {
      if (
        [
          'QuickCalcColumn',
          'QuickDateCalcColumn',
          'QuickDateNameCalcColumn',
          'CustomFiscalYearCalcColumn',
        ].includes(kind) &&
        typeof node.expression === 'string'
      ) {
        const input = references(node.expression);
        write(column, input, 'calculation');
        return state;
      }
      const deps = [
        ...(column ? requireField(column) : []),
        ...names(node.columnNames).flatMap((name) => requireField(name)),
      ];
      if (kind === 'RangeFilter') {
        for (const [name, ranges] of Object.entries(object(node.ranges))) {
          deps.push(...requireField(name));
          if (!Array.isArray(ranges)) {
            issue('unsupported-range-selection', path);
            state.complete = false;
            mappingComplete = false;
          }
        }
      }
      if (!column && text(node.fieldId)) {
        const matches = [...source.fields.values()].filter((id) =>
          result.nativeFieldIds.get(String(node.fieldId))?.has(id),
        );
        if (matches.length === 1) deps.push(matches[0]);
        else {
          issue('unresolved-native-field-id', path);
          state.complete = false;
          mappingComplete = false;
        }
      }
      for (const key of ['filterExpression', 'expression'])
        if (node[key] != null) deps.push(...references(node[key]));
      for (const value of array(node.sortPrimitives))
        deps.push(...references(object(value).sortExpression));
      if (kind === 'ConditionalRemap')
        for (const expression of array(node.conditions)) deps.push(...references(expression));
      if (kind === 'ChangeColumnType') {
        for (const [name, value] of Object.entries(object(node.fields))) {
          const setting = object(value),
            input = requireField(name);
          if (setting.calc != null) input.push(...references(setting.calc));
          write(name, input, 'type-change', mappingComplete, text(setting.type));
        }
      } else if (
        column &&
        !kind.includes('Filter') &&
        !kind.includes('Sort') &&
        kind !== 'RemoveUniqueKey' &&
        kind !== 'CreateUniqueKey'
      )
        write(column, deps, 'value-change');
      else if (deps.length) retainWithDependencies(deps, 'row-condition');
    }
    return state;
  };

  const visit = (
    value: unknown,
    incoming: Ports,
    path: string,
    owner: string,
    depth: number,
  ): Ports => {
    if (++visits > 2000 || depth > 12) {
      result.truncated = true;
      return new Map([['Default', empty()]]);
    }
    const node = object(value),
      token = text(node.nodeType) ?? '',
      family = (policies as Record<string, string>)[token] ?? 'opaque';
    const ports = new Map(incoming);
    let source = ports.get('Default') ?? (ports.size === 1 ? [...ports.values()][0] : empty());
    const observation = observed(node, family, path);
    if (family === 'input') {
      const inputUnion = token.includes('InputUnion');
      const generatedInputNames = new Set(
        [node.pathNameField, node.tableNameField, node.fileCreationTimeField]
          .map(text)
          .filter(Boolean),
      );
      const bindings = new Map<string, string[]>();
      let membersComplete = true;
      if (inputUnion) {
        const members = array(node.generatedInputs);
        membersComplete = members.length > 0;
        const outputNames = new Set(
          (observation?.fields ?? array(node.fields))
            .map((field) => text(object(field).name))
            .filter(Boolean),
        );
        const literalReference = (value: string): string | undefined => {
          const parsed = expressionReferences(value);
          return parsed.complete &&
            parsed.names.length === 1 &&
            /^\[(?:\\.|[^\]\\])*\]$/.test(value)
            ? parsed.names[0]
            : undefined;
        };
        for (const [index, value] of members.entries()) {
          const member = object(value),
            input = object(member.inputNode);
          const memberState =
            visit(
              input,
              new Map(),
              `${path}/generatedInputs/${index}/inputNode`,
              text(input.id) ?? owner,
              depth + 1,
            ).get('Default') ?? empty();
          membersComplete &&= memberState.complete;
          const mappings = [
            member.fieldMappings,
            member.fieldMapping,
            member.columnMappings,
            member.columnMapping,
            member.mappings,
            input.fieldMappings,
            input.columnMappings,
          ];
          const targets = new Map<string, Set<string>>();
          for (const mapping of mappings)
            for (const [raw, destination] of Object.entries(object(mapping))) {
              const sourceName = memberState.fields.has(raw) ? raw : literalReference(raw);
              const targetName = text(destination);
              if (!sourceName || !targetName || !memberState.fields.has(sourceName)) {
                membersComplete = false;
                issue('unresolved-input-union-mapping', path);
                continue;
              }
              const resolved = outputNames.has(targetName)
                ? targetName
                : (literalReference(targetName) ?? targetName);
              const found = targets.get(sourceName) ?? new Set<string>();
              found.add(resolved);
              targets.set(sourceName, found);
            }
          const memberOutputs = new Set<string>();
          for (const [name, id] of memberState.fields) {
            const mapped = targets.get(name);
            if (mapped && mapped.size !== 1) {
              membersComplete = false;
              issue('ambiguous-input-union-mapping', path);
              continue;
            }
            const target = mapped ? [...mapped][0] : name;
            if (outputNames.size && !outputNames.has(target)) continue;
            if (memberOutputs.has(target)) {
              membersComplete = false;
              issue('input-union-many-to-one', path);
            }
            memberOutputs.add(target);
            bindings.set(target, [...(bindings.get(target) ?? []), id]);
          }
        }
      }
      const savedFields = observation?.fields ?? array(node.fields);
      const inputFields =
        savedFields.length || !inputUnion
          ? savedFields
          : [...bindings.keys()].map((name) => ({ name }));
      source = {
        fields: new Map(),
        complete: !!observation || (inputFields.length > 0 && (!inputUnion || membersComplete)),
      };
      for (const value of inputFields) {
        const field = object(value),
          name = text(field.name);
        if (!name || source.fields.has(name)) {
          source.complete = false;
          issue('ambiguous-input-field', path);
          continue;
        }
        let parents = bindings.get(name) ?? [];
        if (inputUnion && generatedInputNames.has(name) && parents.length) {
          membersComplete = false;
          parents = [];
          issue('input-union-provenance-collision', path);
        }
        const complete =
          !!observation ||
          !inputUnion ||
          (membersComplete &&
            (parents.length > 0 || field.isGenerated === true || generatedInputNames.has(name)));
        if (!complete) {
          source.complete = false;
          issue('input-schema-partial', path);
        }
        const id = emit(
          name,
          `${path}/fields`,
          owner,
          inputUnion ? 'input-union' : 'input',
          parents,
          complete,
          text(field.type),
          text(node.id),
        );
        if (id) {
          source.fields.set(name, id);
          registerIdentity(id, field.fieldId);
          if (inputUnion) inheritIdentity(id, parents);
        }
      }
      if (!observation && /\.(LoadCsv|LoadExcel)$/.test(token)) {
        const declared = inputFields.flatMap((value) => {
          const field = object(value),
            name = text(field.name);
          return name ? [{ name, isGenerated: field.isGenerated }] : [];
        });
        const name = sourceRowNumberName(declared);
        if (!source.fields.has(name)) {
          const id = emit(
            name,
            `${path}/generatedSourceRowNumber`,
            owner,
            'generated-source-row-number',
            [],
            true,
            'integer',
            text(node.id),
          );
          if (id) source.fields.set(name, id);
        } else if (!declared.some((field) => field.name === name && field.isGenerated === true)) {
          issue('generated-source-row-number-collision', path);
          source.complete = false;
        }
      }
      const restricted = object(node.restrictedFields);
      for (const [old, value] of Object.entries(restricted)) {
        const name = text(value),
          parent = source.fields.get(old);
        if (parent && name) {
          const id = emit(name, `${path}/restrictedFields`, owner, 'input-rename', [parent]);
          source.fields.delete(old);
          if (id) {
            source.fields.set(name, id);
            inheritIdentity(id, [parent]);
          }
        }
      }
      if (Array.isArray(node.selectedFields))
        source.fields = new Map(
          [...source.fields].filter(([name]) => names(node.selectedFields).includes(name)),
        );
      if (
        !observation &&
        ((inputUnion && !membersComplete) || Object.keys(object(node.userRenamedFields)).length)
      ) {
        source.complete = false;
        issue('input-schema-partial', path);
      }
      if (observation) {
        result.appliedSchemaObservations++;
        if (inputUnion && !membersComplete) issue('input-union-member-lineage-unavailable', path);
      }
      ports.clear();
      ports.set('Default', source);
    }
    for (const [i, value] of array(node.beforeActionAnnotations).entries()) {
      const annotation = object(value),
        port = text(annotation.namespace) ?? 'Default';
      ports.set(
        port,
        visit(
          annotation.annotationNode,
          new Map([['Default', ports.get(port) ?? empty()]]),
          `${path}/beforeActionAnnotations/${i}/annotationNode`,
          owner,
          depth + 1,
        ).get('Default') ?? empty(),
      );
    }
    source = ports.get('Default') ?? (ports.size === 1 ? [...ports.values()][0] : source);
    if (node.loomContainer) {
      const seeds = new Map<string, Ports>();
      for (const [port, value] of Object.entries(object(node.namespacesToInput))) {
        const target = object(value),
          id = text(target.nodeId);
        if (id) {
          const seed = seeds.get(id) ?? new Map();
          seed.set(text(target.namespace) ?? 'Default', ports.get(port) ?? empty());
          seeds.set(id, seed);
        }
      }
      const internal = graph(node.loomContainer, `${path}/loomContainer`, seeds, depth + 1, owner);
      const outputs = new Map<string, State>();
      for (const [port, value] of Object.entries(object(node.namespacesToOutput))) {
        const target = object(value);
        outputs.set(
          port,
          internal.get(String(target.nodeId))?.get(text(target.namespace) ?? 'Default') ?? empty(),
        );
      }
      if (!outputs.size) {
        issue('container-ports-unresolved', path);
        outputs.set('Default', empty());
      }
      result.outputs.set(owner, outputs);
      return outputs;
    }
    let state = apply(node, source, ports, path, owner, observation);
    if (family === 'prediction' && observation) {
      const observedNames = new Set(observation.fields.map((field) => field.name));
      if (
        observedNames.size !== state.fields.size ||
        [...state.fields.keys()].some((name) => !observedNames.has(name))
      ) {
        issue('observed-prediction-schema-difference', path);
        state.complete = false;
      } else {
        result.appliedSchemaObservations++;
        for (const field of observation.fields) {
          const version = byId.get(state.fields.get(field.name)!);
          if (version?.documentPath === path) version.dataType = field.type;
        }
      }
    }
    for (const [i, action] of array(node.actions).entries())
      state =
        visit(action, new Map([['Default', state]]), `${path}/actions/${i}`, owner, depth + 1).get(
          'Default',
        ) ?? empty();
    if (node.actionNode)
      state =
        visit(
          node.actionNode,
          ['join', 'union'].includes(
            (policies as Record<string, string>)[String(object(node.actionNode).nodeType)],
          )
            ? ports
            : new Map([['Default', state]]),
          `${path}/actionNode`,
          owner,
          depth + 1,
        ).get('Default') ?? empty();
    for (const [i, value] of array(node.afterActionAnnotations).entries()) {
      const annotation = object(value);
      if (annotation.namespace != null && annotation.namespace !== 'Default') {
        issue('output-namespace-unresolved', path);
        state = empty();
        continue;
      }
      state =
        visit(
          annotation.annotationNode,
          new Map([['Default', state]]),
          `${path}/afterActionAnnotations/${i}/annotationNode`,
          owner,
          depth + 1,
        ).get('Default') ?? empty();
    }
    const outputs = new Map([['Default', state]]);
    result.outputs.set(owner, outputs);
    return outputs;
  };
  const graph = (
    value: unknown,
    path: string,
    seeds: Map<string, Ports>,
    depth: number,
    parentOwner?: string,
  ): Map<string, Ports> => {
    const rawNodes = object(object(value).nodes);
    if (Object.keys(rawNodes).length > 2000) result.truncated = true;
    const nodes = Object.fromEntries(Object.entries(rawNodes).slice(0, 2000)),
      incoming = new Map<string, Array<{ parent: string; edge: Obj }>>(),
      outgoing = new Map<string, Obj[]>();
    for (const id of Object.keys(nodes)) {
      incoming.set(id, []);
      outgoing.set(id, []);
    }
    for (const [id, value] of Object.entries(nodes))
      for (const raw of array(object(value).nextNodes)) {
        const edge = object(raw),
          target = text(edge.nextNodeId);
        if (!target || !incoming.has(target)) {
          issue('dangling-step-link', pointer(`${path}/nodes`, id));
          continue;
        }
        incoming.get(target)!.push({ parent: id, edge });
        outgoing.get(id)!.push(edge);
      }
    const counts = new Map([...incoming].map(([id, edges]) => [id, edges.length]));
    const ready = [...counts].filter(([, count]) => count === 0).map(([id]) => id),
      outputs = new Map<string, Ports>();
    while (ready.length) {
      const id = ready.shift()!,
        ports = new Map(seeds.get(id));
      for (const { parent, edge } of incoming.get(id) ?? []) {
        const port = text(edge.nextNamespace) ?? 'Default',
          state = outputs.get(parent)?.get(text(edge.namespace) ?? 'Default') ?? empty();
        if (ports.has(port)) {
          issue('ambiguous-input-namespace', pointer(`${path}/nodes`, id));
          ports.set(port, empty());
        } else ports.set(port, state);
      }
      const owner = parentOwner ?? text(object(nodes[id]).id) ?? id;
      outputs.set(id, visit(nodes[id], ports, pointer(`${path}/nodes`, id), owner, depth));
      for (const edge of outgoing.get(id) ?? []) {
        const target = String(edge.nextNodeId),
          count = counts.get(target)! - 1;
        counts.set(target, count);
        if (count === 0) ready.push(target);
      }
    }
    if (outputs.size !== Object.keys(nodes).length) issue('cyclic-step-graph', path);
    return outputs;
  };
  graph(flow, '/flow', new Map(), 0);
  return result;
}
