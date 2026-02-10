import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { Server } from '../../server.js';
import { Tool } from '../tool.js';

const paramsSchema = {
  calculationType: z.enum(['BASIC', 'LOD', 'TABLE']),
  excludeFunctionsList: z.boolean().default(false).optional(),
  excludeCalculationStructureInfo: z.boolean().default(false).optional(),
  excludeExamplesForCalculationType: z.boolean().default(false).optional(),
};

const description = `
This tool retrieves relevant information for constructing Tableau calculations.
Provides details on how to construct a calculation given its type and which functions are available for use.
Before you can determine whether or not you want to construct a calculation be sure to understand available fields and their types.

When should you use this tool?
  - A user explicity requests a calculation to be constructed and information is needed for the given calculation type.
  - When you need to construct a calculation as part of a query and information is needed for the given calculation type.

Types of Tableau calculations:
  - Basic
  - LOD (level of detail)
  - Table

Basic calculations transform values at the datasource level of detail (a row-level calculation) or at the visualization level of detail (an aggregate calculation).

LOD calculations compute values at the data source level and the visualization level, at a more granular level (INCLUDE), a less granular level (EXCLUDE), or an entirely independent level of detail (FIXED).

Table calculations compute values only at the level of detail of the visualization. They are calculated based on what is currently in the visualization and do not consider any measures or dimensions that are filtered out of the visualization.
They are required to support:
    - ranking
    - recursion e.g. cumulative/running totals
    - moving calculations e.g. rolling averages
    - inter-row calculations e.g. period vs. period calculations

Algorithm to determine which calculation type to use:
1. If the user request can not be satisfied based on the current viz definition and the underlying datasource metadata, choose none.
2. If the user asks for ranking, recursion, moving or inter-row calculations, use a TABLE calculation.
3. If all the data values required are present on the visualization, use a TABLE calculation.
4. If the granularity of the user question matches either the granularity of the visualization or the granularity of the data source, choose BASIC.
5. Otherwise, choose LOD.
`;

const basicCalculationExamples = `
1. SUM([Profit])/SUM([Sales]) - Calculates the profit ratio

`;

const lodCalculationExamples = `
1. Customer order frequency: { FIXED [Customer Id] : COUNTD([Order Id]) }
- Calculates the number of orders per customer. You can use this calculation to create a histogram of customer order frequency.

2. Comparitive sales analysis: { EXCLUDE [Category] : SUM([Selected Sales]) }
- Excludes the Category from grouping the sum of selected sales will total the selected sales across all rows
- This will make it easy to compare the sales of each Category to a selected Category.

3. Top deals by sales rep: { INCLUDE [Sales Rep] : MAX([Sales]) }
- This calculation can be used to find the top deals by sales rep.
- MAX([Sales]) will only find the the largest deal size since there is only one record per deal, so we include the Sales Rep to group the deals by sales rep.
`;

const tableCalculationExamples = `
TODO
`;

const basicCalculationInfo = `
Basic calculations transform values at the datasource level of detail (a row-level calculation) or at the visualization level of detail (an aggregate calculation).
`;

const lodCalculationInfo = `
LOD calculations compute values at the data source level and the visualization level, at a more granular level (INCLUDE), a less granular level (EXCLUDE), or an entirely independent level of detail (FIXED).

LOD syntax: { [FIXED | INCLUDE | EXCLUDE] <dimension declaration> : <aggregate expression> }

FIXED:
- computes values using the specified dimensions without reference to the view level of detail.
- ignores all the filters in the view other than context filters, data source filters, and extract filters.
- Example: { FIXED [Region] : SUM([Sales]) } computes the sum of Sales per region.

INCLUDE:
- computes values using the specified dimensions in addition to whatever dimensions are in the view.
- are more useful when including dimensions that are not in the view.
- Example: { INCLUDE [Customer Name] : SUM([Sales]) } computes the total sales per customer.

EXCLUDE:
- explicitly remove dimensions from the expression and are more useful when excluding dimensions that are in the view.
- Example: { EXCLUDE [Region]: SUM([Sales]) }

<dimension declaration>:
- Specifies one or more dimensions that set the scope of the aggregate expression, according to the keyword. Use commas to separate multiple dimensions.
- Example: [Name] or [Segment], [Category], [Region] for multiple dimensions.
- You can use any expression that evaluates as dimension, including Date expressions.
- Example: {FIXED YEAR([Order Date]) : SUM([Sales])} aggregates the sum of Sales at the Year level.

<aggregate expression>:
- The aggregate expression is the calculation that is performed.
- Example: SUM([Sales]) or AVG([Discount]).
- The results of the calculation in the aggregate expression depend on the dimension declaration and keyword.
- The aggregate expression must be aggregated. The ATTR aggregation isn’t supported, however. It doesn't have to be a simple aggregation, it can contain calculations, including other LOD expressions.
- Example: {FIXED [Question] : AVG(IF [Answer] = "Red" THEN 1 ELSE 0 END )}
- Table calculations aren't permitted in the aggregate expression.

Table-Scoped LOD calculations:
- Are level of detail expressions at the table level without using any of the scoping keywords (i.e. only the agreggate expression is used).
- Example: { MIN([Order Date]) } is the minimum (earliest) order date for the entire table. This is equivalent to a FIXED level of detail expression with no dimension declaration (i.e. { FIXED : MIN([Order Date]) }).
`;

const tableCalculationInfo = `
TODO
`;

