import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { idealCardinality } from '../../../desktop/binder/cardinality.js';
import { FAMILY_VALUES } from '../../../desktop/binder/manifest.js';
import type { TemplateManifest } from '../../../desktop/binder/manifest-types.js';
import { bundledIntelligenceProvider } from '../../../desktop/intelligence/provider.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

// list-templates is the FIRST consumer of the milestone-1 AuthoringIntelligenceProvider
// seam. It serves the bundled snapshot THROUGH the provider
// (`bundledIntelligenceProvider.listTemplateManifests()` / `getStatus()`), never raw
// `loadManifests()`, so the moment milestone 2 swaps in a remote content-pack provider
// this tool follows without edits. A pure reference-library tool: no session, no
// command layer (AGENTS.md permits this for local/bundled reads).

// WATCH-CLASS tightening (fail-open lens): the closed `Family` taxonomy is enforced at
// the schema boundary via z.enum. A bare-string family filter would be LENIENT — a
// typo like 'timeseries' would parse and silently return an empty list, masking the
// mistake as "no such templates". Rejecting it at the schema layer fails closed instead.
const paramsSchema = {
  family: z.enum(FAMILY_VALUES).optional(),
  fastPathOnly: z.boolean().optional(),
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
  readiness: string;
  fast_path_eligible: boolean;
  fast_path_blockers: string[];
  description: string;
  intent_keywords: string[];
  avoid_when?: string[];
  slots: SlotSummary[];
  calc_count: number;
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
function summarizeTemplate(m: TemplateManifest): TemplateSummary {
  return {
    template: m.template,
    family: m.family,
    readiness: m.readiness,
    fast_path_eligible: m.fast_path_eligible,
    fast_path_blockers: deriveFastPathBlockers(m),
    description: m.description,
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
  };
}

const title = 'List Bundled Chart Templates';

export const getListTemplatesTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const listTemplatesTool = new DesktopTool({
    server,
    name: 'list-templates',
    title,
    description: 'List chart templates.',
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    callback: async ({ family, fastPathOnly }, extra): Promise<CallToolResult> => {
      return await listTemplatesTool.logAndExecute({
        extra,
        args: { family, fastPathOnly },
        callback: async () => {
          const status = bundledIntelligenceProvider.getStatus();
          const all = bundledIntelligenceProvider.listTemplateManifests();

          const templates = all
            .filter(
              (m) =>
                (family === undefined || m.family === family) &&
                (!fastPathOnly || m.fast_path_eligible),
            )
            .map(summarizeTemplate)
            .sort((a, b) => a.template.localeCompare(b.template));

          return new Ok({
            status,
            total: all.length,
            count: templates.length,
            fastPathCount: templates.filter((t) => t.fast_path_eligible).length,
            templates,
          });
        },
      });
    },
  });

  return listTemplatesTool;
};
