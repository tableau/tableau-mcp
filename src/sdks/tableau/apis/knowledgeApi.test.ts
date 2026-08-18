import { describe, expect, it } from 'vitest';

import { suggestionReportSchema } from './knowledgeApi.js';

const suggestion = {
  id: 'suggestion-1',
  type: 'missing-description',
  category: 'metadata',
  topic: 'Metadata Insights',
  title: 'Add a description',
  detail: 'The field has no description.',
  recommended_action: 'Document the field.',
  severity: 'high',
  target_ids: ['field-1'],
  metadata: { field_name: 'Revenue' },
};

const report = {
  health_score: 75,
  stats: {
    total_nodes: 10,
    total_relationships: 7,
    connected_sources: 2,
    workbooks: 1,
    context_coverage: 0.6,
  },
  metrics: [{ category: 'metadata', label: 'Descriptions', total: 4, passing: 3, coverage: 0.75 }],
  suggestions: [suggestion],
  categories: [{ category: 'metadata', count: 1, severity: 'high', suggestions: [suggestion] }],
  topics: [
    {
      topic: 'Metadata Insights',
      count: 1,
      severity: 'high',
      categories: [{ category: 'metadata', count: 1, severity: 'high', suggestions: [suggestion] }],
    },
  ],
  summary: {
    total: 1,
    by_severity: { high: 1 },
    by_type: { 'missing-description': 1 },
    by_category: { metadata: 1 },
    by_topic: { 'Metadata Insights': 1 },
    errors: 1,
  },
  errors: [{ type: 'rule-failure', message: 'One rule could not run.' }],
};

describe('suggestionReportSchema', () => {
  it('parses a complete SuggestionReport without dropping transitive fields', () => {
    expect(suggestionReportSchema.parse(report)).toEqual(report);
  });

  it.each(['stats', 'metrics', 'suggestions', 'categories', 'topics', 'summary', 'errors'])(
    'rejects a report missing required %s',
    (field) => {
      const malformed = { ...report };
      delete malformed[field as keyof typeof malformed];
      expect(suggestionReportSchema.safeParse(malformed).success).toBe(false);
    },
  );
});
