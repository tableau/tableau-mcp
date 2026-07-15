import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import {
  buildLlmInput,
  classifyNoLlm,
  type LlmProposeInput,
  PROPOSAL_OUTPUT_SCHEMA,
  summarizeSchema,
} from '../../../desktop/binder/binder.js';
import type { TemplateManifest } from '../../../desktop/binder/manifest-types.js';
import { getWorkbookXml } from '../../../desktop/commands/workbook/getWorkbookXml.js';
import {
  bundledIntelligenceProvider,
  type ProviderStatus,
} from '../../../desktop/intelligence/provider.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import { DesktopCommandExecutionError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

// propose-template is the PROPOSE LEG of the two-call binder, exposed as a standalone
// discovery tool: classify an ask -> candidate templates + the strict output_schema the
// caller fills (with a self-rated confidence). It never returns apply-ready args and never
// mutates the workbook — bind-template Call-1 auto-binds on a deterministic hit; this tool
// ALWAYS hands back the candidate shortlist so the caller can choose.
//
// SEAM: manifests are sourced through bundledIntelligenceProvider (never raw
// loadManifests), so a milestone-2 remote content-pack provider swaps in without editing
// this tool. The reconstructed Map is byte-identical to loadManifests(): loadManifests
// keys by manifest.template (== filename, enforced there) and listTemplateManifests() is
// exactly [...loadManifests().values()], so re-keying by m.template reproduces it.

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
  ask: z.string().describe('Natural-language chart request.'),
};

// WATCH-CLASS (input surface): propose-template takes only { session, ask } — both plain
// strings, matching bind-template's own session/ask (no lenient library input to tighten
// here). The tightened proposal contract it ELICITS (confidence required, title <= 80,
// derivation closed enum) is carried by output_schema (PROPOSAL_OUTPUT_SCHEMA) and enforced
// downstream at validate-proposal / bind-template, not re-declared on this leg's inputs.

/** A deterministic no-LLM pick: template + slot->field bindings (the classifier's best guess). */
type NoLlmMatch = NonNullable<ReturnType<typeof classifyNoLlm>>;

interface ProposeToolResult {
  /**
   * 'deterministic' — the no-LLM classifier found a single confident match (in no_llm_match)
   * you can hand straight to validate-proposal / bind-template.
   * 'propose' — no deterministic pick; choose one candidate and self-rate confidence.
   */
  status: 'deterministic' | 'propose';
  /** Honest freshness of the template content behind this classification (bundled snapshot). */
  content_status: ProviderStatus;
  /** Present only when status === 'deterministic'. */
  no_llm_match?: NoLlmMatch;
  /** Candidate templates (each with its bindable slots) + the ask's field schema. */
  llm_input: LlmProposeInput;
  /** The strict JSON schema your proposal must match (requires confidence; title <= 80). */
  output_schema: Record<string, unknown>;
  /** Plain-text next step. */
  guidance: string;
}

const DETERMINISTIC_GUIDANCE =
  'A no-LLM classifier match is in no_llm_match. You may hand it straight to validate-proposal ' +
  '(fill title + a confidence >= the floor) or bind-template, OR pick a different template from ' +
  'llm_input.candidate_templates if the deterministic guess looks wrong for the ask.';

const PROPOSE_GUIDANCE =
  'No deterministic (no-LLM) match. Choose exactly one template from llm_input.candidate_templates, ' +
  'bind every bindable slot to a field from llm_input.fields (match role/kind; use the exact field name), ' +
  'set a 0..1 confidence, then call validate-proposal (dry-run gate) or bind-template with a { proposal } ' +
  'matching output_schema.';

const title = 'Propose Chart Template Candidates for an Ask';

export const getProposeTemplateTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const proposeTemplateTool = new DesktopTool({
    server,
    name: 'propose-template',
    title,
    description: [
      'Classify an ask against bundled fast-path templates and return candidates plus output_schema. Model-free.',
      "status 'deterministic' can go to validate-proposal/bind-template; status 'propose' means choose a candidate and fill output_schema.",
      'Discovery only: never returns apply-ready args and never changes the workbook. Details: expertise://tableau/tactics/workflow/templates.',
    ].join(' '),
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    callback: async ({ session, ask }, extra): Promise<CallToolResult> => {
      return await proposeTemplateTool.logAndExecute<ProposeToolResult>({
        extra,
        args: { session, ask },
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }
          const resolvedSession = sessionResult.value;
          const executor = await extra.getExecutor(resolvedSession);
          const xmlResult = await getWorkbookXml({ executor, signal: extra.signal });
          if (xmlResult.isErr()) {
            return new DesktopCommandExecutionError(xmlResult.error).toErr();
          }

          const manifests = new Map(
            bundledIntelligenceProvider
              .listTemplateManifests()
              .map((m): [string, TemplateManifest] => [m.template, m]),
          );
          const summary = summarizeSchema(xmlResult.value);
          const noLlmMatch = classifyNoLlm(ask, manifests, summary);
          const llmInput = buildLlmInput(ask, manifests, summary);

          return new Ok({
            status: noLlmMatch ? 'deterministic' : 'propose',
            content_status: bundledIntelligenceProvider.getStatus(),
            ...(noLlmMatch ? { no_llm_match: noLlmMatch } : {}),
            llm_input: llmInput,
            output_schema: PROPOSAL_OUTPUT_SCHEMA,
            guidance: noLlmMatch ? DETERMINISTIC_GUIDANCE : PROPOSE_GUIDANCE,
          });
        },
      });
    },
  });

  return proposeTemplateTool;
};
