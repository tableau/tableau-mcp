export const queryDatasourceToolDescription20261 = `# Query Tableau Data Source Tool

Executes VizQL queries against Tableau data sources to answer business questions from published data. This tool allows you to retrieve aggregated and filtered data with proper sorting and grouping.

## Prerequisites
Before using this tool, you should:
1. Understand available fields and their types
2. Understand what parameters are available and their types
3. Understand the data structure and field relationships

## Best Practices

### Data Volume Management
- **Always prefer aggregation** - Use aggregated fields (SUM, COUNT, AVG, etc.) instead of raw row-level data to reduce response size
- **Profile data before querying** - When unsure about data volume, first run a COUNT query to understand the scale:
  \`\`\`json
  {
    "fields": [
      {
        "fieldCaption": "Order ID",
        "function": "COUNT",
        "fieldAlias": "Total Records"
      }
    ]
  }
  \`\`\`
- **Use TOP filters for rankings** - When users ask for "top N" results, use TOP filter type to limit results at the database level
- **Use table calculations for ranks and running totals** - When users want a rank, running total, or share of total next to each row, use a table calculation field
- **Apply restrictive filters** - Use SET, QUANTITATIVE, or DATE filters to reduce data volume before processing
- **Avoid row-level queries when possible** - Only retrieve individual records when specifically requested and the business need is clear

### Field Usage Guidelines
- **Prefer existing fields** - Use fields already modeled in the data source rather than creating custom calculations
- **Use bins for distribution analysis** - Create bins to group continuous data into discrete ranges (e.g., age groups, price ranges)
- **Validate field availability** - Always check field metadata before constructing queries

### Field Types

#### Dimension Fields
Basic fields without aggregation:
\`\`\`json
{
  "fieldCaption": "Category",
  "fieldAlias": "Product Category"
}
\`\`\`

#### Measure Fields
Fields with aggregation functions (SUM, AVG, COUNT, etc.):
\`\`\`json
{
  "fieldCaption": "Sales",
  "function": "SUM",
  "fieldAlias": "Total Sales",
  "maxDecimalPlaces": 2
}
\`\`\`

#### Calculated Fields
Custom fields defined using Tableau calculation syntax:
\`\`\`json
{
  "fieldCaption": "Profit Margin",
  "calculation": "SUM([Profit]) / SUM([Sales])",
  "fieldAlias": "Margin %"
}
\`\`\`

#### Bin Fields
Group continuous data into discrete ranges:
\`\`\`json
{
  "fieldCaption": "Sales",
  "binSize": 1000,
  "fieldAlias": "Sales Range"
}
\`\`\`
This creates bins of $1,000 intervals (0-1000, 1000-2000, etc.)

#### Table Calculation Fields
Compute over the query result, such as rank, running total, or percent of total. Add a \`tableCalculation\` to a measure field. See Table Calculations below.
\`\`\`json
{
  "fieldCaption": "Sales",
  "function": "SUM",
  "fieldAlias": "Sales Rank",
  "tableCalculation": { "tableCalcType": "RANK", "dimensions": [{ "fieldCaption": "Category" }] }
}
\`\`\`

### Query Construction
- **Group by meaningful dimensions** - Ensure grouping supports the business question being asked
- **Order results logically** - Use sortDirection and sortPriority to present data in a meaningful way
- **Use appropriate date functions** - Choose the right date aggregation (YEAR, QUARTER, MONTH, WEEK, DAY, or TRUNC_* variants)
- **Leverage filter capabilities** - Use the extensive filter options to narrow results

## Data Profiling Strategy

When a query might return large amounts of data, follow this profiling approach:

**Step 1: Count total records**
\`\`\`json
{
  "fields": [
    {
      "fieldCaption": "Primary_Key_Field",
      "function": "COUNT",
      "fieldAlias": "Total Records"
    }
  ]
}
\`\`\`

**Step 2: Count by key dimensions**
\`\`\`json
{
  "fields": [
    {
      "fieldCaption": "Category",
      "fieldAlias": "Category"
    },
    {
      "fieldCaption": "Order ID",
      "function": "COUNT",
      "fieldAlias": "Record Count"
    }
  ]
}
\`\`\`

**Step 3: Apply appropriate aggregation or filtering based on counts**

## Parameters

Parameters are dynamic values defined in the Tableau datasource that can be used to control calculations, filters, and query behavior. They allow for interactive, user-controlled queries without modifying the query structure.

### When to Use Parameters
- **Dynamic filtering** - Let users control date ranges, regions, or categories
- **What-if analysis** - Adjust values like growth rates, targets, or thresholds
- **Calculation control** - Switch between different metrics or calculation methods
- **User preferences** - Currency selection, display units, or other settings

### Parameter Types
- **LIST** - Predefined values (e.g., regions, categories)
- **ANY_VALUE** - Free-form values matching data type
- **QUANTITATIVE_RANGE** - Numeric values with optional min/max/step
- **QUANTITATIVE_DATE** - Date values with optional range constraints

### Usage Example
\`\`\`json
{
  "datasourceLuid": "abc123",
  "query": {
    "fields": [...],
    "filters": [...],
    "parameters": [
      {
        "name": "Selected Year",
        "value": 2024
      },
      {
        "name": "Currency",
        "value": "USD"
      }
    ]
  }
}
\`\`\`

- Parameters affect entire query; filters restrict returned data

## Bins

Bins group continuous numerical data into discrete ranges, enabling distribution analysis and histogram creation. Unlike parameters and filters, bins are created dynamically in the query.

### Creating Bin Fields

To create a bin field in a query, you **must** include:
1. A **measure field** with the base field and aggregation function
2. A **bin field** with the same fieldCaption and a binSize property

**Example:**
\`\`\`json
{
  "fields": [
    {
      "fieldCaption": "Sales",
      "function": "SUM",
      "fieldAlias": "Total Sales"
    },
    {
      "fieldCaption": "Sales",
      "binSize": 1000,
      "fieldAlias": "Sales Range"
    }
  ]
}
\`\`\`

This creates bins of $1,000 intervals (0-1000, 1000-2000, etc.)

### When to Use Bins
- Analyzing distribution patterns (age groups, price ranges, score brackets)
- Creating histograms or frequency distributions
- Grouping continuous numerical data into meaningful categories
- User asks questions like "How many customers in each age range?" or "What's the distribution of order sizes?"

### Bin Restrictions
- **Cannot override existing bin fields** - If a bin field already exists in the datasource, query it without binSize
- **binSize must be positive** - Only values > 0 are allowed
- **Measure fields only** - Can only bin numeric/quantitative fields
- **Choose appropriate bin sizes** - Consider your data range (e.g., bin size 100 for values 0-10,000)

### Querying Existing Bin Fields

If a bin field already exists in the datasource (e.g., "Profit (bin)"), query it as a regular dimension field:

\`\`\`json
{
  "fields": [
    {
      "fieldCaption": "Profit (bin)"
    },
    {
      "fieldCaption": "Profit",
      "function": "SUM"
    }
  ]
}
\`\`\`

To control existing bin field behavior, use parameters if available (e.g., "Profit Bin Size").

## Table Calculations

Table calculations compute over the query result, after aggregation and filtering. Use them for ranks, running totals, moving averages, percent of total, and period-over-period change.

### Creating Table Calculation Fields
A table calculation field is a measure field (\`fieldCaption\` and \`function\`) plus a \`tableCalculation\`:
- **\`tableCalcType\`** - The kind of calculation (see the types below)
- **\`dimensions\`** - The dimensions the calculation computes along, e.g. \`[{ "fieldCaption": "Order Date", "function": "YEAR" }]\`. Each must also be a field in the query. Query dimensions not listed split the calculation, so it restarts for each of their values
- **Always set \`fieldAlias\`** - Without one, the output column gets a generated name such as "Rank Sales"
- To show the plain measure too, add it as a separate field with the same \`fieldCaption\` and a different \`fieldAlias\`

**Example: Rank categories by sales**
\`\`\`json
{
  "fields": [
    { "fieldCaption": "Category" },
    { "fieldCaption": "Sales", "function": "SUM", "fieldAlias": "Sales" },
    {
      "fieldCaption": "Sales",
      "function": "SUM",
      "fieldAlias": "Sales Rank",
      "tableCalculation": { "tableCalcType": "RANK", "dimensions": [{ "fieldCaption": "Category" }] }
    }
  ]
}
\`\`\`

### Table Calculation Types
- **RANK** - Rank of each value. Optional \`rankType\` (COMPETITION, MODIFIED COMPETITION, DENSE, UNIQUE) and \`direction\` (ASC or DESC)
- **PERCENTILE** - Percentile of each value. Optional \`direction\`
- **RUNNING_TOTAL** - Cumulative value. Optional \`aggregation\` (SUM, AVG, MIN, MAX) and \`restartEvery\` (a dimension to restart at)
- **MOVING_CALCULATION** - Aggregate over a sliding window. Optional \`aggregation\`, \`previous\`, \`next\`, \`includeCurrent\`, and \`fillInNull\`
- **PERCENT_OF_TOTAL** - Share of the total, as a fraction (0.25 means 25%)
- **DIFFERENCE_FROM**, **PERCENT_DIFFERENCE_FROM**, **PERCENT_FROM** - Compare each value with another. \`relativeTo\` is PREVIOUS, NEXT, FIRST, or LAST. Percent results are fractions, and values with nothing to compare against (e.g. the first year for PREVIOUS) are null. Use PERCENT_DIFFERENCE_FROM with PREVIOUS for year-over-year growth
- **CUSTOM** - Use with a \`calculation\` written with table calculation functions such as RANK, RUNNING_SUM, WINDOW_AVG, or LOOKUP, or to query a table calculation field defined in the data source (\`columnClass\` TABLE_CALCULATION in the metadata) by its \`fieldCaption\` alone

**Example: 3-year moving average**
\`\`\`json
{
  "fieldCaption": "Sales",
  "function": "SUM",
  "fieldAlias": "3-Year Moving Avg",
  "tableCalculation": {
    "tableCalcType": "MOVING_CALCULATION",
    "dimensions": [{ "fieldCaption": "Order Date", "function": "YEAR" }],
    "aggregation": "AVG",
    "previous": 2,
    "next": 0,
    "includeCurrent": true
  }
}
\`\`\`
\`previous\` and \`next\` are non-negative counts of values before and after the current one.

### Custom Table Calculations
With a \`calculation\`, set \`tableCalcType\` to CUSTOM, give the field a new \`fieldCaption\`, and omit \`function\`:
\`\`\`json
{
  "fieldCaption": "Sales Rank",
  "calculation": "RANK(SUM([Sales]))",
  "fieldAlias": "Sales Rank",
  "tableCalculation": { "tableCalcType": "CUSTOM", "dimensions": [{ "fieldCaption": "Category" }] }
}
\`\`\`

### Secondary Calculations
RUNNING_TOTAL and MOVING_CALCULATION accept a \`secondaryTableCalculation\` that applies to their result, e.g. the percent of total of a running sum. The secondary must be DIFFERENCE_FROM, PERCENT_DIFFERENCE_FROM, PERCENT_FROM, PERCENT_OF_TOTAL, RANK, or PERCENTILE, and can't have its own secondary.

### Table Calculation Restrictions
- **A \`calculation\` requires CUSTOM** - Other types use \`fieldCaption\` and \`function\`
- **NESTED and \`nestedTableCalculations\` are for data source table calculations** - Use them only when a data source table calculation references another table calculation. Prefer the other types otherwise

## Filter Types and Usage
### Filter Context Property
All filters support an optional \`context\` property (boolean) that controls how filters are applied:
- **\`context: true\`** - Filter applies to the overall query context (dimension/scope filters)
- **\`context: false\`** - Filter applies after context is established (ranking/limiting filters)

**When to use:**
- Set \`context: true\` on dimension filters (SET, DATE, QUANTITATIVE) that define the scope of analysis
- Set \`context: false\` on TOP and CONDITION filters to rank/limit results within the established context
- Omit \`context\` property for simple queries with single filters

**Example: Finding top products within a region:**
\`\`\`json
{
  "filters": [
    {
      "field": { "fieldCaption": "State" },
      "filterType": "SET",
      "values": ["California"],
      "context": true  // Establish California as the context
    },
    {
      "field": { "fieldCaption": "Product Name" },
      "filterType": "TOP",
      "howMany": 1,
      "direction": "TOP",
      "context": false,  // Find top product within California
      "fieldToMeasure": { "fieldCaption": "Sales", "function": "SUM" }
    }
  ]
}
\`\`\`

### SET Filters
Filter by specific values:
\`\`\`json
{
  "field": {"fieldCaption": "Region"},
  "filterType": "SET",
  "values": ["North", "South", "East"],
  "exclude": false
}
\`\`\`
Values can mix types and include \`null\` to match null values.

### MATCH Filters
Filter strings using patterns:
\`\`\`json
{
  "field": {"fieldCaption": "City"},
  "filterType": "MATCH",
  "startsWith": "San"
}
\`\`\`

### TOP Filters
Get top/bottom N records by a measure:
\`\`\`json
{
  "field": {"fieldCaption": "Customer Name"},
  "filterType": "TOP",
  "howMany": 10,
  "direction": "TOP",
  "fieldToMeasure": {"fieldCaption": "Sales", "function": "SUM"}
}
\`\`\`

### CONDITION Filters
Keep dimension values whose aggregate meets a condition, e.g. customers with more than $1,000 in sales. Provide exactly one of \`condition\` or \`calculation\`:
\`\`\`json
{
  "field": {"fieldCaption": "Customer Name"},
  "filterType": "CONDITION",
  "condition": {"fieldCaption": "Sales", "function": "SUM", "comparison": ">", "value": 1000}
}
\`\`\`
\`comparison\` is one of =, <>, <, <=, >, >=. For logic a single comparison can't express, use a boolean \`calculation\`:
\`\`\`json
{
  "field": {"fieldCaption": "Customer Name"},
  "filterType": "CONDITION",
  "calculation": "SUM([Sales]) > 1000 AND SUM([Profit]) < 0"
}
\`\`\`
Like TOP filters, CONDITION filters run before regular dimension filters, so the condition is tested against the full data. To test it within a subset, set \`context: true\` on the filters that define the subset.

### QUANTITATIVE Filters
Filter numeric ranges:
\`\`\`json
{
  "field": {"fieldCaption": "Sales"},
  "filterType": "QUANTITATIVE_NUMERICAL",
  "quantitativeFilterType": "RANGE",
  "min": 1000,
  "max": 50000,
  "includeNulls": false
}
\`\`\`

### DATE Filters
Filter relative date periods:
\`\`\`json
{
  "field": {"fieldCaption": "Order Date"},
  "filterType": "DATE",
  "periodType": "MONTHS",
  "dateRangeType": "LAST"
}
\`\`\`

## Limitations
- **QUANTITATIVE_NUMERICAL min/max operators are inclusive** - For strictly greater-than or less-than logic, use a small offset (for example, min: 10.01 for > 10, or max: 9.99 for < 10).
- **MATCH filters cannot apply functions to a field** - Unlike all other filters, which can filter on fields with functions applied to them, MATCH filters can only filter by field name or ad hoc calculations.

## Example Queries

### Example 1: Data Profiling Before Large Query
**Question:** "Show me all customer orders this year"

**Step 1 - Profile the data volume:**
\`\`\`json
{
  "datasourceLuid": "abc123",
  "query": {
    "fields": [
      {
        "fieldCaption": "Order ID",
        "function": "COUNT",
        "fieldAlias": "Total Orders This Year"
      }
    ],
    "filters": [
      {
        "field": {"fieldCaption": "Order Date"},
        "filterType": "DATE",
        "periodType": "YEARS",
        "dateRangeType": "CURRENT"
      }
    ]
  }
}
\`\`\`

**If count is manageable (< 10,000), proceed with detail query. If large, suggest aggregation:**
\`\`\`json
{
  "datasourceLuid": "abc123",
  "query": {
    "fields": [
      {
        "fieldCaption": "Customer Name"
      },
      {
        "fieldCaption": "Order Date",
        "function": "TRUNC_MONTH",
        "sortDirection": "DESC",
        "sortPriority": 1
      },
      {
        "fieldCaption": "Sales",
        "function": "SUM",
        "fieldAlias": "Monthly Sales"
      }
    ],
    "filters": [
      {
        "field": {"fieldCaption": "Order Date"},
        "filterType": "DATE",
        "periodType": "YEARS",
        "dateRangeType": "CURRENT"
      }
    ]
  }
}
\`\`\`

### Example 2: Top Customers Query (Using TOP Filter)
**Question:** "Who are our top 10 customers by revenue?"

\`\`\`json
{
  "datasourceLuid": "abc123",
  "query": {
    "fields": [
      {
        "fieldCaption": "Customer Name"
      },
      {
        "fieldCaption": "Sales",
        "function": "SUM",
        "fieldAlias": "Total Revenue",
        "sortDirection": "DESC",
        "sortPriority": 1
      }
    ],
    "filters": [
      {
        "field": {"fieldCaption": "Customer Name"},
        "filterType": "TOP",
        "howMany": 10,
        "direction": "TOP",
        "fieldToMeasure": {"fieldCaption": "Sales", "function": "SUM"}
      }
    ]
  }
}
\`\`\`

### Example 3: Top N Dimension Query (Using TOP Filter and context property)
**Question:** "What is the top selling product in California?"
\`\`\`json
{
  "datasourceLuid": "abc123",
    "query": {
    "fields": [
      {
        "fieldCaption": "Product Name"
      },
      {
        "fieldCaption": "Sales",
        "function": "SUM",
        "fieldAlias": "Total Sales",
        "sortDirection": "DESC",
        "sortPriority": 1
      }
    ],
      "filters": [
        {
          "field": { "fieldCaption": "State" },
          "filterType": "SET",
          "values": ["California"],
          "context": true
        },
        {
          "field": { "fieldCaption": "Product Name" },
          "filterType": "TOP",
          "howMany": 1,
          "direction": "TOP",
          "context": false,
          "fieldToMeasure": { "fieldCaption": "Sales", "function": "SUM" }
        }
      ]
  }
}
\`\`\`

### Example 4: Time Series with Aggregation
**Question:** "What are our monthly sales trends?"

\`\`\`json
{
  "datasourceLuid": "abc123",
  "query": {
    "fields": [
      {
        "fieldCaption": "Order Date",
        "function": "TRUNC_MONTH",
        "fieldAlias": "Month",
        "sortDirection": "ASC",
        "sortPriority": 1
      },
      {
        "fieldCaption": "Sales",
        "function": "SUM",
        "fieldAlias": "Monthly Sales"
      },
      {
        "fieldCaption": "Order ID",
        "function": "COUNT",
        "fieldAlias": "Order Count"
      }
    ]
  }
}
\`\`\`

### Example 5: Filtered Category Analysis
**Question:** "What's the performance by product category for high-value orders?"

\`\`\`json
{
  "datasourceLuid": "abc123",
  "query": {
    "fields": [
      {
        "fieldCaption": "Category"
      },
      {
        "fieldCaption": "Sales",
        "function": "SUM",
        "fieldAlias": "Total Sales"
      },
      {
        "fieldCaption": "Sales",
        "function": "AVG",
        "fieldAlias": "Average Order Value",
        "maxDecimalPlaces": 2
      },
      {
        "fieldCaption": "Order ID",
        "function": "COUNT",
        "fieldAlias": "Order Count"
      }
    ],
    "filters": [
      {
        "field": {"fieldCaption": "Sales"},
        "filterType": "QUANTITATIVE_NUMERICAL",
        "quantitativeFilterType": "MIN",
        "min": 500
      }
    ]
  }
}
\`\`\`

### Example 6: Distribution Analysis Using Bins
**Question:** "How are our sales distributed across different price ranges?"

\`\`\`json
{
  "datasourceLuid": "abc123",
  "query": {
    "fields": [
      {
        "fieldCaption": "Sales",
        "binSize": 1000,
        "fieldAlias": "Sales Range",
        "sortDirection": "ASC",
        "sortPriority": 1
      },
      {
        "fieldCaption": "Order ID",
        "function": "COUNT",
        "fieldAlias": "Number of Orders"
      },
      {
        "fieldCaption": "Sales",
        "function": "SUM",
        "fieldAlias": "Total Sales in Range"
      }
    ]
  }
}
\`\`\`

### Example 7: Using Parameters for Dynamic Analysis
**Question:** "Show me sales for the selected region and year"

\`\`\`json
{
  "datasourceLuid": "abc123",
  "query": {
    "fields": [
      {
        "fieldCaption": "Category"
      },
      {
        "fieldCaption": "Sales",
        "function": "SUM",
        "fieldAlias": "Total Sales",
        "sortDirection": "DESC",
        "sortPriority": 1
      }
    ],
    "parameters": [
      {
        "name": "Selected Region",
        "value": "West"
      },
      {
        "name": "Analysis Year",
        "value": 2024
      }
    ]
  }
}
\`\`\`

## Calculations

**Create calculations when you need to:**
- Segment data in ways not captured by existing fields
- Convert data types (e.g., string to date)
- Aggregate data with custom logic beyond standard functions
- Filter results based on computed conditions
- Calculate ratios or derived metrics
- Perform analysis and the required data is not present in any existing field
- Transform values during visualization
- Quickly categorize data into custom groups

**Avoid calculations if you can achieve the same result by:**
- Applying standard aggregation functions (SUM, AVG, COUNT, etc.) to existing fields
- Combining existing fields and filters together

Note: Calculated Fields created as part of a query cannot be referenced in other calculations or filters.

## Error Prevention and Data Management

**When to profile data first:**
- User asks for "all records" or similar broad requests
- Query involves high-cardinality fields without filters
- Request could potentially return row-level data for large tables

**Suggest aggregation when:**
- Profile queries return very high counts (> 10,000 records)
- User asks questions that can be answered with summaries
- Performance or response size might be an issue

**Don't call this tool if:**
- The requested fields are not available in the data source
- The question requires data not present in the current data source
- Field validation shows incompatible field types for the requested operation

**Instead:**
- Use metadata tools to understand available fields
- Suggest alternative questions that can be answered with available data
- Recommend appropriate aggregation levels for the business question`;
