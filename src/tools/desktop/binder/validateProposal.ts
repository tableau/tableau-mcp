import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import {
  type BinderResult,
  type BindingProposal,
  bindTemplate,
  type Blocker,
  type EscalateReason,
  type InjectTemplateArgs,
} from '../../../desktop/binder/binder.js';
import type { TemplateManifest } from '../../../desktop/binder/manifest-types.js';
import { getWorkbookXml } from '../../../desktop/commands/workbook/getWorkbookXml.js';
import {
  bundledIntelligenceProvider,
  type ProviderStatus,
} from '../../../desktop/intelligence/provider.js';
import { DesktopCommandExecutionError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';
import { proposalSchema } from './proposalSchema.js';

// validate-proposal is the VALIDATE LEG of the two-call binder, exposed as a dry-run gate:
// run a filled proposal through the deterministic validation bind-template uses on Call 2,
// but report valid/invalid WITHOUT creating or applying a worksheet. It delegates to the
// same bindTemplate() so its verdict is guaranteed identical to bind-template's Call-2 —
// no second validation path to drift.
//
// SEAM: manifests are sourced through bundledIntelligenceProvider (never raw
// loadManifests); the reconstructed Map is byte-identical to loadManifests() (it keys by
// manifest.template == filename, and listTemplateManifests() is [...loadManifests().values()]).

const paramsSchema = {
  session: z.string().describe('Tableau instance Session ID from list-instances.'),
  ask: z.string().describe("Natural-language chart request, e.g. 'bar chart of Sales by Region'."),
  // WATCH-CLASS (required): bind-template makes `proposal` OPTIONAL (Call-1 classify vs
  // Call-2 validate). validate-proposal has one job — validate a filled proposal — so the
  // proposal is REQUIRED. Left optional, an omitted proposal would drive bindTemplate down
  // the Call-1 classify path and silently return a propose payload instead of a validation
  // (fail-open). Requiring it at the schema fails closed. The proposal shape itself is the
  // SHARED proposalSchema (confidence required, title <= 80, derivation closed enum).
  proposal: proposalSchema.describe(
    'The filled binding proposal to validate (must match propose-template / bind-template output_schema).',
  ),
  minConfidence: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('Confidence floor for the proposal (default 0.6). Below this, validation fails.'),
};

/** Result of a validate-proposal call: a dry-run verdict, never an applied change. */
type ValidateProposalToolResult =
  | {
      valid: true;
      content_status: ProviderStatus;
      /** The inject args the proposal WOULD produce (nothing was applied). */
      args: InjectTemplateArgs;
      /** Advisory avoid_when cautions matching the ask; present only when non-empty. Never a blocker. */
      warnings?: string[];
      guidance: string;
    }
  | {
      valid: false;
      content_status: ProviderStatus;
      reason: EscalateReason;
      blockers: Blocker[];
      guidance: string;
    };

const VALID_GUIDANCE =
  'Proposal is VALID: it passed the deterministic gate (slot coverage, field resolution, kind/role, ' +
  'derivation legality, base-column + single-datasource closure, calc-dependency closure) and the ' +
  'confidence floor. No worksheet was created — this is a dry run. To apply it, call bind-template with ' +
  'the same { session, ask, proposal }; it returns these same validated inject args plus an apply_instruction.';

const title = 'Validate a Binding Proposal (Dry Run)';

export const getValidateProposalTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const validateProposalTool = new DesktopTool({
    server,
    name: 'validate-proposal',
    title,
    description: [
      "Validate a filled binding proposal against the live workbook through the binder's deterministic gate WITHOUT creating or applying a worksheet — a dry run of bind-template's Call-2 validate leg.",
      'Reads the live workbook XML for the session, loads the bundled template manifests, and runs the same gate bind-template uses: template exists + is fast-path eligible, slot coverage, field resolution, kind/role compatibility, derivation legality, base-column + single-datasource closure, calc-dependency closure, and the confidence floor.',
      'Returns valid:true with the inject args it WOULD produce (nothing is applied), or valid:false with the escalation reason and structured blockers naming the exact slot(s) to fix.',
      'Use this to check a proposal (e.g. one built from propose-template output_schema) before committing; when valid, call bind-template with the same { session, ask, proposal } to actually bind and get the apply instruction.',
      'content_status carries the content source freshness: "bundled-snapshot" with satisfies_exec_freshness=false — an in-package snapshot, not a live remote fetch.',
    ].join(' '),
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: true, // Reads the workbook and validates; never mutates it.
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    callback: async ({ session, ask, proposal, minConfidence }, extra): Promise<CallToolResult> => {
      return await validateProposalTool.logAndExecute<ValidateProposalToolResult>({
        extra,
        args: { session, ask, proposal, minConfidence },
        callback: async () => {
          const executor = await extra.getExecutor(session);
          const xmlResult = await getWorkbookXml({ executor, signal: extra.signal });
          if (xmlResult.isErr()) {
            return new DesktopCommandExecutionError(xmlResult.error).toErr();
          }

          const manifests = new Map(
            bundledIntelligenceProvider
              .listTemplateManifests()
              .map((m): [string, TemplateManifest] => [m.template, m]),
          );
          const res: BinderResult = await bindTemplate({
            ask,
            workbookXml: xmlResult.value,
            manifests,
            proposal: proposal as BindingProposal,
            ...(minConfidence !== undefined ? { minConfidence } : {}),
          });

          const content_status = bundledIntelligenceProvider.getStatus();

          if (res.status === 'bound') {
            return new Ok({
              valid: true,
              content_status,
              args: res.args,
              ...(res.warnings && res.warnings.length > 0 ? { warnings: res.warnings } : {}),
              guidance: VALID_GUIDANCE,
            });
          }

          if (res.status === 'escalate') {
            return new Ok({
              valid: false,
              content_status,
              reason: res.reason,
              blockers: res.blockers,
              guidance: `Proposal is INVALID (${res.reason}): ${res.blockers.length} blocker(s). See 'blockers' for the exact slot(s) and fix, then re-validate; or call bind-template for the full flow.`,
            });
          }

          // Unreachable for a filled proposal: bindTemplate always takes the Call-2 validate
          // path when `proposal` is present (it never returns 'propose'). Fail CLOSED if the
          // binder contract ever changes, rather than silently reporting a proposal as valid.
          throw new Error(
            `validate-proposal: binder returned unexpected status '${res.status}' for a filled proposal`,
          );
        },
      });
    },
  });

  return validateProposalTool;
};