const calculationStructureInfo = `
Calculation expressions are composed of the following components:
- Fields
- Operators
- Functions
- Constants
- Parameters

Fields are dimensions or measures from the data source. Fields are inserted into calculations by enclosing the field name in brackets. Example: [Sales Category].

Constants are fixed values used in calculations. The syntax for constants depends on the data type:
- Strings use signle or double quotes. Example: "Sales" or 'Sales'
- Numbers / Decimals are written as is. Example: 1000, 1.25
- Booleans are written as true or false (lowercase).
- Dates are wrapped by the pound symbol (#). Example: #August 22, 2005# or #2005-08-22#

Parameter are placeholder values that can be inserted into calculations to replace constant values. Parameters are enclosed in square brackets. Example: [Selected Year].

Functions are statements used to transform the values or members in a field. They are the main components of a calculation and can be used for various purposes.
Every functions requires a particular syntax. You can use more than one function in a calculation and functions can be nested. The type of function you use determines the type of field you can use.

Operators are symbols that denote an operation. Operators have a precedence that determines the order of operations in a calculation.

Operator precedence:
1. - (negate)
2. ^ (power)
3. *, /, %
4. +, -
5. ==, =, >, <, >=, <=, !=, <>
6. NOT
7. AND
8. OR

Parentheses can be used as needed to force an order of precedence. Operators that appear within parentheses are evaluated before those outside the parentheses, starting from the innermost parentheses and moving outward.

Calculations do not always need to contain all components.
`;

type functionInfo = {
  command: string;
  syntax: string;
  description: string;
};

