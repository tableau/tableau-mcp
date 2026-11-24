export const prepCalculationReference =
  'https://help.tableau.com/current/prep/en-us/prep_function_reference.htm';
export const prepCalculationVersion = '2026.3';

export type CalculationLiteralType = 'number' | 'string' | 'boolean' | 'date';

type Parameter = Readonly<{
  name: string;
  literalType?: CalculationLiteralType;
  optional?: true;
}>;

const number = (name = 'number'): Parameter => ({ name, literalType: 'number' });
const string = (name = 'text'): Parameter => ({ name, literalType: 'string' });
const date: Parameter = { name: 'date', literalType: 'date' };
const value: Parameter = { name: 'value' };
const optional = (parameter: Parameter): Parameter => ({ ...parameter, optional: true });
const n = number();
const s = string();
const datePart = string('datePart');
const weekStart = optional(string('weekStart'));
const pattern = string('pattern');
const substring = string('substring');

// Tableau Prep Functions Reference, with duplicate entries collapsed. DATEPART follows the
// reference example and the function name present in Tableau Prep Builder 2026.3.1.
const definitions = {
  Number: {
    ABS: [n],
    ACOS: [n],
    ASIN: [n],
    ATAN: [n],
    ATAN2: [number('y'), number('x')],
    CEILING: [n],
    COS: [n],
    COT: [n],
    DIV: [number('dividend'), number('divisor')],
    EXP: [n],
    FLOOR: [n],
    HEXBINX: [number('x'), number('y')],
    HEXBINY: [number('x'), number('y')],
    LN: [n],
    LOG: [n, optional(number('base'))],
    MAX: [value, optional({ name: 'other' })],
    MIN: [value, optional({ name: 'other' })],
    PI: [],
    POWER: [n, number('exponent')],
    RADIANS: [n],
    ROUND: [n, optional(number('places'))],
    SIGN: [n],
    SIN: [n],
    SQRT: [n],
    SQUARE: [n],
    TAN: [n],
    ZN: [n],
  },
  String: {
    ASCII: [s],
    CHAR: [number('code')],
    CONTAINS: [s, substring],
    ENDSWITH: [s, substring],
    FIND: [s, substring, optional(number('start'))],
    FINDNTH: [s, substring, number('occurrence')],
    ISDATE: [s],
    LEFT: [s, number('length')],
    LEN: [s],
    LOWER: [s],
    LTRIM: [s],
    MID: [s, number('start'), optional(number('length'))],
    PROPER: [s],
    REGEXP_EXTRACT: [s, pattern],
    REGEXP_EXTRACT_NTH: [s, pattern, number('index')],
    REGEXP_MATCH: [s, pattern],
    REGEXP_REPLACE: [s, pattern, string('replacement')],
    REPLACE: [s, substring, string('replacement')],
    RIGHT: [s, number('length')],
    RTRIM: [s],
    SPACE: [number('length')],
    SPLIT: [s, string('delimiter'), number('token')],
    STARTSWITH: [s, substring],
    TRIM: [s],
    UPPER: [s],
  },
  Aggregate: {
    AVG: [n],
    COUNT: [value],
    COUNTD: [value],
    MEDIAN: [n],
    PERCENTILE: [n, number('percentile')],
    STDEV: [n],
    STDEVP: [n],
    SUM: [n],
    VAR: [n],
    VARP: [n],
  },
  Conversion: {
    DATE: [value],
    DATETIME: [value],
    FLOAT: [value],
    INT: [value],
    MAKEDATE: [number('year'), number('month'), number('day')],
    MAKEDATETIME: [{ name: 'date' }, { name: 'time' }],
    MAKETIME: [number('hour'), number('minute'), number('second')],
    STR: [value],
  },
  Date: {
    DATEADD: [datePart, number('interval'), date],
    DATEDIFF: [datePart, { ...date, name: 'start' }, { ...date, name: 'end' }, weekStart],
    DATENAME: [datePart, date, weekStart],
    DATEPARSE: [string('format'), s],
    DATEPART: [datePart, date, weekStart],
    DATETRUNC: [datePart, date, weekStart],
    DAY: [date],
    MONTH: [date],
    NOW: [],
    TODAY: [],
    YEAR: [date],
  },
  Logical: {
    IFNULL: [value, { name: 'fallback' }],
    IIF: [
      { name: 'test', literalType: 'boolean' },
      { name: 'ifTrue' },
      { name: 'ifFalse' },
      optional({ name: 'ifUnknown' }),
    ],
    ISNULL: [value],
  },
  Analytic: {
    LAST_VALUE: [value, optional({ name: 'ignoreNulls', literalType: 'boolean' })],
    LOOKUP: [value, optional(number('offset'))],
    NTILE: [number('tiles')],
    RANK: [],
    RANK_DENSE: [],
    RANK_MODIFIED: [],
    RANK_PERCENTILE: [],
    ROW_NUMBER: [],
    RUNNING_AVG: [n],
    RUNNING_SUM: [n],
  },
} satisfies Record<string, Record<string, readonly Parameter[]>>;

export const prepCalculationFunctions = Object.entries(definitions)
  .flatMap(([category, functions]) =>
    Object.entries<readonly Parameter[]>(functions).map(([name, parameters]) => ({
      name,
      category,
      parameters,
      signature: `${name}(${parameters.map(({ name, optional }) => (optional ? `[${name}]` : name)).join(', ')})`,
      minArgs: parameters.filter(({ optional }) => !optional).length,
      maxArgs: parameters.length,
    })),
  )
  .sort((a, b) => a.name.localeCompare(b.name));

export const prepFunctionByName = new Map(prepCalculationFunctions.map((fn) => [fn.name, fn]));
