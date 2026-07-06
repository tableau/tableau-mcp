import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import {
  APPLY_INSTRUCTION,
  type BinderResult,
  type BindingProposal,
  bindTemplate,
  type Blocker,
  DERIVATION_OVERRIDE_INSTRUCTION,
  type EscalateReason,
} from '../../../desktop/binder/binder.js';
import type { TemplateManifest } from '../../../desktop/binder/manifest-types.js';
import { getWorkbookXml } from '../../../desktop/commands/workbook/getWorkbookXml.js';
import { bundledIntelligenceProvider } from '../../../desktop/intelligence/provider.js';
import { DesktopCommandExecutionError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';
// The nested `proposal` mirrors the binder library's public data contract
// (`BindingProposal` / `PROPOSAL_OUTPUT_SCHEMA`) verbatim so a Call-1 `propose` payload
// round-trips into a Call-2 `proposal` unchanged. The schema (incl. the watch-class
// confidence-required + title-max-80 tightening) is SHARED with validate-proposal so the
// two tools cannot drift — see proposalSchema.ts.
import { proposalSchema } from './proposalSchema.js';

const paramsSchema = {
  session: z.string().describe('Tableau instance Session ID from list-instances.'),
  ask: z.string().describe("Natural-language chart request, e.g. 'bar chart of Sales by Region'."),
  proposal: proposalSchema
    .optional()
    .describe(
      "Call 2 only: the binding proposal you produced from a Call-1 'propose' payload (must match its output_schema).",
    ),
  minConfidence: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('Confidence floor for a proposal (default 0.6). Below this, the binder escalates.'),
};

/** Result of one bind-template call: the binder outcome plus a plain-text next step. */
type BindTemplateToolResult = BinderResult & { guidance: string };

/** Escalation reasons that route back to the general (non-fast-path) authoring flow. */
const TIER2_REASONS: ReadonlySet<EscalateReason> = new Set<EscalateReason>([
  'not-fast-path',
  'missing-required-slot',
  'calc-dependency-unmet',
  'template-not-found',
  'kind-mismatch',
  'derivation-illegal',
  'base-column-conflict',
  'cross-datasource-binding',
  // Schema exceeds the classifier's field cap (M10 Finding 3): not a fast-path bind —
  // route to the general authoring flow.
  'schema-too-large',
]);

function renderBlockers(blockers: Blocker[]): string {
  if (blockers.length === 0) {
    return 'none';
  }
  return blockers
    .map((b) => {
      const slot = b.slot_id ? ` slot '${b.slot_id}'` : '';
      const cands =
        b.candidates && b.candidates.length > 0 ? ` (candidates: ${b.candidates.join(', ')})` : '';
      return `[${b.code}]${slot} ${b.detail}${cands}`;
    })
    .join('; ');
}

function renderEscalationGuidance(reason: EscalateReason, blockers: Blocker[]): string {
  let next: string;
  if (reason === 'ambiguous-field' || reason === 'field-not-found') {
    next =
      'Resolve the field(s) with the resolve-field tool, then call bind-template again with a corrected proposal.';
  } else if (reason === 'low-confidence') {
    next =
      'Confidence was below the floor. Re-examine the candidate template(s), pick the best fit, and re-propose with higher confidence.';
  } else if (TIER2_REASONS.has(reason)) {
    next =
      'This ask is not a fast-path template bind. Author the worksheet with the general field/worksheet build tools instead.';
  } else {
    next = 'Author the worksheet with the general build tools instead.';
  }
  return `Escalated (${reason}). No worksheet was produced. Blockers: ${renderBlockers(
    blockers,
  )}. Next: ${next}`;
}

function buildGuidance(res: BinderResult): string {
  switch (res.status) {
    case 'bound':
      return res.apply_instruction || APPLY_INSTRUCTION;
    case 'propose':
      return (
        'No deterministic (no-LLM) match. Choose exactly one template from llm_input.candidate_templates, ' +
        'bind every bindable slot to a field from llm_input.fields (match role/kind; use the exact field name), ' +
        'then call bind-template again with { session, ask, proposal } matching output_schema. ' +
        `${DERIVATION_OVERRIDE_INSTRUCTION}.`
      );
    case 'escalate':
      return renderEscalationGuidance(res.reason, res.blockers);
  }
}

const title = 'Bind a Chart Template to an Ask (Fast Path)';

export const getBindTemplateTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const bindTemplateTool = new DesktopTool({
    server,
    name: 'bind-template',
    title,
    description: [
      'Deterministically bind a checked-in chart template to a natural-language ask and return validated inject args — a fast one-shot alternative to authoring a worksheet from scratch.',
      'Reads the live workbook XML for the given session, loads the bundled template manifests, and runs the two-call binder (this server is model-free — it never calls a small model):',
      "Call 1 { session, ask }: no-LLM keyword classification + role-greedy field binding. Returns status 'bound' with inject args, or status 'propose' with an llm_input (candidate templates + fields) and a strict output_schema for YOU to fill.",
      "Call 2 { session, ask, proposal }: validates your proposal through the deterministic gate and returns status 'bound' or status 'escalate' with actionable guidance.",
      "'bound' returns the args and an apply_instruction; 'propose' and 'escalate' are normal outcomes (not tool errors) carrying next-step guidance.",
    ].join(' '),
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: true, // Reads the live workbook and computes; never mutates it.
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    callback: async ({ session, ask, proposal, minConfidence }, extra): Promise<CallToolResult> => {
      return await bindTemplateTool.logAndExecute<BindTemplateToolResult>({
        extra,
        args: { session, ask, proposal, minConfidence },
        callback: async () => {
          const executor = await extra.getExecutor(session);
          const xmlResult = await getWorkbookXml({ executor, signal: extra.signal });
          if (xmlResult.isErr()) {
            return new DesktopCommandExecutionError(xmlResult.error).toErr();
          }

          // SEAM: source manifests through bundledIntelligenceProvider (never raw
          // loadManifests) so a milestone-2 remote content-pack provider swaps in without
          // editing this tool — matching propose-template / validate-proposal, so all four
          // binder tools follow the same seam. The reconstructed Map is byte-identical to
          // loadManifests(): it keys by manifest.template (== filename, enforced there) and
          // listTemplateManifests() is exactly [...loadManifests().values()], so re-keying
          // by m.template reproduces it.
          const manifests = new Map(
            bundledIntelligenceProvider
              .listTemplateManifests()
              .map((m): [string, TemplateManifest] => [m.template, m]),
          );
          const res = await bindTemplate({
            ask,
            workbookXml: xmlResult.value,
            manifests,
            ...(proposal ? { proposal: proposal as BindingProposal } : {}),
            ...(minConfidence !== undefined ? { minConfidence } : {}),
          });

          return new Ok({ ...res, guidance: buildGuidance(res) });
        },
      });
    },
  });

  return bindTemplateTool;
};