const functionsList: Array<functionInfo> = [
  {
    command: 'ABS',
    syntax: 'ABS(number)',
    description: 'Returns the absolute value of the given number. Example: ABS(-7) = 7',
  },
  {
    command: 'ACOS',
    syntax: 'ACOS(number)',
    description:
      'Returns the arc cosine of a number. The result is in radians. Example: ACOS(-1) = 3.14159265358979',
  },
  {
    command: 'AREA',
    syntax: 'AREA(polygon, units)',
    description: "Returns the area of a polygon or multipolygon. Example: AREA([Geometry], 'km')",
  },
  {
    command: 'ASIN',
    syntax: 'ASIN(number)',
    description:
      'Returns the arc sine of a number. The result is in radians. Example: ASIN(1) = 1.5707963267949',
  },
  {
    command: 'ATAN',
    syntax: 'ATAN(number)',
    description:
      'Returns the arc tangent of a number. The result is in radians. Example: ATAN(180) = 1.5652408283942',
  },
  {
    command: 'ATAN2',
    syntax: 'ATAN2(y number, x number)',
    description:
      'Returns the arc tangent of two given numbers (x and y). The result is in radians. Example: ATAN2(2, 1) = 1.10714871779409',
  },
  {
    command: 'ASCII',
    syntax: 'ASCII(string)',
    description:
      "Returns the ASCII code value of the first character in a string. Example: ASCII('authors') = 97",
  },
  {
    command: 'ATTR',
    syntax: 'ATTR(expression)',
    description:
      'Returns the value of the given expression if it only has a single value for all rows in the group, otherwise it displays an asterisk (*). Null values are ignored. Example: ATTR([Market])',
  },
  {
    command: 'AVG',
    syntax: 'AVG(expression)',
    description:
      'Returns the average of all the values in the expression. AVG can be used with numeric fields only. Example: AVG([Profit])',
  },
  {
    command: 'BUFFER',
    syntax: 'BUFFER(geometry, number, units)',
    description:
      "Returns a buffer of the given distance around a geometry. Example: BUFFER(MAKEPOINT(47.59, -122.32), 5, 'km')",
  },
  {
    command: 'CASE',
    syntax: 'CASE <expr> WHEN <value1> THEN <return1> ... [ELSE <else>] END',
    description:
      "Finds the first <value> that matches <expr> and returns the corresponding <return>. Example: CASE [RomanNumeral] WHEN 'I' THEN 1 WHEN 'II' THEN 2 ELSE 3 END",
  },
  {
    command: 'CHAR',
    syntax: 'CHAR(integer)',
    description: "Converts the given integer ASCII code into a character. Example: CHAR(65) = 'A'",
  },
  {
    command: 'COLLECT',
    syntax: 'COLLECT(spatial)',
    description:
      'Aggregate calculation that combines the values in the argument field. COLLECT can be used with spatial fields only. Null values are ignored. Example: COLLECT([Geometry])',
  },
  {
    command: 'UNION',
    syntax: 'UNION(spatial)',
    description:
      'Aggregate calculation that combines the values in the argument field into a single spatial. UNION can be used with spatial fields only. Null values are ignored. Example: UNION([Geometry])',
  },
  {
    command: 'CONTAINS',
    syntax: 'CONTAINS(string, substring)',
    description:
      "Returns true if the string contains the substring. Example: CONTAINS('Calculation', 'alcu') is true",
  },
  {
    command: 'CORR',
    syntax: 'CORR(expr1, expr2)',
    description:
      'Returns the Pearson correlation coefficient of two expressions. Example: CORR([Sales], [Profit])',
  },
  {
    command: 'COS',
    syntax: 'COS(angle)',
    description:
      'Returns the cosine of an angle. Specify the angle in radians. Example: COS(PI()/4) = 0.707106781186548',
  },
  {
    command: 'COT',
    syntax: 'COT(angle)',
    description:
      'Returns the cotangent of an angle. Specify the angle in radians. Example: COT(PI()/4) = 1',
  },
  {
    command: 'COUNT',
    syntax: 'COUNT(expression)',
    description:
      'Returns the number of items in a group. NULL values are not counted. Example: COUNT([Customer ID])',
  },
  {
    command: 'COVAR',
    syntax: 'COVAR(expr1, expr2)',
    description:
      'Returns the sample covariance of two expressions. Example: COVAR([Sales], [Profit])',
  },
  {
    command: 'COVARP',
    syntax: 'COVARP(expr1, expr2)',
    description:
      'Returns the population covariance of two expressions. Example: COVARP([Sales], [Profit])',
  },
  {
    command: 'COUNTD',
    syntax: 'COUNTD(expression)',
    description:
      'Returns the number of distinct items in a group. NULL values are not counted. Each unique value is counted only once. Example: COUNTD([Region])',
  },
  {
    command: 'DATE',
    syntax: 'DATE(expression)',
    description:
      "Returns a date given a number, string, or date expression. Example: DATE('2006-06-15 14:52') = 2006-06-15. Note that the quotation marks are required.",
  },
  {
    command: 'DATEADD',
    syntax: 'DATEADD(date_part, interval, date)',
    description:
      "Adds an increment to the specified date and returns the new date. The increment is defined by the interval and the date_part. Example: DATEADD('month', 3, #2004-04-15#) = 2004-07-15 12:00:00 AM",
  },
  {
    command: 'DATEDIFF',
    syntax: 'DATEDIFF(date_part, start_date, end_date, [start_of_week])',
    description:
      "Returns the difference between two dates where start_date is subtracted from end_date. The difference is expressed in units of date_part. If start_of_week is omitted, the week start day is determined by the start day configured for the data source. Example: DATEDIFF('month', #2004-07-15#, #2004-04-03#, 'sunday') = -3",
  },
  {
    command: 'DATENAME',
    syntax: 'DATENAME(date_part, date, [start_of_week])',
    description:
      "Returns a part of the given date as a string, where the part is defined by date_part. If start_of_week is omitted, the week start day is determined by the start day configured for the data source. Example: DATENAME('month', #2004-04-15#) = 'April'",
  },
  {
    command: 'DATEPARSE',
    syntax: 'DATEPARSE(format, string)',
    description:
      "Converts a string to a date in the specified format. Example: DATEPARSE('dd.MMMM.yyyy', '15.April.2004') = 2004-04-15 12:00:00 AM",
  },
  {
    command: 'DATEPART',
    syntax: 'DATEPART(date_part, date, [start_of_week])',
    description:
      "Returns a part of the given date as an integer where the part is defined by date_part. If start_of_week is omitted, the week start day is determined by the start day configured for the data source. Example: DATEPART('month', #2004-04-15#) = 4",
  },
  {
    command: 'DATETIME',
    syntax: 'DATETIME(expression)',
    description:
      "Returns a datetime given a number, string, or date expression. Example: DATETIME('April 15, 2004 07:59:00'). Note that the quotation marks are required.",
  },
  {
    command: 'DATETRUNC',
    syntax: 'DATETRUNC(date_part, date, [start_of_week])',
    description:
      "Truncates the specified date to the accuracy specified by the date_part and returns the new date. If start_of_week is omitted, the week start day is determined by the start day configured for the data source. Example: DATETRUNC('quarter', #2004-08-15#) = 2004-07-01 12:00:00 AM",
  },
  {
    command: 'DAY',
    syntax: 'DAY(date)',
    description: 'Returns the day of the given date as an integer. Example: DAY(#2004-04-12#) = 12',
  },
  {
    command: 'DEGREES',
    syntax: 'DEGREES(number)',
    description: 'Converts a number in radians to degrees. Example: DEGREES(PI()/4) = 45.0',
  },
  {
    command: 'DISTANCE',
    syntax: 'DISTANCE(start, end, units)',
    description:
      "Returns the distance between two points. Example: DISTANCE(MAKEPOINT(47.59, -122.32), MAKEPOINT(-33.85, 150.92), 'km')",
  },
  {
    command: 'ENDSWITH',
    syntax: 'ENDSWITH(string, substring)',
    description:
      "Returns true if the string ends with the substring (trailing whitespace is ignored). Example: ENDSWITH('Calculation', 'ion') is true",
  },
  {
    command: 'EXP',
    syntax: 'EXP(number)',
    description: 'Returns e raised to the power of the given number. Example: EXP(5) = e^5',
  },
  {
    command: 'FIND',
    syntax: 'FIND(string, substring, [start])',
    description:
      "Returns the position of a substring within a string, or 0 if the substring isn't found. If the start argument is defined, any instances of substring that appear before the start position are ignored. The first character in the string is position 1. Example: FIND('Calculation', 'alcu') = 2",
  },
  {
    command: 'FINDNTH',
    syntax: 'FINDNTH(string, substring, occurrence)',
    description:
      "Returns the position of the nth occurrence of a substring within a string, or 0 if that occurrence of the substring isn't found. The first character in the string is position 1. Example: FINDNTH('Calculation', 'a', 2) = 7",
  },
  {
    command: 'FLOAT',
    syntax: 'FLOAT(expression)',
    description:
      "Returns a float given an expression of any type. This function requires unformatted numbers which means exclude commas and other symbols. Example: FLOAT('3') = 3.000",
  },
  {
    command: 'FULLNAME',
    syntax: 'FULLNAME()',
    description:
      'Returns the full name for the current user. This is the Tableau Server or Tableau Cloud full name when the user is signed in; otherwise it is the local or network full name for the Tableau Desktop user.',
  },
  {
    command: 'HASH',
    syntax: 'HASH(expression)',
    description:
      'Converts any value to a whole number. Two values are unlikely to convert to the same number, but this is not guaranteed. Consecutive values are also unlikely to map to consecutive numbers.',
  },
  {
    command: 'IF',
    syntax: 'IF <expr> THEN <then> [ELSEIF <expr2> THEN <then2> ...] [ELSE <else>] END',
    description:
      "Tests a series of expressions returning the <then> value for the first true <expr>. Example: IF [Profit] > 0 THEN 'Profitable' ELSEIF [Profit] = 0 THEN 'Breakeven' ELSE 'Loss' END",
  },
  {
    command: 'IFNULL',
    syntax: 'IFNULL(expr1, expr2)',
    description:
      'Returns <expr1> if it is not null, otherwise returns <expr2>. Example: IFNULL([Profit], 0)',
  },
  {
    command: 'IIF',
    syntax: 'IIF(test, then, else, [unknown])',
    description:
      "Checks whether a condition is met, and returns one value if TRUE, another value if FALSE, and an optional third value or NULL if unknown. Example: IIF([Profit] > 0, 'Profit', 'Loss')",
  },
  {
    command: 'IN',
    syntax: '<expr> IN <expr1>',
    description:
      'Returns TRUE if <expr> matches any value in <expr1>. Example: SUM([Cost]) IN (1000, 199)',
  },
  {
    command: 'INT',
    syntax: 'INT(expression)',
    description:
      'Returns an integer given an expression. This function truncates results to the closest integer toward zero. Example: INT(8.0/3.0) = 2 or INT(-9.7) = -9',
  },
  {
    command: 'ISDATE',
    syntax: 'ISDATE(string)',
    description:
      "Returns true if a given string is a valid date. Example: ISDATE('2004-04-15') = True",
  },
  {
    command: 'ISFULLNAME',
    syntax: 'ISFULLNAME(string)',
    description:
      "Returns true if the current user's full name matches the specified full name, or false if it does not match. This function uses the Tableau Server or Tableau Cloud full name when the user is signed in; otherwise it uses the local or network full name for the Tableau Desktop user.",
  },
  {
    command: 'ISMEMBEROF',
    syntax: 'ISMEMBEROF(string)',
    description:
      'Returns true if the current user is a member of the given group, false otherwise. This uses the Tableau Server to resolve group membership if logged on, otherwise it always returns false.',
  },
  {
    command: 'ISNULL',
    syntax: 'ISNULL(expression)',
    description: 'Returns true if the expression is null. Example: ISNULL([Profit])',
  },
  {
    command: 'ISOQUARTER',
    syntax: 'ISOQUARTER(date)',
    description:
      'Returns the ISO8601 week-based quarter of a given date as an integer. Example: ISOQUARTER(#2004-03-29#) = 2',
  },
  {
    command: 'ISOWEEK',
    syntax: 'ISOWEEK(date)',
    description:
      'Returns the ISO8601 week-based week of a given date as an integer. Example: ISOWEEK(#2004-03-29#) = 14',
  },
  {
    command: 'ISOWEEKDAY',
    syntax: 'ISOWEEKDAY(date)',
    description:
      'Returns the ISO8601 week-based weekday of a given date as an integer. Example: ISOWEEKDAY(#2004-03-29#) = 1',
  },
  {
    command: 'ISOYEAR',
    syntax: 'ISOYEAR(date)',
    description:
      'Returns the ISO8601 week-based year of a given date as an integer. Example: ISOYEAR(#2003-12-29#) = 2004',
  },
  {
    command: 'ISUSERNAME',
    syntax: 'ISUSERNAME(string)',
    description:
      'Returns true if the current username matches the specified username, or false if it does not match.',
  },
  {
    command: 'LEFT',
    syntax: 'LEFT(string, num_chars)',
    description:
      "Returns the specified number of characters from the start of the given string. Example: LEFT('Calculation', 4) = 'Calc'",
  },
  {
    command: 'LEN',
    syntax: 'LEN(string)',
    description:
      "Returns the number of characters in the given string. Example: LEN('Calculation') = 11",
  },
  {
    command: 'LN',
    syntax: 'LN(number)',
    description:
      'Returns the natural logarithm of the given number. Returns Null if the number is less than or equal to zero. Example: LN(EXP(5)) = 5',
  },
  {
    command: 'LOG',
    syntax: 'LOG(number, [base])',
    description:
      'Returns the logarithm of a number for the given base. If the base value is omitted, base 10 is used. Example: LOG(100) = 2, LOG(256, 2) = 8',
  },
  {
    command: 'LOWER',
    syntax: 'LOWER(string)',
    description:
      "Converts a text string to all lowercase letters. Example: LOWER('PRODUCT') = 'product'",
  },
  {
    command: 'LTRIM',
    syntax: 'LTRIM(string)',
    description:
      "Returns the string with any leading spaces removed. Example: LTRIM(' Sales') = 'Sales'",
  },
  {
    command: 'MAKEDATE',
    syntax: 'MAKEDATE(year, month, day)',
    description:
      'Returns a date value constructed from a year, a month and a day of the month. Example: MAKEDATE(2014, 3, 18)',
  },
  {
    command: 'MAKEDATETIME',
    syntax: 'MAKEDATETIME(date, time)',
    description:
      'Returns a date and time value given a date expression and a time expression. Example: MAKEDATETIME(#2012-11-12#, #07:59:00#)',
  },
  {
    command: 'MAKETIME',
    syntax: 'MAKETIME(hour, minute, second)',
    description:
      'Returns a time value constructed from hours, minutes and seconds. Example: MAKETIME(14, 52, 40)',
  },
  {
    command: 'MAKELINE',
    syntax: 'MAKELINE(start, end)',
    description: 'Returns a line constructed from two points. Example: MAKELINE([Start], [End])',
  },
  {
    command: 'MAKEPOINT',
    syntax: 'MAKEPOINT(latitude, longitude) or MAKEPOINT(x, y, SRID)',
    description:
      'Returns a spatial object constructed from latitude and longitude or from x-coordinate, y-coordinate, and SRID. Example: MAKEPOINT([Latitude],[Longitude]) or MAKEPOINT([x_coordinate],[y_coordinate],102748)',
  },
  {
    command: 'MAX',
    syntax: 'MAX(expression) or MAX(expr1, expr2)',
    description:
      'Returns the maximum of a single expression across all records or the maximum of two expressions for each record. Example: MAX([Sales])',
  },
  {
    command: 'MEDIAN',
    syntax: 'MEDIAN(expression)',
    description:
      'Returns the median of a single expression. MEDIAN can be used with numeric fields only. Null values are ignored. Example: MEDIAN([Profit])',
  },
  {
    command: 'MID',
    syntax: 'MID(string, start, [length])',
    description:
      "Returns the characters from the middle of a text string given a starting position and a length. The first character in the string is position 1. If the length is not included, all characters to the end of the string are returned. Example: MID('Tableau Software', 9) = 'Software', MID('Tableau Software', 2, 4) = 'able'",
  },
  {
    command: 'MIN',
    syntax: 'MIN(expression) or MIN(expr1, expr2)',
    description:
      'Returns the minimum of an expression across all records or the minimum of two expressions for each record. Example: MIN([Profit])',
  },
  {
    command: 'MONTH',
    syntax: 'MONTH(date)',
    description:
      'Returns the month of a given date as an integer. Example: MONTH(#2004-04-12#) = 4',
  },
  {
    command: 'NOW',
    syntax: 'NOW()',
    description: 'Returns the current date and time. Example: NOW() = 2004-05-12 1:08:21 PM',
  },
  {
    command: 'PERCENTILE',
    syntax: 'PERCENTILE(expression, number)',
    description:
      'Aggregate calculation that returns the percentile value from the given expression corresponding to the specified number. Valid values for the number are 0 through 1. Example: PERCENTILE([Sales], 0.90)',
  },
  {
    command: 'PI',
    syntax: 'PI()',
    description: 'Returns the numeric constant pi. Example: PI() = 3.14159265358979',
  },
  {
    command: 'POWER',
    syntax: 'POWER(number, power)',
    description:
      'Returns the result of a number raised to the given power. Example: POWER(5, 2) = 5^2 = 25',
  },
  {
    command: 'QUARTER',
    syntax: 'QUARTER(date)',
    description:
      'Returns the quarter of a given date as an integer. Example: QUARTER(#2004-04-12#) = 2',
  },
  {
    command: 'RADIANS',
    syntax: 'RADIANS(number)',
    description: 'Converts a number in degrees to radians.',
  },
  {
    command: 'RANDOM',
    syntax: 'RANDOM()',
    description:
      'Returns a random number between zero and one. The number will not be the same for different rows or for different executions. Example: RANDOM()',
  },
  {
    command: 'REPLACE',
    syntax: 'REPLACE(string, substring, replacement)',
    description:
      "Returns a string in which every occurrence of the substring is replaced with the replacement string. If the substring is not found, the string is unchanged. Example: REPLACE('Calculation', 'ion', 'ed') = 'Calculated'",
  },
  {
    command: 'RIGHT',
    syntax: 'RIGHT(string, num_chars)',
    description:
      "Returns the specified number of characters from the end of the given string. Example: RIGHT('Calculation', 4) = 'tion'",
  },
  {
    command: 'ROUND',
    syntax: 'ROUND(number, [decimals])',
    description:
      'Rounds a number to the nearest integer or to a specified number of decimal places. Example: ROUND(3.1415, 1) = 3.1',
  },
  {
    command: 'RTRIM',
    syntax: 'RTRIM(string)',
    description:
      "Returns the string with any trailing spaces removed. Example: RTRIM('Market ') = 'Market'",
  },
  {
    command: 'SIGN',
    syntax: 'SIGN(number)',
    description:
      'Returns the sign of a number: 1 if the number is positive, zero if the number is zero, or -1 if the number is negative. Example: SIGN([Profit])',
  },
  {
    command: 'SIN',
    syntax: 'SIN(angle)',
    description:
      'Returns the sine of an angle. Specify the angle in radians. Example: SIN(PI()/4) = 0.707106781186548',
  },
  {
    command: 'SPACE',
    syntax: 'SPACE(number)',
    description:
      "Returns a string composed of the specified number of repeated spaces. Example: SPACE(2) = '  '",
  },
  {
    command: 'SPLIT',
    syntax: 'SPLIT(string, delimiter, token number)',
    description:
      "Returns a substring from a string, as determined by a delimiter extracting the characters from the beginning or end of the string. Example: SPLIT('a-b-c-d', '-', 2) = 'b', SPLIT('a-b-c-d', '-', -2) = 'c'",
  },
  {
    command: 'SQRT',
    syntax: 'SQRT(number)',
    description: 'Returns the square root of a number. Example: SQRT(25) = 5',
  },
  {
    command: 'SQUARE',
    syntax: 'SQUARE(number)',
    description: 'Returns the square of a given number. Example: SQUARE(5) = 25',
  },
  {
    command: 'STARTSWITH',
    syntax: 'STARTSWITH(string, substring)',
    description:
      "Returns true if the string starts with the substring. Example: STARTSWITH('Calculation', 'Ca') is true",
  },
  {
    command: 'STDEV',
    syntax: 'STDEV(expression)',
    description:
      'Returns the sample standard deviation of the expression. Example: STDEV([Profit])',
  },
  {
    command: 'STDEVP',
    syntax: 'STDEVP(expression)',
    description:
      'Returns the population standard deviation of the expression. Example: STDEVP([Profit])',
  },
  {
    command: 'STR',
    syntax: 'STR(expression)',
    description:
      'Returns a string given an expression. Example: STR([Age]) returns all of the values of the Age measure as strings.',
  },
  {
    command: 'SUM',
    syntax: 'SUM(expression)',
    description:
      'Returns the sum of all the values in the expression. SUM can be used with numeric fields only. Null values are ignored. Example: SUM([Profit])',
  },
  {
    command: 'TAN',
    syntax: 'TAN(angle)',
    description:
      'Returns the tangent of an angle. Specify the angle in radians. Example: TAN(PI()/4) = 1.0',
  },
  {
    command: 'TODAY',
    syntax: 'TODAY()',
    description: 'Returns the current date. Example: TODAY() = 2004-05-12',
  },
  {
    command: 'TOTAL',
    syntax: 'TOTAL(expression)',
    description: 'Returns the total for the given expression. Example: TOTAL(AVG([Profit]))',
  },
  {
    command: 'TRIM',
    syntax: 'TRIM(string)',
    description:
      "Returns the string with both leading and trailing spaces removed. Example: TRIM(' Budget  ') = 'Budget'",
  },
  {
    command: 'UPPER',
    syntax: 'UPPER(string)',
    description:
      "Converts a text string to all uppercase letters. Example: UPPER('product') = 'PRODUCT'",
  },
  {
    command: 'USERDOMAIN',
    syntax: 'USERDOMAIN()',
    description:
      'Returns the domain for the current user when the user is signed on to Tableau Server. Returns the Windows domain if the Tableau Desktop user is on a domain. Otherwise this function returns a null string.',
  },
  {
    command: 'USERNAME',
    syntax: 'USERNAME()',
    description:
      'Returns the username for the current user. This is the Tableau Server or Tableau Cloud username when the user is signed in; otherwise it is the local or network username for the Tableau Desktop user.',
  },
  {
    command: 'VALIDATE',
    syntax: 'VALIDATE(spatial)',
    description:
      'Returns the given spatial if it is valid; a corrected version if it can be corrected; or null otherwise. Example: VALIDATE([spatial])',
  },
  {
    command: 'VAR',
    syntax: 'VAR(expression)',
    description: 'Returns the sample variance of the expression. Example: VAR([Profit])',
  },
  {
    command: 'VARP',
    syntax: 'VARP(expression)',
    description: 'Returns the population variance of the expression. Example: VARP([Profit])',
  },
  {
    command: 'WEEK',
    syntax: 'WEEK(date)',
    description: 'Returns the week of a given date as an integer. Example: WEEK(#2004-04-12#) = 16',
  },
  {
    command: 'YEAR',
    syntax: 'YEAR(date)',
    description:
      'Returns the year of a given date as an integer. Example: YEAR(#2004-04-12#) = 2004',
  },
  {
    command: 'ZN',
    syntax: 'ZN(expression)',
    description:
      'Returns <expression> if it is not null, otherwise returns zero. Example: ZN([Profit])',
  },
  {
    command: 'INDEX',
    syntax: 'INDEX()',
    description:
      'Returns the index of the current row in the partition. Example (for the first row in the partition): INDEX() = 1',
  },
  {
    command: 'FIRST',
    syntax: 'FIRST()',
    description:
      'Returns the number of rows from the current row to the first row in the partition. Example (current row index is 3 of 7): FIRST() = -2',
  },
  {
    command: 'LAST',
    syntax: 'LAST()',
    description:
      'Returns the number of rows from the current row to the last row in the partition. Example (current row is index 3 of 7): LAST() = 4',
  },
  {
    command: 'SIZE',
    syntax: 'SIZE()',
    description:
      'Returns the number of rows in the partition. Example (partition has 5 rows): SIZE() = 5',
  },
  {
    command: 'LOOKUP',
    syntax: 'LOOKUP(expression, [offset])',
    description:
      'Returns the value of the given expression in a target row, specified as a relative offset from the current row. Use FIRST() + n and LAST() - n for a target relative to the first/last rows in the partition. If offset is omitted, the Compare To row may be set on the field menu. Returns NULL if the target row cannot be determined. Example: LOOKUP(SUM([Profit]), FIRST() + 2)',
  },
  {
    command: 'PREVIOUS_VALUE',
    syntax: 'PREVIOUS_VALUE(expression)',
    description:
      'Returns the value of this calculation in the previous row. Returns the given expression if the current row is the first row of the partition. Example: SUM([Profit]) + PREVIOUS_VALUE(0) = running sum of Profit',
  },
  {
    command: 'WINDOW_AVG',
    syntax: 'WINDOW_AVG(expression, [start, end])',
    description:
      'Returns the average of the expression within the window. The window is defined as offsets from the current row. Use FIRST() + n and LAST() - n for offsets from the first or last row in the partition. If start and end are omitted, the entire partition is used. Example: WINDOW_AVG(SUM([Profit]), -2, 0)',
  },
  {
    command: 'WINDOW_COUNT',
    syntax: 'WINDOW_COUNT(expression, [start, end])',
    description:
      'Returns the count of the expression within the window. The window is defined as offsets from the current row. Use FIRST() + n and LAST() - n for offsets from the first or last row in the partition. If start and end are omitted, the entire partition is used. Example: WINDOW_COUNT(SUM([Profit]), -2, 0)',
  },
  {
    command: 'WINDOW_MAX',
    syntax: 'WINDOW_MAX(expression, [start, end])',
    description:
      'Returns the maximum of the expression within the window. The window is defined as offsets from the current row. Use FIRST() + n and LAST() - n for offsets from the first or last row in the partition. If start and end are omitted, the entire partition is used. Example: WINDOW_MAX(SUM([Profit]), -2, 0)',
  },
  {
    command: 'WINDOW_MEDIAN',
    syntax: 'WINDOW_MEDIAN(expression, [start, end])',
    description:
      'Returns the median of the expression within the window. The window is defined as offsets from the current row. Use FIRST() + n and LAST() - n for offsets from the first or last row in the partition. If start and end are omitted, the entire partition is used. Example: WINDOW_MEDIAN(SUM([Profit]), -2, 0)',
  },
  {
    command: 'WINDOW_MIN',
    syntax: 'WINDOW_MIN(expression, [start, end])',
    description:
      'Returns the minimum of the expression within the window. The window is defined as offsets from the current row. Use FIRST() + n and LAST() - n for offsets from the first or last row in the partition. If start and end are omitted, the entire partition is used. Example: WINDOW_MIN(SUM([Profit]), -2, 0)',
  },
  {
    command: 'WINDOW_PERCENTILE',
    syntax: 'WINDOW_PERCENTILE(expression, number, [start, end])',
    description:
      'Returns the value corresponding to the specified percentile within the window. The window is defined as offsets from the current row. Use FIRST() + n and LAST() - n for offsets from the first or last row in the partition. If start and end are omitted, the entire partition is used. Example: WINDOW_PERCENTILE(SUM([Profit]), 0.75, -2, 0)',
  },
  {
    command: 'WINDOW_STDEV',
    syntax: 'WINDOW_STDEV(expression, [start, end])',
    description:
      'Returns the sample standard deviation of the expression within the window. The window is defined as offsets from the current row. Use FIRST() + n and LAST() - n for offsets from the first or last row in the partition. If start and end are omitted, the entire partition is used. Example: WINDOW_STDEV(SUM([Profit]), -2, 0)',
  },
  {
    command: 'WINDOW_STDEVP',
    syntax: 'WINDOW_STDEVP(expression, [start, end])',
    description:
      'Returns the population standard deviation of the expression within the window. The window is defined as offsets from the current row. Use FIRST() + n and LAST() - n for offsets from the first or last row in the partition. If start and end are omitted, the entire partition is used. Example: WINDOW_STDEVP(SUM([Profit]), -2, 0)',
  },
  {
    command: 'WINDOW_SUM',
    syntax: 'WINDOW_SUM(expression, [start, end])',
    description:
      'Returns the sum of the expression within the window. The window is defined as offsets from the current row. Use FIRST() + n and LAST() - n for offsets from the first or last row in the partition. If start and end are omitted, the entire partition is used. Example: WINDOW_SUM(SUM([Profit]), -2, 0)',
  },
  {
    command: 'WINDOW_VAR',
    syntax: 'WINDOW_VAR(expression, [start, end])',
    description:
      'Returns the sample variance of the expression within the window. The window is defined as offsets from the current row. Use FIRST() + n and LAST() - n for offsets from the first or last row in the partition. If start and end are omitted, the entire partition is used. Example: WINDOW_VAR(SUM([Profit]), -2, 0)',
  },
  {
    command: 'WINDOW_VARP',
    syntax: 'WINDOW_VARP(expression, [start, end])',
    description:
      'Returns the population variance of the expression within the window. The window is defined as offsets from the current row. Use FIRST() + n and LAST() - n for offsets from the first or last row in the partition. If start and end are omitted, the entire partition is used. Example: WINDOW_VARP(SUM([Profit]), -2, 0)',
  },
  {
    command: 'WINDOW_COVAR',
    syntax: 'WINDOW_COVAR(expr1, expr2, [start, end])',
    description:
      'Returns the sample covariance of two expressions within the window. The window is defined as offsets from the current row. Use FIRST() + n and LAST() - n for offsets from the first or last row in the partition. If start and end are omitted, the entire partition is used. Example: WINDOW_COVAR(SUM([Profit]), SUM([Sales]), -2, 0)',
  },
  {
    command: 'WINDOW_COVARP',
    syntax: 'WINDOW_COVARP(expr1, expr2, [start, end])',
    description:
      'Returns the population covariance of two expressions within the window. The window is defined as offsets from the current row. Use FIRST() + n and LAST() - n for offsets from the first or last row in the partition. If start and end are omitted, the entire partition is used. Example: WINDOW_COVARP(SUM([Profit]), SUM([Sales]), -2, 0)',
  },
  {
    command: 'WINDOW_CORR',
    syntax: 'WINDOW_CORR(expr1, expr2, [start, end])',
    description:
      'Returns the Pearson correlation coefficient of two expressions within the window. The window is defined as offsets from the current row. Use FIRST() + n and LAST() - n for offsets from the first or last row in the partition. If start and end are omitted, the entire partition is used. Example: WINDOW_CORR(SUM([Profit]), SUM([Sales]), -5, 0)',
  },
  {
    command: 'RUNNING_AVG',
    syntax: 'RUNNING_AVG(expression)',
    description:
      'Returns the running average of the given expression, from the first row in the partition to the current row. Example: RUNNING_AVG(SUM([Profit]))',
  },
  {
    command: 'RUNNING_COUNT',
    syntax: 'RUNNING_COUNT(expression)',
    description:
      'Returns the running count of the given expression, from the first row in the partition to the current row. Example: RUNNING_COUNT(SUM([Profit]))',
  },
  {
    command: 'RUNNING_MAX',
    syntax: 'RUNNING_MAX(expression)',
    description:
      'Returns the running maximum of the given expression, from the first row in the partition to the current row. Example: RUNNING_MAX(SUM([Profit]))',
  },
  {
    command: 'RUNNING_MIN',
    syntax: 'RUNNING_MIN(expression)',
    description:
      'Returns the running minimum of the given expression, from the first row in the partition to the current row. Example: RUNNING_MIN(SUM([Profit]))',
  },
  {
    command: 'RUNNING_SUM',
    syntax: 'RUNNING_SUM(expression)',
    description:
      'Returns the running sum of the given expression, from the first row in the partition to the current row. Example: RUNNING_SUM(SUM([Profit]))',
  },
  {
    command: 'RANK',
    syntax: "RANK(expression, ['asc'|'desc'])",
    description:
      "Returns the standard competition rank for the current row in the partition. Identical values are assigned an identical rank. Use the optional 'asc' | 'desc' argument to specify ascending or descending order. The default order is descending. Example: RANK(AVG([Lap Time]))",
  },
  {
    command: 'RANK_DENSE',
    syntax: "RANK_DENSE(expression, ['asc'|'desc'])",
    description:
      "Returns the dense rank for the current row in the partition. Identical values are assigned an identical rank, but no gaps are inserted into the number sequence. Use the optional 'asc' | 'desc' argument to specify ascending or descending order. The default order is descending. Example: RANK_DENSE(SUM([Sales]))",
  },
  {
    command: 'RANK_MODIFIED',
    syntax: "RANK_MODIFIED(expression, ['asc'|'desc'])",
    description:
      "Returns the modified competition rank for the current row in the partition. Identical values are assigned an identical rank. Use the optional 'asc' | 'desc' argument to specify ascending or descending order. The default order is descending. Example: RANK_MODIFIED(AVG([Velocity]))",
  },
  {
    command: 'RANK_PERCENTILE',
    syntax: "RANK_PERCENTILE(expression, ['asc'|'desc'])",
    description:
      "Returns the percentile rank for the current row in the partition. Use the optional 'asc' | 'desc' argument to specify ascending or descending order. The default order is ascending. Example: RANK_PERCENTILE(AVG([Test Score]))",
  },
  {
    command: 'RANK_UNIQUE',
    syntax: "RANK_UNIQUE(expression, ['asc'|'desc'])",
    description:
      "Returns the unique rank for the current row in the partition. Identical values are assigned different ranks. Use the optional 'asc' | 'desc' argument to specify ascending or descending order. The default order is descending. Example: RANK_UNIQUE()",
  },
  {
    command: 'MODEL_PERCENTILE',
    syntax: 'MODEL_PERCENTILE(target_expression, predictor_expression(s))',
    description:
      'Returns the probability (between 0 and 1) of the expected value being less than or equal to the observed mark, defined by the target expression and other predictors. This is the Posterior Predictive Distribution Function, also known as the Cumulative Distribution Function (CDF). Example: MODEL_PERCENTILE(SUM([Sales]), COUNT([Orders]))',
  },
  {
    command: 'MODEL_QUANTILE',
    syntax: 'MODEL_QUANTILE(quantile, target_expression, predictor_expression(s))',
    description:
      'Returns a target numeric value within the probable range defined by the target expression and other predictors, at a specified quantile. This is the Posterior Predictive Quantile. Example: MODEL_QUANTILE(0.5, SUM([Sales]), COUNT([Orders]))',
  },
];

