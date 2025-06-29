// Filter validation utility for flows

const SUPPORTED_FIELDS = [
  'name', 'tags', 'createdAt',
];
const SUPPORTED_OPERATORS = [
  'eq', 'in', 'gt', 'gte', 'lt', 'lte',
];

export function parseAndValidateFlowFilterString(filter?: string): string | undefined {
  if (!filter) return undefined;
  // Simple validation example (extend as needed)
  const expressions = filter.split(',');
  for (const expr of expressions) {
    const [field, operator, ...rest] = expr.split(':');
    if (!SUPPORTED_FIELDS.includes(field)) {
      throw new Error(`Unsupported filter field: ${field}`);
    }
    if (!SUPPORTED_OPERATORS.includes(operator)) {
      throw new Error(`Unsupported filter operator: ${operator}`);
    }
    if (rest.length === 0) {
      throw new Error(`Missing value for filter: ${expr}`);
    }
  }
  return filter;
} 