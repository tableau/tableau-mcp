export const queryDatasourceToolDescription = `# Query Tableau Data Source Tool

Executes VizQL queries against Tableau data sources to answer business questions from published data. This tool allows you to retrieve aggregated and filtered data with proper sorting and grouping.

## Prerequisites
Before using this tool, you should:
1. Understand available fields and their types
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
- **Apply restrictive filters** - Use SET, QUANTITATIVE, or DATE filters to reduce data volume before processing
- **Avoid row-level queries when possible** - Only retrieve individual records when specifically requested and the business need is clear

### Field Usage Guidelines
- **Prefer existing fields** - Use fields already modeled in the data source rather than creating custom calculations
- **Use calculations sparingly** - Only create calculated fields when absolutely necessary and the calculation cannot be achieved through existing fields and aggregations
- **Validate field availability** - Always check field metadata before constructing queries

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

### Example 3: Time Series with Aggregation
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

### Example 4: Filtered Category Analysis
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
