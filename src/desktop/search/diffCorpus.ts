export interface CorpusExample {
  id: string;
  title: string;
  description: string;
  user_input: string;
  tags: string[];
  complexity: string;
  diff_lines: number;
  timestamp: string;
  diff: string;
  scope?: string;
  affected_sheet?: string;
  worksheet_diff?: string;
  worksheet_diff_lines?: number;
  dashboard_diff?: string;
  dashboard_diff_lines?: number;
}

export interface Corpus {
  version: string;
  description: string;
  example_count: number;
  examples: CorpusExample[];
}

export function searchDiffCorpusFormatted(
  corpus: Corpus | null,
  query: string,
  max_results: number,
): { text: string; isError?: boolean } {
  if (!corpus) {
    return {
      text: 'Example corpus is not available. The corpus.json file could not be loaded.',
      isError: true,
    };
  }

  // An empty query would match every example via includes(''); treat it as no
  // search rather than returning the entire corpus.
  const lowerQuery = query.trim().toLowerCase();
  if (lowerQuery === '') {
    return {
      text: 'Please provide a non-empty query describing the operation you want examples for (e.g., "add filter", "create dashboard", "bar chart").',
      isError: true,
    };
  }

  const matches = corpus.examples.filter((ex) => {
    const textMatch =
      ex.title.toLowerCase().includes(lowerQuery) ||
      ex.description.toLowerCase().includes(lowerQuery) ||
      ex.user_input.toLowerCase().includes(lowerQuery);
    const tagMatch = ex.tags.some((tag) => lowerQuery.includes(tag) || tag.includes(lowerQuery));
    return textMatch || tagMatch;
  });

  const limitedMatches = matches.slice(0, max_results);

  if (limitedMatches.length === 0) {
    return {
      text: `No examples found for "${query}".

Try searching for operations like:
- worksheet, sheet, dashboard
- field, dimension, measure, calculated field
- filter, sort, hierarchy
- chart types: bar, line, pie, map, treemap
- view operations: add, remove, color, size
- layout: position, zoom, reposition`,
    };
  }

  const formattedExamples = limitedMatches
    .map((ex, idx) => {
      let diffToShow = ex.diff;
      let diffLines = ex.diff_lines;
      let scopeInfo = '';

      if (ex.scope === 'worksheet' && ex.worksheet_diff && ex.affected_sheet) {
        diffToShow = ex.worksheet_diff;
        diffLines = ex.worksheet_diff_lines || diffLines;
        scopeInfo = `\n**Scope:** Worksheet-level change (${ex.affected_sheet})`;
      } else if (ex.scope === 'dashboard' && ex.dashboard_diff && ex.affected_sheet) {
        diffToShow = ex.dashboard_diff;
        diffLines = ex.dashboard_diff_lines || diffLines;
        scopeInfo = `\n**Scope:** Dashboard-level change (${ex.affected_sheet})`;
      } else if (ex.scope === 'workbook') {
        scopeInfo = '\n**Scope:** Full workbook change';
      }

      return `
## Example ${idx + 1}: ${ex.title}

**Description:** ${ex.description}
**Complexity:** ${ex.complexity} (${diffLines} lines changed)${scopeInfo}
**Tags:** ${ex.tags.join(', ') || 'none'}

**XML Diff:**
\`\`\`diff
${diffToShow}
\`\`\`
${
  ex.scope !== 'workbook' && (ex.worksheet_diff || ex.dashboard_diff)
    ? `\n💡 **Tip:** This is a ${ex.scope}-level diff showing only the changed ${ex.scope}. Use tableau-get-${ex.scope}/tableau-apply-${ex.scope} (file-based) for focused edits, or tableau-get-workbook/tableau-apply-workbook for full workbook changes.`
    : ''
}`;
    })
    .join('\n---\n');

  const more =
    matches.length > max_results
      ? `\n(${matches.length - max_results} more examples available. Increase max_results to see more.)`
      : '';

  return {
    text: `Found ${matches.length} example(s) matching "${query}". Showing top ${limitedMatches.length}:

${formattedExamples}
${more}`,
  };
}
