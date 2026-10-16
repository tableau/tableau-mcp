import { hasPhrase, stemToken } from './searchText.js';

/**
 * User phrasing → words Exchange listings actually use. One-directional: keys are what people
 * ask for, values are catalog vocabulary. Every value was checked against the dev catalog; avoid
 * words that are only common because of a tag (for example "mapping" from "Data Mapping enabled").
 */
const RELATED_TERMS: Record<string, string[]> = {
  'flow chart': ['sankey', 'process', 'workflow', 'network', 'diagram'],
  flowchart: ['sankey', 'process', 'workflow', 'network', 'diagram'],
  'flow diagram': ['sankey', 'process', 'workflow', 'network'],
  'org chart': ['hierarchy', 'tree', 'organization'],
  orgchart: ['hierarchy', 'tree', 'organization'],
  'organizational chart': ['hierarchy', 'tree', 'organization'],
  graph: ['network', 'node', 'relationship', 'chord'],
  gantt: ['timeline', 'calendar', 'project'],
  marketing: ['campaign', 'ads', 'lead', 'email'],
  kpi: ['metric', 'scorecard', 'measure'],
  pdf: ['export'],
  writeback: ['write', 'input', 'comment'],
  'write back': ['write', 'input', 'comment'],
  geo: ['geospatial', 'geography', 'location', 'map'],
  geographic: ['geospatial', 'geography', 'location', 'map'],
  'spider chart': ['radar'],
  forecasting: ['forecast', 'predict', 'einstein'],
  prediction: ['forecast', 'predict', 'einstein'],
  predictive: ['forecast', 'predict', 'einstein'],
  finance: ['financial', 'budget', 'revenue'],
  'human resources': ['employee', 'people', 'hr'],
  churn: ['retention', 'cohort'],
};

export type RelatedTerm = { term: string; via: string };

/** Related catalog words for every map key found in the query, excluding words already queried. */
export function relatedTerms(normalizedQuery: string, queryTokens: string[]): RelatedTerm[] {
  const seen = new Set(queryTokens.map(stemToken));
  const related: RelatedTerm[] = [];
  for (const [via, terms] of Object.entries(RELATED_TERMS)) {
    if (!hasPhrase(normalizedQuery, via)) continue;
    for (const term of terms) {
      const stem = stemToken(term);
      if (seen.has(stem)) continue;
      seen.add(stem);
      related.push({ term, via });
    }
  }
  return related;
}
