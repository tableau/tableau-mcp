export const queryDatasourceToolDescription = `# Query Tableau Data Source Tool

Executes VizQL queries against Tableau data sources to answer business questions from published data. This tool allows you to retrieve aggregated and filtered data with proper sorting and grouping.

## Prerequisites
Before using this tool, you should:
1. Understand available fields and their types
2. Understand the data structure and field relationships

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
- **Apply restrictive filters** - Use SET, QUANTITATIVE, or DATE filters to reduce data volume before processing
- **Avoid row-level queries when possible** - Only retrieve individual records when specifically requested and the business need is clear

### Field Usage Guidelines
- **Prefer existing fields** - Use fields already modeled in the data source rather than creating custom calculations
- **Validate field availability** - Always check field metadata before constructing queries

### Calculation Usage Guidelines

**Create calculations when you need to:**
- Segment data in ways not captured by existing fields
- Convert data types (e.g., string to date)
- Aggregate data with custom logic beyond standard functions
- Filter results based on computed conditions (only available with QUANTITATIVE and TOP filters)
- Calculate ratios or derived metrics
- Perform analysis and the required data is not present in any existing field
- Transform values during visualization
- Quickly categorize data into custom groups

**Avoid calculations if you can achieve the same result by:**
- Applying standard aggregation functions (SUM, AVG, COUNT, etc.) to existing fields
- Combining existing fields and filters together

Note: Calculated Fields created as part of a query cannot be referenced in other calculations or filters.

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

## Filter Types and Usage
### Filter Context Property
All filters support an optional \`context\` property (boolean) that controls how filters are applied:
- **\`context: true\`** - Filter applies to the overall query context (dimension/scope filters)
- **\`context: false\`** - Filter applies after context is established (ranking/limiting filters)

**When to use:**
- Set \`context: true\` on dimension filters (SET, DATE, QUANTITATIVE) that define the scope of analysis
- Set \`context: false\` on TOP filters to rank/limit results within the established context
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