export const getGetCalculationInfoTool = (server: Server): Tool<typeof paramsSchema> => {
  const getCalculationInfoTool = new Tool({
    server,
    name: 'get-calculation-info',
    description,
    paramsSchema,
    annotations: {
      title: 'Get Calculation Info',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async (
      {
        calculationType,
        excludeFunctionsList,
        excludeCalculationStructureInfo,
        excludeExamplesForCalculationType,
      },
      { requestId, authInfo },
    ): Promise<CallToolResult> => {
      return await getCalculationInfoTool.logAndExecute({
        requestId,
        authInfo,
        args: {
          calculationType,
          excludeFunctionsList: excludeFunctionsList ?? false,
          excludeCalculationStructureInfo: excludeCalculationStructureInfo ?? false,
          excludeExamplesForCalculationType: excludeExamplesForCalculationType ?? false,
        },
        callback: async () => {
          const toReturn: Record<string, any> = {};

          switch (calculationType) {
            case 'BASIC':
              toReturn.type = 'BASIC';
              toReturn.info = basicCalculationInfo;
              if (!excludeExamplesForCalculationType) {
                toReturn.examples = basicCalculationExamples;
              }
              break;
            case 'LOD':
              toReturn.type = 'LOD';
              toReturn.info = lodCalculationInfo;
              if (!excludeExamplesForCalculationType) {
                toReturn.examples = lodCalculationExamples;
              }
              break;
            case 'TABLE':
              toReturn.type = 'TABLE';
              toReturn.info = tableCalculationInfo;
              if (!excludeExamplesForCalculationType) {
                toReturn.examples = tableCalculationExamples;
              }
              break;
          }

          if (!excludeCalculationStructureInfo) {
            toReturn.expressionStructureInfo = calculationStructureInfo;
          }
          if (!excludeFunctionsList) {
            toReturn.functions = functionsList;
          }

          return new Ok(toReturn);
        },
        constrainSuccessResult: (calculationInfo) => {
          return {
            type: 'success',
            result: calculationInfo,
          };
        },
      });
    },
  });

  return getCalculationInfoTool;
};
