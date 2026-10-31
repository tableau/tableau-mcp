import policies from './prepNodePolicies.json';

/** Structural keys observed in the Superstore flow shipped with Tableau Prep
 * Builder 2026.3. This is not a version-stable server API schema. Unknown shapes
 * remain unknown; connections, credentials and arbitrary properties are ignored. */
export type PrepOperation = {
  path: string[];
  operationId?: string;
  parentStepId: string;
  operation: string;
  expression?: string;
  references: string[];
  outputs: string[];
  removes?: string[];
  rename?: { from: string; to: string };
  conditions?: Array<{ leftExpression: string; rightExpression: string; comparator?: string }>;
  aggregates?: Array<{ columnName: string; function?: string; newColumnName?: string }>;
  groupBy?: string[];
  status: 'references-extracted' | 'unknown';
};

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/** Read bracketed Tableau references without mistaking string/comment contents
 * for dependencies. These are names at the operation's input, not global IDs.
 * Parameter/qualified-name resolution is deliberately left to the caller. */
export function expressionReferences(expression: string): { names: string[]; complete: boolean } {
  const names = new Set<string>();
  let i = 0;
  while (i < expression.length) {
    const c = expression[i];
    if (c === '"' || c === "'" || c === '#') {
      const quote = c;
      i++;
      let closed = false;
      while (i < expression.length) {
        if (expression[i] === '\\') {
          i += 2;
          continue;
        }
        if (expression[i] === quote) {
          if (expression[i + 1] === quote) {
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        i++;
      }
      if (!closed) return { names: [...names], complete: false };
    } else if (expression.startsWith('//', i)) {
      const end = expression.indexOf('\n', i + 2);
      i = end < 0 ? expression.length : end + 1;
    } else if (expression.startsWith('/*', i)) {
      const end = expression.indexOf('*/', i + 2);
      if (end < 0) return { names: [...names], complete: false };
      i = end + 2;
    } else if (c === '[') {
      let name = '';
      i++;
      while (i < expression.length && expression[i] !== ']') {
        if (expression[i] === '\\' && i + 1 < expression.length) i++;
        if (expression[i] === '[') return { names: [...names], complete: false };
        name += expression[i++];
      }
      if (i === expression.length) return { names: [...names], complete: false };
      if (!name.toLowerCase().startsWith('parameters.')) names.add(name);
      i++;
    } else i++;
  }
  return { names: [...names], complete: true };
}

export function extractPrepOperations(
  nodes: Record<string, unknown>,
  limit: number,
): { operations: PrepOperation[]; truncated: boolean } {
  const operations: PrepOperation[] = [];
  let truncated = false;
  const visit = (value: unknown, path: string[], parentStepId: string, depth: number): void => {
    const node = record(value);
    if (!node) return;
    if (depth > 8 || operations.length >= limit) {
      truncated = true;
      return;
    }
    const operation = str(node.nodeType)?.split('.').pop();
    if (operation) {
      const result: PrepOperation = {
        path,
        parentStepId,
        operationId: str(node.id),
        operation,
        references: [],
        outputs: [],
        status: 'unknown',
      };
      const names = new Set<string>();
      let supported = false;
      const expression = (value: unknown): void => {
        const text = str(value);
        if (text === undefined) return;
        if (text.length > 8000) {
          result.expression = text.slice(0, 8000);
          truncated = true;
          return;
        }
        const refs = expressionReferences(text);
        if (refs.complete) {
          refs.names.forEach((name) => names.add(name));
          supported = true;
        }
        result.expression = text;
      };
      const column = str(node.columnName);
      const modeled = Object.prototype.hasOwnProperty.call(policies, String(node.nodeType));
      if (!modeled) {
        // A familiar suffix under an unknown version is not schema evidence.
      } else if (['AddColumn', 'QuickCalcColumn', 'CalculatedField'].includes(operation)) {
        expression(node.expression);
        if (column) result.outputs.push(column);
      } else if (['Filter', 'FilterOperation', 'ValueFilter'].includes(operation)) {
        expression(node.filterExpression ?? node.expression);
        if (column) {
          names.add(column);
          supported = true;
        }
      } else if (operation === 'RangeFilter' && record(node.ranges)) {
        Object.keys(record(node.ranges)!).forEach((name) => names.add(name));
        supported = true;
      } else if (['SimpleJoin', 'Join'].includes(operation) && Array.isArray(node.conditions)) {
        result.conditions = [];
        supported = node.conditions.length > 0;
        for (const value of node.conditions) {
          const condition = record(value);
          const left = str(condition?.leftExpression),
            right = str(condition?.rightExpression);
          if (
            left === undefined ||
            right === undefined ||
            left.length > 8000 ||
            right.length > 8000
          ) {
            supported = false;
            continue;
          }
          const leftRefs = expressionReferences(left),
            rightRefs = expressionReferences(right);
          if (!leftRefs.complete || !rightRefs.complete) {
            supported = false;
            continue;
          }
          [...leftRefs.names, ...rightRefs.names].forEach((name) => names.add(name));
          result.conditions.push({
            leftExpression: left,
            rightExpression: right,
            comparator: str(condition?.comparator),
          });
        }
      } else if (operation === 'Aggregate') {
        const groupBy = Array.isArray(node.groupByFields) ? node.groupByFields : [];
        const aggregates = Array.isArray(node.aggregateFields) ? node.aggregateFields : [];
        result.groupBy = groupBy
          .map((value) => str(record(value)?.columnName))
          .filter((name): name is string => name !== undefined);
        result.aggregates = aggregates.flatMap((value) => {
          const field = record(value),
            name = str(field?.columnName);
          return name === undefined
            ? []
            : [
                {
                  columnName: name,
                  function: str(field?.function),
                  newColumnName: str(field?.newColumnName),
                },
              ];
        });
        [...result.groupBy, ...result.aggregates.map((field) => field.columnName)].forEach((name) =>
          names.add(name),
        );
        result.outputs = [
          ...result.groupBy,
          ...result.aggregates.map((field) => field.newColumnName ?? field.columnName),
        ];
        supported =
          names.size > 0 &&
          result.groupBy.length === groupBy.length &&
          result.aggregates.length === aggregates.length;
      } else if (operation === 'RenameColumn' && column && str(node.rename)) {
        result.rename = { from: column, to: str(node.rename)! };
        names.add(column);
        result.outputs.push(result.rename.to);
        supported = true;
      } else if (operation === 'RemoveColumn' && column) {
        result.removes = [column];
        names.add(column);
        supported = true;
      } else if (operation === 'RemoveColumns' && Array.isArray(node.columnNames)) {
        result.removes = strings(node.columnNames);
        result.removes.forEach((name) => names.add(name));
        supported = result.removes.length === node.columnNames.length;
      } else if (operation === 'ChangeColumnType' && record(node.fields)) {
        for (const [name, value] of Object.entries(record(node.fields)!)) {
          names.add(name);
          result.outputs.push(name);
          if (str(record(value)?.calc)) expression(record(value)?.calc);
        }
        supported = names.size > 0;
      } else if (operation === 'Remap' && column) {
        names.add(column);
        result.outputs.push(column);
        supported = true;
      }
      result.references = [...names];
      result.status = supported ? 'references-extracted' : 'unknown';
      operations.push(result);
    }
    const container = record(node.loomContainer);
    for (const [key, child] of Object.entries(record(container?.nodes) ?? {}))
      visit(child, [...path, 'loomContainer', 'nodes', key], parentStepId, depth + 1);
    if (node.actionNode) visit(node.actionNode, [...path, 'actionNode'], parentStepId, depth + 1);
    for (const key of ['actions', 'beforeActionAnnotations', 'afterActionAnnotations']) {
      const values = node[key];
      if (Array.isArray(values))
        values.forEach((child, index) => {
          const annotation = record(child)?.annotationNode;
          visit(
            annotation ?? child,
            [...path, key, String(index), ...(annotation ? ['annotationNode'] : [])],
            parentStepId,
            depth + 1,
          );
        });
    }
  };
  for (const [id, node] of Object.entries(nodes))
    visit(node, ['nodes', id], str(record(node)?.id) ?? id, 0);
  return { operations, truncated };
}
