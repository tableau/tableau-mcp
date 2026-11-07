import { z } from 'zod';

/**
 * Zod schemas for the CES CABU REST surface
 * (`/content-exploration/analytics-assistant/cabu/...`), scoped to what the `cabu-start-conversation`
 * and `cabu-ask` tools actually send/consume for a PDS-backed conversation (see
 * `.work/specs/W-24280234-cabu-tools.md`). Field shapes are read directly from the CES DTOs
 * (`CABUConversationRequestDTO`, `CABUConversationResponseDTO`, `CABUUtteranceRequestDTO`,
 * `CABUUtteranceResponseDTO`, `DatasourceEntry`, `DashboardDatasourceMetadataDTO`,
 * `LocalizationDTO`, `UtteranceDTO`) and the `response_complete` SSE event assembled by
 * `ResponseNode`/`ResponseFormatter`. Workbook/dashboard-only fields (sessionId, wgSessionId,
 * vizqlRoutingKey, dashboardName, artifacts, requestedClassification, businessPreferences,
 * sampling, charts, the legacy non-WAII `data` field) are intentionally omitted: they are out of
 * scope for the PDS-only demo (see spec Non-goals).
 */

export const dashboardDatasourceMetadataSchema = z
  .object({
    workbookDatasourceId: z.string(),
    datasourceLuid: z.string(),
    name: z.string(),
  })
  .partial();
export type DashboardDatasourceMetadata = z.infer<typeof dashboardDatasourceMetadataSchema>;

// `workbookDatasourceId`, `datasourceName`, and `vdsDatasourceLuid` come back as explicit `null`
// (not omitted) for a PDS-only (non-workbook-embedded) conversation -- confirmed against a live
// CES response via the Phase 2 MCP Inspector smoke test. `.nullable()` is required in addition to
// the `.partial()` below: Zod's `.optional()` accepts a missing/`undefined` field, not an explicit
// `null`.
export const datasourceEntrySchema = z
  .object({
    sdmName: z.string(),
    workbookDatasourceId: z.string().nullable(),
    datasourceLuid: z.string(),
    datasourceName: z.string().nullable(),
    vdsDatasourceLuid: z.string().nullable(),
  })
  .partial();
export type DatasourceEntry = z.infer<typeof datasourceEntrySchema>;

export const localizationSchema = z.object({
  locale: z.string(),
  language: z.string(),
});
export type Localization = z.infer<typeof localizationSchema>;

// CES `UtteranceDTO.Source`, `@JsonValue`-lowercased.
export const utteranceSourceSchema = z.enum([
  'user',
  'suggestion',
  'follow_on_suggestion',
  'calc_suggestion',
  'failure_suggestion',
  'multi_step',
  'retry_viz',
  'retry_create_calc',
  'retry_update_calc',
  'retry_describe_calc',
]);
export type UtteranceSource = z.infer<typeof utteranceSourceSchema>;

// --- POST conversations ---

export const cabuConversationRequestSchema = z.object({
  dashboardDatasources: z.array(dashboardDatasourceMetadataSchema),
  embedded: z.boolean().optional(),
});
export type CabuConversationRequest = z.infer<typeof cabuConversationRequestSchema>;

export const cabuConversationResponseSchema = z
  .object({
    conversationId: z.string(),
    scope: z.string(),
    datasources: z.array(datasourceEntrySchema),
    b3TraceId: z.string(),
  })
  .partial();
export type CabuConversationResponse = z.infer<typeof cabuConversationResponseSchema>;

// --- POST conversations/{id}/utterances ---

export const cabuUtteranceRequestSchema = z.object({
  utterance: z.object({
    content: z.string(),
    source: utteranceSourceSchema.optional(),
    planId: z.string().optional(),
  }),
  localization: localizationSchema,
  scope: z.string().optional(),
  datasources: z.array(datasourceEntrySchema),
  parentLuid: z.string().optional(),
  dashboardFilterContextEnabled: z.boolean().optional(),
  embedded: z.boolean().optional(),
});
export type CabuUtteranceRequest = z.infer<typeof cabuUtteranceRequestSchema>;

export const cabuUtteranceResponseSchema = z
  .object({
    utteranceId: z.string(),
    b3TraceId: z.string(),
  })
  .partial();
export type CabuUtteranceResponse = z.infer<typeof cabuUtteranceResponseSchema>;

// --- GET conversations/{id}/utterances/{utteranceId}/stream (SSE) ---

export const cabuDatatableSchema = z.object({
  name: z.string(),
  data: z.unknown(),
});
export type CabuDatatable = z.infer<typeof cabuDatatableSchema>;

// The `response_complete` event body. `node` is always `'response'`; every other field is
// present only when the server had something to put there (WAII data present vs. not, error vs.
// success) -- see `ResponseNode.emitResponseCompleteEvent`.
export const cabuResponseCompleteEventSchema = z.object({
  node: z.literal('response'),
  response: z.string().optional(),
  datatables: z.array(cabuDatatableSchema).optional(),
  dataDetails: z.string().optional(),
  chatLuid: z.string().optional(),
  error_code: z.string().optional(),
  error_details: z.string().optional(),
});
export type CabuResponseCompleteEvent = z.infer<typeof cabuResponseCompleteEventSchema>;

// The terminal `error` event body.
export const cabuStreamErrorEventSchema = z.object({
  error_code: z.string().optional(),
  error_details: z.string().optional(),
});
export type CabuStreamErrorEvent = z.infer<typeof cabuStreamErrorEventSchema>;
