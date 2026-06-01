import { z } from 'zod';

import { User } from '../../../sdks/tableau/types/user.js';
import {
  FilterOperator,
  FilterOperatorSchema,
  parseAndValidateFilterString,
} from '../../../utils/parseAndValidateFilterString.js';

// === Field and Operator Definitions ===
// Client-side filtering for users (API doesn't support server-side filtering)

const FilterFieldSchema = z.enum([
  'id',
  'name',
  'siteRole',
  'email',
  'fullName',
  'lastLogin',
  'authSetting',
  'locale',
  'language',
  'externalAuthUserId',
]);

type FilterField = z.infer<typeof FilterFieldSchema>;

const allowedOperatorsByField: Record<FilterField, FilterOperator[]> = {
  id: ['eq', 'in'],
  name: ['eq', 'in'],
  siteRole: ['eq', 'in'],
  email: ['eq', 'in'],
  fullName: ['eq', 'in'],
  lastLogin: ['eq', 'gt', 'gte', 'lt', 'lte'],
  authSetting: ['eq', 'in'],
  locale: ['eq', 'in'],
  language: ['eq', 'in'],
  externalAuthUserId: ['eq', 'in'],
};

const dateFields: Set<FilterField> = new Set(['lastLogin']);

const _FilterExpressionSchema = z.object({
  field: FilterFieldSchema,
  operator: FilterOperatorSchema,
  value: z.string(),
});

type FilterExpression = z.infer<typeof _FilterExpressionSchema>;

export function parseAndValidateUsersFilterString(filterString: string): string {
  return parseAndValidateFilterString<FilterField, FilterExpression>({
    filterString,
    allowedOperatorsByField,
    filterFieldSchema: FilterFieldSchema,
  });
}

/**
 * Apply client-side filtering to users based on filter expressions.
 * Supports field:operator:value syntax (e.g., "siteRole:eq:Creator")
 * Supports multiple conditions on the same field (e.g., "lastLogin:gt:X,lastLogin:lt:Y" for date ranges)
 */
export function applyUserFilters(users: User[], filterString: string | undefined): User[] {
  if (!filterString) {
    return users;
  }

  // Parse filter expressions directly to preserve duplicate fields (e.g., date ranges)
  const expressions = filterString
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean);

  const filters = expressions.map((expr) => {
    const [fieldRaw, operatorRaw, ...valueParts] = expr.split(':');
    const field = FilterFieldSchema.parse(fieldRaw);
    const operator = FilterOperatorSchema.parse(operatorRaw);

    if (!allowedOperatorsByField[field].includes(operator)) {
      throw new Error(
        `Operator '${operator}' is not allowed for field '${field}'. Allowed operators: ${allowedOperatorsByField[field].join(', ')}`,
      );
    }

    return {
      field,
      operator,
      value: valueParts.join(':'),
    };
  });

  return users.filter((user) => {
    return filters.every(({ field, operator, value }) => {
      const fieldValue = getFieldValue(user, field);
      return matchesFilter(fieldValue, operator, value, field);
    });
  });
}

function getFieldValue(user: User, field: FilterField): string | number | undefined {
  switch (field) {
    case 'id':
      return user.id;
    case 'name':
      return user.name;
    case 'siteRole':
      return user.siteRole;
    case 'email':
      return user.email;
    case 'fullName':
      return user.fullName;
    case 'lastLogin':
      return user.lastLogin;
    case 'authSetting':
      return user.authSetting;
    case 'locale':
      return user.locale;
    case 'language':
      return user.language;
    case 'externalAuthUserId':
      return user.externalAuthUserId;
    default:
      return undefined;
  }
}

function matchesFilter(
  fieldValue: string | number | undefined,
  operator: FilterOperator,
  filterValue: string,
  field: FilterField,
): boolean {
  if (fieldValue === undefined || fieldValue === null) {
    return false;
  }

  const fieldStr = String(fieldValue);

  switch (operator) {
    case 'eq':
      if (dateFields.has(field)) {
        return new Date(fieldStr).getTime() === new Date(filterValue).getTime();
      }
      return fieldStr === filterValue;
    case 'in':
      return filterValue.split('|').includes(fieldStr);
    case 'gt':
      if (dateFields.has(field)) {
        return new Date(fieldStr).getTime() > new Date(filterValue).getTime();
      }
      return typeof fieldValue === 'number'
        ? fieldValue > Number(filterValue)
        : fieldStr > filterValue;
    case 'gte':
      if (dateFields.has(field)) {
        return new Date(fieldStr).getTime() >= new Date(filterValue).getTime();
      }
      return typeof fieldValue === 'number'
        ? fieldValue >= Number(filterValue)
        : fieldStr >= filterValue;
    case 'lt':
      if (dateFields.has(field)) {
        return new Date(fieldStr).getTime() < new Date(filterValue).getTime();
      }
      return typeof fieldValue === 'number'
        ? fieldValue < Number(filterValue)
        : fieldStr < filterValue;
    case 'lte':
      if (dateFields.has(field)) {
        return new Date(fieldStr).getTime() <= new Date(filterValue).getTime();
      }
      return typeof fieldValue === 'number'
        ? fieldValue <= Number(filterValue)
        : fieldStr <= filterValue;
    default:
      return false;
  }
}

export const exportedForTesting = {
  FilterFieldSchema,
  applyUserFilters,
  getFieldValue,
  matchesFilter,
};
