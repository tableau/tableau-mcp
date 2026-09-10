import { FilterOperator, splitTopLevel } from './parseAndValidateFilterString.js';

export type ClientSideFilterValue = string | number | null | undefined;

type FilterExpression<TField extends string> = {
  field: TField;
  operator: FilterOperator;
  value: string;
};

export function applyClientSideFilters<TItem, TField extends string>({
  items,
  filterString,
  validateFilterString,
  getFieldValue,
}: {
  items: TItem[];
  filterString: string | undefined;
  validateFilterString: (filterString: string) => string;
  getFieldValue: (item: TItem, field: TField) => ClientSideFilterValue;
}): TItem[] {
  if (!filterString) {
    return items;
  }

  const validatedFilter = validateFilterString(filterString);
  const filters: FilterExpression<TField>[] = splitTopLevel(validatedFilter, ',')
    .map((expression) => expression.trim())
    .filter(Boolean)
    .map((expression) => {
      const [field, operator, ...valueParts] = expression.split(':');
      return {
        field: field as TField,
        operator: operator as FilterOperator,
        value: valueParts.join(':'),
      };
    });

  return items.filter((item) =>
    filters.every(({ field, operator, value }) =>
      matchesClientSideFilter(getFieldValue(item, field), operator, value),
    ),
  );
}

export function matchesClientSideFilter(
  fieldValue: ClientSideFilterValue,
  operator: FilterOperator,
  filterValue: string,
): boolean {
  if (fieldValue === undefined || fieldValue === null) {
    return false;
  }

  const fieldString = String(fieldValue);

  switch (operator) {
    case 'eq':
      return fieldString === filterValue;
    case 'in':
      return parseInValues(filterValue).includes(fieldString);
    case 'gt':
      return typeof fieldValue === 'number'
        ? fieldValue > Number(filterValue)
        : fieldString > filterValue;
    case 'gte':
      return typeof fieldValue === 'number'
        ? fieldValue >= Number(filterValue)
        : fieldString >= filterValue;
    case 'lt':
      return typeof fieldValue === 'number'
        ? fieldValue < Number(filterValue)
        : fieldString < filterValue;
    case 'lte':
      return typeof fieldValue === 'number'
        ? fieldValue <= Number(filterValue)
        : fieldString <= filterValue;
    default:
      return false;
  }
}

function parseInValues(value: string): string[] {
  const inner = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
  return inner
    .split(/[,|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
