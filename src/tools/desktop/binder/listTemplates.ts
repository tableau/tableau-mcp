import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

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
  family: z
    .enum(FAMILY_VALUES)
    .optional()
    .describe(
      'Optional filter to a single chart-intent family (closed taxonomy). Omit to list every family.',
    ),
  fastPathOnly: z
    .boolean()
    .optional()
    .describe(
      'When true, return only fast-path-eligible templates (render-verified + portable across the committed fixture). Default false: list all.',
    ),
};

/** One template's discovery summary: family / slots / fast-path status. */
interface SlotSummary {
  slot_id: string;
  kind: string;
  required: boolean;
  bindable: boolean;
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
    slots: m.slots.map((s) => ({
      slot_id: s.slot_id,
      kind: s.kind,
      required: s.required,
      bindable: s.bindable,
    })),
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
    description: [
      'List the bundled fast-path chart templates the binder can bind to an ask, with each template\u2019s chart-intent family, slot contract (slot_id/kind/required/bindable), and fast-path-eligible status.',
      'Use this to discover which templates exist and pick a candidate before calling bind-template; optionally filter by family or to fast-path-eligible templates only.',
      'fast_path_eligible is the AUTHORITATIVE eligibility flag; fast_path_blockers gives the detail on WHY a template is ineligible \u2014 the manifest\u2019s explicit blocker codes when present, otherwise a single blocker derived from the manifest\u2019s verification stamp (e.g. a template with no live-render-verification stamp).',
      'The response carries the content source status (kind, content_version, freshness): freshness is "bundled-snapshot" and satisfies_exec_freshness is false \u2014 an in-package snapshot, only as current as the last generator run, not a live remote fetch.',
    ].join(' '),
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
