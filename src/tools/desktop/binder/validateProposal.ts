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
import { resolveSession } from '../../../desktop/sessionResolution.js';
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
  session: z.string().optional().describe('Session.'),
  ask: z.string().describe('Ask.'),
  // WATCH-CLASS (required): bind-template makes `proposal` OPTIONAL (Call-1 classify vs
  // Call-2 validate). validate-proposal has one job — validate a filled proposal — so the
  // proposal is REQUIRED. Left optional, an omitted proposal would drive bindTemplate down
  // the Call-1 classify path and silently return a propose payload instead of a validation
  // (fail-open). Requiring it at the schema fails closed. The proposal shape itself is the
  // SHARED proposalSchema (confidence required, title <= 80, derivation closed enum).
  proposal: proposalSchema.describe('Proposal.'),
  minConfidence: z.number().min(0).max(1).optional().describe('Min confidence.'),
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
      'Dry-run bind-template gate; no apply.',
      'Returns inject args/blockers; if valid, call bind-template.',
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
