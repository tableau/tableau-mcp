export const genericFilterDescription = `**Supported Operators**
  - \`eq\`: equals
  - \`gt\`: greater than
  - \`gte\`: greater than or equal
  - \`in\`: any of [list] (for searching tags)
  - \`lt\`: less than
  - \`lte\`: less than or equal
  
  **Filter Expression Notes**
  - Filter expressions can't contain ampersand (&) or comma (,) characters even if those characters are encoded.
  - Operators are delimited with colons (:). For example: \`filter=name:eq:Project Views\`
  - Field names, operator names, and values are case-sensitive.
  - To filter on multiple fields, combine expressions using a comma:  \`filter=lastLogin:gte:2016-01-01T00:00:00Z,siteRole:eq:Publisher\`
  - Multiple expressions are combined using a logical AND.
  - If you include the same field multiple times, only the last reference is used.
  - For date-time values, use ISO 8601 format (e.g., \`2016-05-04T21:24:49Z\`).
  - Wildcard searches (starts with, ends with, contains) are supported in recent Tableau versions:
    - Starts with: \`?filter=name:eq:mark*\`
    - Ends with: \`?filter=name:eq:*-ample\`
    - Contains: \`?filter=name:eq:mark*ex*\``;
