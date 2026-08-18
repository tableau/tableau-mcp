import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

const severitySchema = z.enum(['high', 'medium', 'low']);

const suggestionSchema = z.object({
  id: z.string(),
  type: z.string(),
  category: z.string(),
  topic: z.string(),
  title: z.string(),
  detail: z.string(),
  recommended_action: z.string(),
  severity: severitySchema,
  target_ids: z.array(z.string()),
  metadata: z.record(z.unknown()),
});

const categoryGroupSchema = z.object({
  category: z.string(),
  count: z.number().int(),
  severity: severitySchema,
  suggestions: z.array(suggestionSchema),
});

export const suggestionReportSchema = z.object({
  health_score: z.number().int().nullable().optional(),
  stats: z.object({
    total_nodes: z.number().int(),
    total_relationships: z.number().int(),
    connected_sources: z.number().int(),
    workbooks: z.number().int(),
    context_coverage: z.number().nullable().optional(),
  }),
  metrics: z.array(
    z.object({
      category: z.string(),
      label: z.string(),
      total: z.number().int(),
      passing: z.number().int(),
      coverage: z.number().nullable().optional(),
    }),
  ),
  suggestions: z.array(suggestionSchema),
  categories: z.array(categoryGroupSchema),
  topics: z.array(
    z.object({
      topic: z.string(),
      count: z.number().int(),
      severity: severitySchema,
      categories: z.array(categoryGroupSchema),
    }),
  ),
  summary: z.object({
    total: z.number().int(),
    by_severity: z.record(z.number().int()),
    by_type: z.record(z.number().int()),
    by_category: z.record(z.number().int()),
    by_topic: z.record(z.number().int()),
    errors: z.number().int(),
  }),
  errors: z.array(z.object({ type: z.string(), message: z.string() })),
});

const searchSuggestionsEndpoint = makeEndpoint({
  method: 'post',
  path: '/graphs/:graph_id/suggestions/search',
  alias: 'searchSuggestions',
  description: 'Returns a graph-health suggestions report.',
  parameters: [
    { name: 'graph_id', type: 'Path', schema: z.string() },
    {
      name: 'body',
      type: 'Body',
      schema: z.object({
        pds_id: z.string().nullable().optional(),
        severity: severitySchema.nullable().optional(),
        type: z.string().nullable().optional(),
        limit: z.number().int().nullable().optional(),
      }),
    },
  ],
  response: suggestionReportSchema,
});

const knowledgeApi = makeApi([searchSuggestionsEndpoint]);
export const knowledgeApis = [...knowledgeApi] as const satisfies ZodiosEndpointDefinitions;
export type SuggestionReport = z.infer<typeof suggestionReportSchema>;
export type SuggestionSeverity = z.infer<typeof severitySchema>;
