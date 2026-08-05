import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { idealCardinality } from '../../../desktop/binder/cardinality.js';
import { FAMILY_VALUES } from '../../../desktop/binder/manifest.js';
import type { TemplateManifest } from '../../../desktop/binder/manifest-types.js';
import { bundledIntelligenceProvider } from '../../../desktop/intelligence/provider.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import type { TemplatePass1Eligibility } from '../../../desktop/templates/bookmarkTemplate.js';
import { listTemplateCatalog } from '../../../desktop/templates/templatePath.js';
import { resolveTemplateManifest } from '../../../desktop/templates/templateSlots.js';
import { ArgsValidationError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { jsonToolResult } from '../structuredContent.js';
import { DesktopTool } from '../tool.js';

// list-templates resolves MCP's protected seed together with Tableau-owned repository
// bookmarks. External files are read in place and inferred from their own bytes; MCP never
// copies them or overlays protected metadata onto a shadowing user source. Session app info
// selects the repository without mutating request-global environment.

// WATCH-CLASS tightening (fail-open lens): the closed `Family` taxonomy is enforced at
// the schema boundary via z.enum. A bare-string family filter would be LENIENT — a
// typo like 'timeseries' would parse and silently return an empty list, masking the
// mistake as "no such templates". Rejecting it at the schema layer fails closed instead.
const paramsSchema = {
  session: z
    .string()
    .max(64)
    .optional()
    .describe('Desktop session id; optional if pinned or unique.'),
  family: z.enum(FAMILY_VALUES).optional(),
  fastPathOnly: z.boolean().optional(),
  query: z.string().trim().min(1).max(256).optional().describe('Search template metadata.'),
  cursor: z.string().max(255).optional().describe('Last template from the previous page.'),
  limit: z.number().int().min(1).max(50).optional().describe('Page size; default 20, max 50.'),
  includeSlots: z.boolean().optional().describe('Include full slot details after narrowing.'),
};

/** One template's discovery summary: family / slots / fast-path status. */
interface SlotSummary {
  slot_id: string;
  kind: string;
  required: boolean;
  bindable: boolean;
  purpose?: string;
  examples?: string[];
  /**
   * SUGGESTION metadata: the original donor field caption/name this slot was inferred
   * from. Unlike `template_field`/`notes` (excluded below because a donor name as slot
   * IDENTITY both leaks and anchors), a labeled hint is sanctioned matching metadata —
   * it tells the agent "originally this was <hint>; pick an analogous field."
   */
  hint?: string;
  /**
   * Structural, donor-free additions (see the projection note above `summarizeTemplate`):
   * WHERE the field lands in the chart and at WHAT derivation, plus the advisory
   * cardinality band that position implies.
   *
   * `ideal_cardinality` counts what the READER SEES — ticks, legend entries, marks —
   * which equals the field's distinct-value count only when `derivation` is `none`.
   * On a truncating derivation (`yr`, `mn`, `tmn`, …) a 1,200-day date field renders
   * ~4 year ticks, so read the band against the rendered grain, not the raw column.
   * It is advice about legibility and never a restriction: a bind that exceeds it
   * still succeeds, carrying a warning.
   */
  role?: string[];
  derivation?: string;
  ideal_cardinality?: { ideal_max: number; workable_max: number; rationale: string };
}

interface TemplateSummary {
  template: string;
  family: string;
  pass1_eligible: boolean;
  pass1_blockers?: string[];
  provenance: string;
  metadataTrust: 'trusted-protected-or-dev' | 'untrusted-repository';
  overridesLowerPrecedence: boolean;
  description: string;
  slot_signature: {
    total: number;
    required: number;
    kinds: string[];
  };
  readiness?: string;
  fast_path_eligible?: boolean;
  fast_path_blockers?: string[];
  intent_keywords?: string[];
  avoid_when?: string[];
  slots?: SlotSummary[];
  calc_count?: number;
}

/**
 * HONEST DERIVATION (Finding 7): the shipped manifests carry `fast_path_blockers: []`
 * for every template — even GREEN ones with `fast_path_eligible: false` — so a caller
 * scanning for WHY a template is a dead end gets zero signal from the raw data. We do NOT
 * hand-edit the compiled manifests (that creates drift). Instead, when a template is
 * ineligible AND its explicit blocker list is empty, derive ONE honest blocker string
 * mechanically from a manifest field the repo already ships: `render_verified === 'none'`
 * means the template carries no live-render-verification stamp — the necessary-but-missing
 * portability proof that gates fast_path_eligible (see PortabilityEvidence). A manifest
 * that DOES carry explicit blockers passes them through untouched; an eligible template
 * has none. Traceable to a field, never fabricated.
 */
export function deriveFastPathBlockers(
  m: Pick<TemplateManifest, 'fast_path_eligible' | 'fast_path_blockers' | 'portability_evidence'>,
): string[] {
  if (m.fast_path_eligible || m.fast_path_blockers.length > 0) {
    return m.fast_path_blockers;
  }
  if (m.portability_evidence.render_verified === 'none') {
    return ['not-live-render-verified: this template has no live render verification stamp'];
  }
  return [];
}

// Field names here mirror the manifest's serialized (snake_case) data contract —
// the same fidelity rule bind-template follows for the binder's `args`. Only
// tool-authored params/aggregates (fastPathOnly, fastPathCount) are camelCase per
// AGENTS.md.
//
// PROJECTION BOUNDARY — why `role`/`derivation` are added and `notes`/`template_field`
// are NOT. A template must never advertise the concrete fields its donor workbook
// happened to use; the agent is choosing fields for a DIFFERENT dataset, and a donor
// name is both a leak and an anchoring bias. Measured against the shipped manifests:
// of 142 bindable slots, `template_field` is a `{{field_base_N}}` token on only 15 and
// a concrete donor name on 127, and 36 `notes` embed concrete column-instances
// (`[sum:Profit:qk]`, `SUM([Actual])`, `[avg:Longitude:qk]`). Both fields are therefore
// excluded. `role` and `derivation` are closed structural vocabularies — shelf positions
// and Tableau derivation short-forms — that describe the SLOT, never the donor, so they
// widen what the agent knows without leaking anything.
function summarizeTemplate(
  m: TemplateManifest,
  eligibility: TemplatePass1Eligibility,
  provenance: string,
  overridesLowerPrecedence: boolean,
  includeSlots: boolean,
): TemplateSummary {
  const metadataTrust =
    provenance === 'protected' || provenance === 'dev-override'
      ? 'trusted-protected-or-dev'
      : 'untrusted-repository';
  return {
    template: m.template,
    family: m.family,
    pass1_eligible: eligibility.pass1_eligible,
    provenance,
    metadataTrust,
    overridesLowerPrecedence,
    description: m.description,
    slot_signature: {
      total: m.slots.length,
      required: m.slots.filter((slot) => slot.required).length,
      kinds: [...new Set(m.slots.map((slot) => slot.kind))].sort(),
    },
    ...(includeSlots
      ? {
          readiness: m.readiness,
          pass1_blockers: eligibility.pass1_blockers,
          fast_path_eligible: m.fast_path_eligible,
          fast_path_blockers: deriveFastPathBlockers(m),
          intent_keywords: m.intent_keywords,
          ...(m.avoid_when ? { avoid_when: m.avoid_when } : {}),
          slots: m.slots.map((s) => {
            const band = idealCardinality(s);
            return {
              slot_id: s.slot_id,
              kind: s.kind,
              required: s.required,
              bindable: s.bindable,
              ...(s.purpose ? { purpose: s.purpose } : {}),
              ...(s.purpose && s.examples && s.examples.length > 0 ? { examples: s.examples } : {}),
              ...(s.hint ? { hint: s.hint } : {}),
              ...(s.role.length > 0 ? { role: s.role } : {}),
              derivation: s.derivation,
              ...(band ? { ideal_cardinality: band } : {}),
            };
          }),
          calc_count: m.calcs.length,
        }
      : {}),
  };
}

function queryScore(manifest: TemplateManifest, rawQuery: string): number {
  const query = rawQuery.toLowerCase();
  const terms = query.split(/\s+/).filter(Boolean);
  const rawFields: Array<[number, string]> = [
    [12, manifest.template],
    [6, manifest.description],
    ...manifest.intent_keywords.map((value): [number, string] => [6, value]),
    ...manifest.slots.flatMap(
      (slot): Array<[number, string]> => [
        [4, slot.slot_id],
        [4, slot.hint ?? ''],
        [3, slot.purpose ?? ''],
        ...(slot.examples ?? []).map((value): [number, string] => [2, value]),
        ...slot.role.map((value): [number, string] => [2, value]),
      ],
    ),
  ];
  const fields = rawFields.map(([weight, value]): [number, string] => [
    weight,
    value.toLowerCase(),
  ]);

  let score = manifest.template.toLowerCase() === query ? 100 : 0;
  for (const term of terms) {
    const best = fields.reduce(
      (highest, [weight, value]) => (value.includes(term) ? Math.max(highest, weight) : highest),
      0,
    );
    if (best === 0) return 0;
    score += best;
  }
  return score;
}

type RepositoryDiscovery = {
  source: 'desktop-app' | 'environment' | 'protected-only';
  warning?: string;
};

function compareTemplateNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const title = 'List Chart Templates';
const COMPACT_RESPONSE_LIMIT_BYTES = 16_384;
const DETAIL_RESPONSE_LIMIT_BYTES = 12_288;

function serializedSuccessResultBytes(payload: Record<string, unknown>): number {
  return Buffer.byteLength(JSON.stringify(jsonToolResult(payload, { isError: false })), 'utf-8');
}

export const getListTemplatesTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const listTemplatesTool = new DesktopTool({
    server,
    name: 'list-templates',
    title,
    description: 'Search templates in the Desktop repository.',
    paramsSchema,
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    callback: async (
      { session, family, fastPathOnly, query, cursor, limit = 20, includeSlots = false },
      extra,
    ): Promise<CallToolResult> => {
      return await listTemplatesTool.logAndExecute({
        extra,
        args: { session, family, fastPathOnly, query, cursor, limit, includeSlots },
        getSuccessResult: (payload) => jsonToolResult(payload, { isError: false }),
        callback: async () => {
          if (includeSlots && (!query || limit !== 1)) {
            return new ArgsValidationError(
              'includeSlots requires query and limit=1. Request one detailed candidate at a time.',
            ).toErr();
          }

          let repositoryRoot: string | undefined;
          let repositoryDiscovery: RepositoryDiscovery;
          const requestedSession = session?.trim();
          const explicitSession =
            requestedSession !== undefined &&
            requestedSession.length > 0 &&
            requestedSession.toLowerCase() !== 'default';
          try {
            const sessionResult = resolveSession(session);
            if (sessionResult.isErr()) {
              if (explicitSession) {
                return sessionResult.error.toErr();
              }
              throw sessionResult.error;
            }
            const executor = await extra.getExecutor(sessionResult.value);
            const appResult = await executor.getApp(extra.signal);
            if (appResult.isOk() && appResult.value.repositoryLocation?.trim()) {
              repositoryRoot = appResult.value.repositoryLocation.trim();
              repositoryDiscovery = { source: 'desktop-app' };
            } else {
              throw new Error('Desktop app info omitted repositoryLocation.');
            }
          } catch {
            if (explicitSession) {
              return new ArgsValidationError(
                `Template repository discovery failed for explicit Desktop session "${requestedSession}". No catalog was returned.`,
              ).toErr();
            }
            repositoryRoot = process.env['TABLEAU_REPOSITORY_DIR'];
            repositoryDiscovery = repositoryRoot
              ? {
                  source: 'environment',
                  warning:
                    'Desktop repository discovery was unavailable; using TABLEAU_REPOSITORY_DIR.',
                }
              : {
                  source: 'protected-only',
                  warning:
                    'Desktop repository discovery was unavailable; showing protected templates only.',
                };
          }

          // This status describes only MCP's protected seed; per-template provenance below
          // identifies Tableau-owned repository files that MCP reads in place.
          const status = bundledIntelligenceProvider.getStatus();
          const sources = listTemplateCatalog({ repositoryRoot });
          const diagnostics = sources
            .filter((source) => source.discoveryIssue !== undefined)
            .map(({ template, provenance, discoveryIssue }) => ({
              template,
              provenance,
              issue: discoveryIssue!,
            }));
          const all = sources.flatMap((source) => {
            if (source.discoveryIssue) return [];
            if (source.provenance === 'protected') {
              const resolved = resolveTemplateManifest(source.template, source);
              return resolved ? [resolved] : [];
            }
            try {
              const resolved = resolveTemplateManifest(source.template, source);
              return resolved ? [resolved] : [];
            } catch {
              return [];
            }
          });
          const discoveryDiagnostics = {
            count: diagnostics.length,
            returned: Math.min(diagnostics.length, 20),
            truncated: diagnostics.length > 20,
            templates: diagnostics.slice(0, 20),
          };
          const matched = all
            .map((resolved) => ({
              resolved,
              score: query ? queryScore(resolved.manifest, query) : 0,
            }))
            .filter(
              ({ resolved, score }) =>
                (family === undefined || resolved.manifest.family === family) &&
                (!fastPathOnly || resolved.manifest.fast_path_eligible) &&
                (!query || score > 0),
            )
            .sort((a, b) =>
              query && b.score !== a.score
                ? b.score - a.score
                : compareTemplateNames(a.resolved.manifest.template, b.resolved.manifest.template),
            );

          let start = 0;
          if (cursor !== undefined) {
            const cursorIndex = matched.findIndex(
              ({ resolved }) => resolved.manifest.template === cursor,
            );
            if (cursorIndex < 0) {
              return new ArgsValidationError(
                `Invalid template cursor "${cursor}" for the current filters.`,
              ).toErr();
            }
            start = cursorIndex + 1;
          }

          let page = matched.slice(start, start + limit);
          const buildPayload = (): Record<string, unknown> => {
            const templates = page.map(
              ({ resolved: { manifest, eligibility, provenance, overridesLowerPrecedence } }) =>
                summarizeTemplate(
                  manifest,
                  eligibility,
                  provenance,
                  overridesLowerPrecedence,
                  includeSlots,
                ),
            );
            return {
              status,
              repositoryDiscovery,
              discoveryDiagnostics,
              total: all.length,
              matched: matched.length,
              count: templates.length,
              fastPathCount: matched.filter(({ resolved }) => resolved.manifest.fast_path_eligible)
                .length,
              nextCursor:
                start + page.length < matched.length
                  ? (page.at(-1)?.resolved.manifest.template ?? null)
                  : null,
              templates,
            };
          };

          const responseLimit = includeSlots
            ? DETAIL_RESPONSE_LIMIT_BYTES
            : COMPACT_RESPONSE_LIMIT_BYTES;
          let payload = buildPayload();
          while (
            !includeSlots &&
            page.length > 0 &&
            serializedSuccessResultBytes(payload) > responseLimit
          ) {
            page = page.slice(0, -1);
            payload = buildPayload();
          }
          if (serializedSuccessResultBytes(payload) > responseLimit) {
            return new ArgsValidationError(
              `Template metadata exceeds the detail response limit of ${DETAIL_RESPONSE_LIMIT_BYTES} bytes. No slot detail was returned.`,
            ).toErr();
          }
          if (!includeSlots && page.length === 0 && start < matched.length) {
            return new ArgsValidationError(
              `Template metadata exceeds the compact response limit of ${COMPACT_RESPONSE_LIMIT_BYTES} bytes. No partial row was returned.`,
            ).toErr();
          }

          return new Ok(payload);
        },
      });
    },
  });

  return listTemplatesTool;
};
