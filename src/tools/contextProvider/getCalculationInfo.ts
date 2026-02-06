import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { Server } from '../../server.js';
import { Tool } from '../tool.js';

const paramsSchema = {
  calculationType: z.enum(['BASIC', 'LOD', 'TABLE']).optional(),
  includeFunctionInfo: z.boolean().default(true).optional(),
  includeOperatorPrecedenceInfo: z.boolean().default(true).optional(),
};

const description = `
This tool retrieves relevant information for constructing Tableau calculations.
Provides details on how to construct a calculation given its type and which functions are available for use.
Before you can determine whether or not you want to construct a calculation make sure to understand available fields and their types.

When should you use this tool?
  - A user explicity requests a calculation to be constructed and information is needed for the given calculation type.
  - When you need to construct a calculation as part of a query and information is needed for the given calculation type.

When do you need to construct a calculation?
  - To segment data
  - To convert the data type of a field, such as converting string to date
  - To aggregate data
  - To filter results
  - To calculate ratios
  - When the data you need for analysis is not present in the data source
  - When you want to transform values in your visualization
  - When you want to quickly categorize data

When should you not construct a calculation?
- If a user request can be answered with an already existing field or by aggregating an existing field.

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
    callback: ({ calculationType, includeFunctionInfo = true }): CallToolResult => {
      if (includeFunctionInfo) {
        // TODO: get function info
      }

      return {
        content: [
          {
            type: 'text',
            text: calculationType,
          },
        ],
      };
    },
  });

  return getCalculationInfoTool;
};

const basicCalculationExamples = `
Example calculations and what they do:

`;

const lodCalculationExamples = `
Example calculations and what they do:

`;

const lodCalculationInfo = `
LOD calculations compute values at the data source level and the visualization level, at a more granular level (INCLUDE), a less granular level (EXCLUDE), or an entirely independent level of detail (FIXED).

LOD syntax: { [FIXED | INCLUDE | EXCLUDE] <dimension declaration> : <aggregate expression> }

FIXED:
- computes values using the specified dimensions without reference to the view level of detail.
- ignores all the filters in the view other than context filters, data source filters, and extract filters.
- Exmaple: { FIXED [Region] : SUM([Sales]) } computes the sum of Sales per region.

INCLUDE:
- computes values using the specified dimensions in addition to whatever dimensions are in the view.
- are more useful when including dimensions that are not in the view.
- Example: { INCLUDE [Customer Name] : SUM([Sales]) } computes the total sales

EXCLUDE:
- explicitly remove dimensions from the expression and are more useful when excluding dimensions that are in the view.
- Example: { EXCLUDE [Region]: SUM([Sales]) }

<dimension declaration>:
- Specifies one or more dimensions that set the scope of the aggregate expression, according to the keyword. Use commas to separate multiple dimensions.
- Example: [Name] or [Segment], [Category], [Region]
- You can use any expression that evaluates as dimension, including Date expressions.
- Example: {FIXED YEAR([Order Date]) : SUM([Sales])} aggregates the sum of Sales at the Year level.

<aggregate expression>:
- The aggregate expression is the calculation that is performed.
`;

const tableCalculationInfo = `
TODO
`;

const calculationStructureInfo = `
Calculations are composed of the following components:
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
